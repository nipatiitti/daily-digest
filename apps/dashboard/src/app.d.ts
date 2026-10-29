// Bindings come from `import { env } from "cloudflare:workers"` (typed by worker-configuration.d.ts);
// adapter-cloudflare 8 no longer fills `event.platform`.
declare global {
  namespace App {
    interface Locals {
      /** Email from the Cloudflare Access JWT, or "dev" under `vite dev`. */
      user: string
    }
  }
}

export {}
