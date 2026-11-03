import { waitUntil } from "cloudflare:workers"
import { HOME } from "@digest/core"
import { cachedAnswer, storeAnswer } from "@digest/db"
import { SpendCapError, streamAnswer } from "@digest/llm"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { answerCapUsd, askCall, llm } from "#lib/server/llm.ts"
import type { RequestHandler } from "./$types"

/** The question trimmed with its whitespace collapsed, so one question hashes the same. */
const Body = z.object({
  question: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(HOME.questionMaxChars)),
})

const TEXT = { "content-type": "text/plain; charset=utf-8" }

const plain = (status: number, message: string) => new Response(message, { status, headers: TEXT })

const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")

/**
 * Claude's answer to a question for the desk as plain text, streamed as it is written and stored once it ends. The
 * input is built and hashed here, so the stored answer comes back at once until anything the model would read changes.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return plain(400, "Send a question as JSON.")
  const call = await askCall(body.data.question)

  const d = db()
  // The prompt carries the question, so the hash covers it.
  const input = [call.model, call.system, call.prompt, call.maxTokens, call.effort]
  const key = {
    purpose: "ask",
    subjectKind: "cell",
    subjectId: "desk",
    inputHash: await sha256(JSON.stringify(input)),
  } as const
  const cached = await cachedAnswer(d, key)
  if (cached) return new Response(cached.text, { headers: { ...TEXT, "x-answer-cached": "1" } })

  const claude = llm()
  if (!claude) return plain(503, "Claude is not set up: the ANTHROPIC_API_KEY secret is missing.")
  let answer: Awaited<ReturnType<typeof streamAnswer>>
  try {
    answer = await streamAnswer(claude, { ...call, capUsd: answerCapUsd() })
  } catch (e) {
    if (e instanceof SpendCapError) return plain(402, `Today's dashboard Claude budget is used up: ${e.message}.`)
    return plain(502, `Claude did not answer: ${e instanceof Error ? e.message : String(e)}`)
  }
  waitUntil(
    answer.done
      // A cut-off answer is shown but not stored, so the next question asks again.
      .then(({ text, refs, callId, stopReason }) =>
        stopReason === "end_turn" ? storeAnswer(d, { ...key, text, refsJson: refs, llmCallId: callId }) : undefined,
      )
      .catch((e) => console.error(JSON.stringify({ event: "answer_failed", ...key, error: String(e) }))),
  )
  return new Response(answer.stream.pipeThrough(new TextEncoderStream()), { headers: TEXT })
}
