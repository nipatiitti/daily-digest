import { error } from "@sveltejs/kit"
import { dev } from "$app/env"

export const load = () => {
  if (!dev) error(404)
}
