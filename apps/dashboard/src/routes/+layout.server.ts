import type { LayoutServerLoad } from "./$types"

/** The signed-in email for the footer (set by hooks.server.ts). */
export const load: LayoutServerLoad = ({ locals }) => ({ user: locals.user })
