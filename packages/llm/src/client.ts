import Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { type Db, type LlmPurpose, recordLlmCall, spendSince } from "@digest/db"
import type { z } from "zod"
import { estimateCostUsd, type ModelId } from "./models.ts"

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

const startOfUtcDay = (now: number) => now - (now % 86_400_000)

/** Claude client with the daily spend cap and `llm_calls` logging around every call. */
export const createLlm = (o: LlmOptions) => {
  const client = new Anthropic({ apiKey: o.apiKey, baseURL: o.baseURL, maxRetries: 2 })

  const structured = async <T extends z.ZodType>(c: StructuredCall<T>): Promise<z.infer<T>> => {
    const now = Date.now()
    const spent = await spendSince(o.db, startOfUtcDay(now))
    const cap = o.dailyCapUsd * (c.capMultiplier ?? 1)
    if (spent >= cap) throw new SpendCapError(`daily spend ${spent.toFixed(2)} USD is at the cap ${cap} USD`)

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
    await recordLlmCall(o.db, {
      purpose: c.purpose,
      model: c.model,
      storyId: c.storyId ?? null,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      cachedTokens: res.usage.cache_read_input_tokens ?? 0,
      estCostUsd: estimateCostUsd(c.model, res.usage),
      validationError: refused
        ? `refusal:${res.stop_details?.category ?? "unknown"}`
        : invalid
          ? `invalid:${invalid}`
          : null,
    })
    if (refused) throw new LlmRefusal(res.stop_details?.category ?? null)
    if (invalid !== null) throw new Error(`structured output did not validate: ${invalid}`)
    return parsed as z.infer<T>
  }

  /** Today's spend so far in USD, for the degradation rules in the brief. */
  const spentToday = () => spendSince(o.db, startOfUtcDay(Date.now()))

  return { structured, spentToday, dailyCapUsd: o.dailyCapUsd }
}

export type Llm = ReturnType<typeof createLlm>
