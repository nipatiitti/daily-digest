import { invalid } from "@sveltejs/kit"
import { getRequestEvent } from "$app/server"

/** Runs a remote form's write as the signed-in user, turning a db helper's Error into a form issue. Server only. */
export const attempt = async <T>(run: (by: string) => Promise<T>) => {
  try {
    return await run(getRequestEvent().locals.user)
  } catch (e) {
    if (e instanceof Error) invalid(e.message)
    throw e
  }
}
