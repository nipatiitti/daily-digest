import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { dailyAllowance, spendCalendar } from "@digest/core"
import {
  DASHBOARD_LLM_PURPOSES,
  type Db,
  dashboardSpendSince,
  type LlmPurpose,
  llmCalls,
  recordLlmCall,
  totalSpendBetween,
} from "@digest/db"
import type { z } from "zod"
import { estimateCostUsd, type ModelId, type Usage } from "./models.ts"

export class SpendCapError extends Error {}

export class LlmRefusal extends Error {
  constructor(public readonly category: string | null) {
    super(`model declined: ${category ?? "unknown"}`)
  }
}

/** Structured output that did not validate, such as JSON cut off at max_tokens; callers fall back as for a refusal. */
export class LlmInvalid extends LlmRefusal {
  constructor(public readonly detail: string) {
    super(null)
    this.message = `structured output did not validate: ${detail}`
  }
}

export type LlmOptions = {
  apiKey: string
  /** AI Gateway or other proxy; the Anthropic API when unset. */
  baseURL?: string
  db: Db
  /** The month's Claude budget over every purpose; each day gets dailyAllowance of what is left. */
  monthlyBudgetUsd: number
}

export type StructuredCall<T extends z.ZodType> = {
  purpose: LlmPurpose
  model: ModelId
  system: string
  prompt: string
  schema: T
  eventId?: number | null
  maxTokens?: number
  effort?: "low" | "medium" | "high"
  /** Ingest may run up to this multiple of today's allowance, so a backlog keeps draining. */
  capMultiplier?: number
  /** Sends `system` as one cached block, so calls in a run that share it read the prefix from the cache. */
  cacheSystem?: boolean
}

export type StreamCall = Omit<StructuredCall<z.ZodType>, "schema" | "capMultiplier"> & {
  /** A dashboard purpose's own daily cap, such as DASHBOARD_SPEND_CAP_USD; the month's budget still holds. */
  capUsd?: number
}

const isDashboard = (p: LlmPurpose) => (DASHBOARD_LLM_PURPOSES as readonly string[]).includes(p)

const systemParam = (c: Pick<StreamCall, "system" | "cacheSystem">) =>
  c.cacheSystem ? [{ type: "text" as const, text: c.system, cache_control: { type: "ephemeral" as const } }] : c.system

/** Claude client with the monthly budget, today's allowance from it, and `llm_calls` logging around every call. */
export const createLlm = (o: LlmOptions) => {
  const client = new Anthropic({ apiKey: o.apiKey, baseURL: o.baseURL, maxRetries: 2 })

  // The month's spend before today does not change during the day, so it is read once per client and UTC day.
  let ledger: { day: number; remaining: number; allowance: number } | null = null
  const budget = async () => {
    const now = Date.now()
    const { day, month } = spendCalendar(now)
    if (ledger?.day !== day) {
      ledger = { day, ...dailyAllowance(o.monthlyBudgetUsd, await totalSpendBetween(o.db, month, day), now) }
    }
    return ledger
  }
  const spentToday = async () => totalSpendBetween(o.db, (await budget()).day, Number.MAX_SAFE_INTEGER)

  /**
   * No call once today's spend over every purpose reaches what the month has left. A dashboard purpose is held to its
   * own cap over its own spend today; every other call to today's allowance times `multiplier`.
   */
  const checkCap = async (purpose: LlmPurpose, c: { multiplier?: number; capUsd?: number }) => {
    const b = await budget()
    const spent = await spentToday()
    if (spent >= b.remaining) {
      throw new SpendCapError(`the month's budget of ${o.monthlyBudgetUsd} USD is used up`)
    }
    if (isDashboard(purpose)) {
      const cap = c.capUsd ?? b.allowance
      const own = await dashboardSpendSince(o.db, b.day)
      if (own >= cap) throw new SpendCapError(`dashboard spend ${own.toFixed(2)} USD is at today's cap ${cap} USD`)
      return
    }
    const cap = b.allowance * (c.multiplier ?? 1)
    if (spent >= cap) {
      throw new SpendCapError(`spend ${spent.toFixed(2)} USD is at today's allowance ${cap.toFixed(2)} USD`)
    }
  }

  /** Writes the `llm_calls` row for a call and returns its id. */
  const logCall = async (c: Pick<StreamCall, "purpose" | "model" | "eventId">, u: Usage, error: string | null) => {
    const [call] = await recordLlmCall(o.db, {
      purpose: c.purpose,
      model: c.model,
      eventId: c.eventId ?? null,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cachedTokens: u.cache_read_input_tokens ?? 0,
      estCostUsd: estimateCostUsd(c.model, u),
      validationError: error,
    }).returning({ id: llmCalls.id })
    return call?.id ?? null
  }

  /** The parsed output with the id of the `llm_calls` row logged for it, for rows that cite the call. */
  const structuredCall = async <T extends z.ZodType>(
    c: StructuredCall<T>,
  ): Promise<{ value: z.infer<T>; callId: number | null }> => {
    await checkCap(c.purpose, { multiplier: c.capMultiplier })

    // create, not parse: parse throws on a failed validation before the paid call reaches `llm_calls`.
    const format = zodOutputFormat(c.schema)
    const res = await client.messages.create({
      model: c.model,
      max_tokens: c.maxTokens ?? 4096,
      system: systemParam(c),
      messages: [{ role: "user", content: c.prompt }],
      output_config: { format, effort: c.effort ?? "low" },
    })

    const refused = res.stop_reason === "refusal"
    let parsed: z.infer<T> | null = null
    let invalid: string | null = null
    if (!refused) {
      try {
        parsed = format.parse(res.content.find((b) => b.type === "text")?.text ?? "")
      } catch (e) {
        invalid = `${res.stop_reason}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
      }
    }
    const callId = await logCall(
      c,
      res.usage,
      refused ? `refusal:${res.stop_details?.category ?? "unknown"}` : invalid ? `invalid:${invalid}` : null,
    )
    if (refused) throw new LlmRefusal(res.stop_details?.category ?? null)
    if (invalid !== null) throw new LlmInvalid(invalid)
    return { value: parsed as z.infer<T>, callId }
  }

  const structured = async <T extends z.ZodType>(c: StructuredCall<T>): Promise<z.infer<T>> =>
    (await structuredCall(c)).value

  /**
   * Plain text as the model writes it. Resolves once Claude answered, so a refused key or overload throws here;
   * `done` settles after the `llm_calls` row is written, from the final usage or from the usage so far when the
   * stream breaks off. Cancelling `stream` aborts the request.
   */
  const stream = async (c: StreamCall) => {
    await checkCap(c.purpose, { capUsd: c.capUsd })
    const s = client.messages.stream({
      model: c.model,
      max_tokens: c.maxTokens ?? 4096,
      system: systemParam(c),
      messages: [{ role: "user", content: c.prompt }],
      output_config: { effort: c.effort ?? "low" },
    })
    // The usage snapshot stops at message_start, so a broken-off stream logs its output from the characters sent.
    let chars = 0
    const done = s.finalMessage().then(
      async (m) => {
        const category = m.stop_reason === "refusal" ? (m.stop_details?.category ?? "unknown") : null
        const callId = await logCall(c, m.usage, category === null ? null : `refusal:${category}`)
        if (category !== null) throw new LlmRefusal(category)
        const out = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
        return { text: out, callId, stopReason: m.stop_reason }
      },
      async (e: unknown) => {
        const usage = s.currentMessage?.usage ?? { input_tokens: 0, output_tokens: 0 }
        const output_tokens = Math.max(usage.output_tokens, Math.ceil(chars / 4))
        await logCall(
          c,
          { ...usage, output_tokens },
          `error:${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
        )
        throw e
      },
    )
    const text = new ReadableStream<string>({
      start(ctrl) {
        s.on("text", (delta) => {
          chars += delta.length
          ctrl.enqueue(delta)
        })
        done.then(
          () => ctrl.close(),
          (e) => ctrl.error(e),
        )
      },
      cancel: () => s.abort(),
    })
    // A failure before the first byte rejects `done` once it is logged, and never emits connect.
    await Promise.race([new Promise((connected) => s.on("connect", () => connected(null))), done])
    return { stream: text, done }
  }

  /** Today's allowance from the month's budget, in USD. */
  const allowanceToday = async () => (await budget()).allowance

  return { structured, structuredCall, stream, spentToday, allowanceToday }
}

export type Llm = ReturnType<typeof createLlm>
