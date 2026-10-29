import { env } from "cloudflare:workers"
import type { Handle } from "@sveltejs/kit/hooks"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { dev } from "$app/env"

const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

const jwks = (domain: string) => {
  let set = jwksByDomain.get(domain)
  if (!set) {
    set = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`))
    jwksByDomain.set(domain, set)
  }
  return set
}

/** The email in a valid Cloudflare Access JWT, or null. */
const accessUser = async (token: string | null) => {
  const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience } = env
  if (!token || !domain || !audience) return null
  try {
    const { payload } = await jwtVerify(token, jwks(domain), { issuer: `https://${domain}`, audience })
    return typeof payload.email === "string" ? payload.email : null
  } catch {
    return null
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  if (dev) {
    event.locals.user = "dev"
    return resolve(event)
  }
  const user = await accessUser(event.request.headers.get("cf-access-jwt-assertion"))
  if (!user) return new Response("Forbidden: sign in through Cloudflare Access.\n", { status: 403 })
  event.locals.user = user
  return resolve(event)
}
