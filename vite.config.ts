import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { doors, serves } from 'kehikot-module-protocol/serve'
import { defineConfig } from 'vite'

import { BUILD, MANIFEST, TICKET, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * The dev server.
 *
 * - `serves()` decides the port from `PREFERRED_PORT` (or $PORT from a host) and keeps the
 *   registration true, so there is no `server.port` here.
 * - `doors()` is every door this app answers on, served by the one process that serves the page:
 *   the manifest, `/app` with the write ticket and the build printed into it, and `/healthz`,
 *   `/mcp` and `/api/*` through `answer` in doors.ts. A module is ONE ORIGIN — the page fetches
 *   `/api/histories` as a relative path — and `/app` has to be claimed before Vite's resolver sees
 *   it, because this repository has a `src/app.tsx`. See the protocol's docs/module-plumbing.md.
 * - No `server.cors`: this module owns data and takes writes gated on the ticket printed into
 *   `/app`. A permissive header would let any page in any tab read that document, and the ticket.
 *   The manifest declares `storage: true` instead, so the page has a real origin and needs none.
 * - No alias for `kehikot-module-protocol`: it resolves through its exports, as the host's does.
 *   The `@` alias points at `src`, which is what shadcn's generated components import through.
 * - `base: './'`, because a host frames this page at whatever address it wrote down.
 */
export default defineConfig({
  base: './',
  plugins: [
    serves({ id: ID, prefer: PREFERRED_PORT }),
    doors({ manifest: MANIFEST, answer, build: BUILD, page: { title: 'History', ticket: TICKET } }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
