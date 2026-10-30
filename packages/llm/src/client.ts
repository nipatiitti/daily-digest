import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import {
  DASHBOARD_LLM_PURPOSES,
  type Db,
  dashboardSpendSince,
  type LlmPurpose,
  llmCalls,
  recordLlmCall,
  spendSince,
} from "@digest/db"
import type { z } from "zod"
import { estimateCostUsd, type ModelId, type Usage } from "./models.ts"

export class SpendCapError extends Error {}

export class LlmRefusal extends Error {
  constructor(public readonly category: string | null) {
    super(`model declined: ${category ?? "unknown"}`)
  }
}

export type LlmOptions = {
  apiKey: string
  /** AI Gateway or other proxy; the Anthropic API when unset. */
  baseURL?: string
  db: Db
  dailyCapUsd: number
}

export type StructuredCall<T extends z.ZodType> = {
  purpose: LlmPurpose
  model: ModelId
  system: string
  prompt: string
  schema: T
  storyId?: number | null
  maxTokens?: number
  effort?: "low" | "medium" | "high"
  /** Alert-path calls may run up to this multiple of the cap (brief section 9). */
  capMultiplier?: number
}

export type StreamCall = Omit<StructuredCall<z.ZodType>, "schema" | "capMultiplier"> & {
  /** The day's cap for this call in place of the daily cap, such as DASHBOARD_SPEND_CAP_USD. */
  capUsd?: number
}

const startOfUtcDay = (now: number) => now - (now % 86_400_000)

const isDashboard = (p: LlmPurpose) => (DASHBOARD_LLM_PURPOSES as readonly string[]).includes(p)

/** Claude client with the daily spend cap and `llm_calls` logging around every call. */
export const createLlm = (o: LlmOptions) => {
  const client = new Anthropic({ apiKey: o.apiKey, baseURL: o.baseURL, maxRetries: 2 })

  /** Dashboard purposes are held to their own spend today, every other call to the whole day's spend. */
  const checkCap = async (purpose: LlmPurpose, cap: number) => {
    const since = startOfUtcDay(Date.now())
    const spent = await (isDashboard(purpose) ? dashboardSpendSince(o.db, since) : spendSince(o.db, since))
    if (spent >= cap) throw new SpendCapError(`daily spend ${spent.toFixed(2)} USD is at the cap ${cap} USD`)
  }

  /** Writes the `llm_calls` row for a call and returns its id. */
  const logCall = async (c: Pick<StreamCall, "purpose" | "model" | "storyId">, u: Usage, error: string | null) => {
    const [call] = await recordLlmCall(o.db, {
      purpose: c.purpose,
      model: c.model,
      storyId: c.storyId ?? null,
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
    await checkCap(c.purpose, o.dailyCapUsd * (c.capMultiplier ?? 1))

    // create, not parse: parse throws on a failed validation before the paid call reaches `llm_calls`.
    const format = zodOutputFormat(c.schema)
    const res = await client.messages.create({
      model: c.model,
      max_tokens: c.maxTokens ?? 4096,
      system: c.system,
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
    if (invalid !== null) throw new Error(`structured output did not validate: ${invalid}`)
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
    await checkCap(c.purpose, c.capUsd ?? o.dailyCapUsd)
    const s = client.messages.stream({
      model: c.model,
      max_tokens: c.maxTokens ?? 4096,
      system: c.system,
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

  /** Today's spend so far in USD, for the degradation rules in the brief. */
  const spentToday = () => spendSince(o.db, startOfUtcDay(Date.now()))

  return { structured, structuredCall, stream, spentToday, dailyCapUsd: o.dailyCapUsd }
}

export type Llm = ReturnType<typeof createLlm>
