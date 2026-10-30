import { waitUntil } from "cloudflare:workers"
import { ACTION_SUBJECTS, cachedAnswer, DASHBOARD_LLM_PURPOSES, storeAnswer } from "@digest/db"
import { SpendCapError, streamAnswer } from "@digest/llm"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { answerCall, answerCapUsd, llm } from "#lib/server/llm.ts"
import type { RequestHandler } from "./$types"

const Body = z.object({
  purpose: z.enum(DASHBOARD_LLM_PURPOSES),
  subjectKind: z.enum(ACTION_SUBJECTS),
  /** Canonical digits only, so one subject has one cache key. */
  subjectId: z.string().regex(/^[1-9]\d{0,15}$/),
})

const TEXT = { "content-type": "text/plain; charset=utf-8" }

const plain = (status: number, message: string) => new Response(message, { status, headers: TEXT })

const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")

/**
 * Claude's answer about one subject as plain text, streamed as it is written and stored once it ends. The input is
 * built and hashed here, so the stored answer comes back at once until anything the model would read changes.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return plain(400, "Send purpose, subjectKind and subjectId as JSON.")
  const { purpose, subjectKind, subjectId } = body.data
  const call = await answerCall(purpose, subjectKind, subjectId)
  if (!call) return plain(404, `Nothing to answer about ${subjectKind} ${subjectId}.`)

  const d = db()
  const input = [call.model, call.system, call.prompt, call.maxTokens, call.effort]
  const key = { ...body.data, inputHash: await sha256(JSON.stringify(input)) }
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
      // A cut-off answer is shown but not stored, so the next click asks again.
      .then(({ text, refs, callId, stopReason }) =>
        stopReason === "end_turn" ? storeAnswer(d, { ...key, text, refsJson: refs, llmCallId: callId }) : undefined,
      )
      .catch((e) => console.error(JSON.stringify({ event: "answer_failed", ...key, error: String(e) }))),
  )
  return new Response(answer.stream.pipeThrough(new TextEncoderStream()), { headers: TEXT })
}
