import adapter from "@sveltejs/adapter-cloudflare"
import { sveltekit } from "@sveltejs/kit/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
        experimental: { async: true },
      },
      // Builds .svelte-kit/cloudflare/_worker.js from wrangler.jsonc. In dev it serves `cloudflare:workers` env
      // through wrangler's getPlatformProxy, which uses remote bindings (D1 has "remote": true).
      adapter: adapter(),
      experimental: { remoteFunctions: true },
    }),
  ],
})
