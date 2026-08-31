import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { WELL_KNOWN } from 'roadmap-module-protocol'
import { serves } from 'roadmap-module-protocol/serve'
import { defineConfig, type Plugin } from 'vite'

import { MANIFEST, TICKET, answer } from './doors.ts'
import { ID, PREFERRED_PORT } from './manifest.ts'
import { page } from './page/document.ts'

/**
 * Every door this app answers on, served by the one process that serves the
 * page.
 *
 * ## Why they cannot be a second server
 *
 * A module is ONE ORIGIN or it is nothing: the protocol refuses a manifest whose
 * `entry` points anywhere but the origin that served the manifest. Here that
 * reaches further than usual, because this module holds its own material — the
 * page fetches `/api/histories` as a relative path — and a store on a second
 * port would make every one of those fetches cross-origin.
 *
 * ## Why the page is generated rather than a file
 *
 * `/app` is answered with a document this process builds, run through Vite's
 * `transformIndexHtml` so the client and module graph are injected exactly as
 * they would be for an `index.html` on disk. The reason is the write ticket: it
 * is minted once per process and has to reach the page without being fetchable
 * on a door of its own.
 *
 * It also sidesteps a collision this workspace has lost half a day to. Under
 * Vite dev, a request for `/app` next to an `app.tsx` resolves to that module
 * and answers `200 text/javascript` with compiled source. A browser loads such a
 * document happily and runs nothing in it: the frame's `load` fires, the host
 * greets it, and nothing answers. Here `/app` is claimed before Vite's resolver
 * sees it. This repository has a `src/app.tsx`, which is exactly the collision,
 * so the order is load-bearing rather than defensive.
 */
function doors(): Plugin {
  return {
    name: 'history-doors',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        const method = (request.method ?? 'GET').toUpperCase()

        const send = (status: number, body: unknown) => {
          if (body === null) {
            response.statusCode = status
            response.end()
            return
          }
          response.statusCode = status
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body, null, 2))
        }

        /* Spelled by the protocol package so that this app and every host cannot
           disagree about it by a character. */
        if (path === WELL_KNOWN) return send(200, MANIFEST)

        if (path === '/app' || path === '/app/' || path === '/') {
          void server
            .transformIndexHtml(request.url ?? '/app', page(TICKET), request.originalUrl)
            .then((html) => {
              response.statusCode = 200
              response.setHeader('content-type', 'text/html; charset=utf-8')
              /* Never cached. The ticket in this document is minted per process,
                 so a cached copy is a page whose every write is refused for a
                 reason nobody would look for. */
              response.setHeader('cache-control', 'no-store')
              /* Framed by a host and by nothing else — and by nothing at all is
                 fine too, which is what opening this page directly is. */
              response.setHeader(
                'content-security-policy',
                `frame-ancestors 'self' ${process.env.ROADMAP_ORIGIN ?? 'http://127.0.0.1:4181 http://localhost:4181'}`,
              )
              response.end(html)
            })
            .catch(next)
          return
        }

        const ours = path === '/healthz' || path === '/mcp' || path.startsWith('/api/')
        if (!ours) return next()

        /* Only the paths above read a body, and only those wait for one. Vite's
           own middleware stack has to keep seeing an unconsumed request for
           everything else. */
        void body(request)
          .then((parsed) =>
            answer(method, path, url.searchParams, parsed, readTicket(request.headers['x-history-ticket'])),
          )
          .then((reply) => {
            if (!reply) return next()
            send(reply.status, reply.body)
          })
          .catch(next)
      })
    },
  }
}

/** One header, which node hands over as a string, an array, or nothing. */
function readTicket(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? null
  return null
}

/**
 * The request body, as JSON, or null.
 *
 * Bounded at a megabyte, because the caller is whatever on this machine found
 * the port — loopback is a fence around the machine and not around the programs
 * on it — and a handler that reads until the socket closes is a handler that can
 * be asked to read forever.
 */
const MAX_BODY_BYTES = 1_000_000

async function body(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const piece = chunk as Buffer
    size += piece.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(piece)
  }
  if (!chunks.length) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The dev server, and the one line missing from it.
 *
 * ## No `server.cors` — this module declares storage instead
 *
 * A host frames a module WITHOUT `allow-same-origin` unless its manifest
 * declares storage, which puts the page on an opaque origin — and
 * `<script type="module">` is ALWAYS fetched in CORS mode, so with no permissive
 * header not one script in the page runs. The document loads, `load` fires, the
 * host greets it, and nothing answers. `curl` cannot see it, being unsubject to
 * CORS; only the browser console can. That has cost this codebase days.
 *
 * The fix is not to add the header. This module OWNS data — it creates and
 * commits to the `.kehikot` repository — and takes writes gated on a ticket
 * printed into `/app`. A permissive `Access-Control-Allow-Origin` means any page
 * in any tab can read that document, and therefore that ticket, off loopback —
 * and then post to `/api/switch` on somebody's repository. Measured on a sibling
 * module before it was moved to this shape:
 *
 *     $ curl -H 'Origin: https://evil.example' http://127.0.0.1:7840/app
 *     Access-Control-Allow-Origin: *
 *     ...ticket" type="application/json">"e75d4d01-…
 *
 * So the manifest declares `storage: true` and this line is absent. With a real
 * origin, this page's scripts and its `/api` calls are ordinary same-origin
 * requests: no CORS is involved at all, and the ticket is unreadable from
 * anywhere but inside.
 *
 * ## No alias for `roadmap-module-protocol`
 *
 * There used to be one in every app here, pointing at the protocol's source. It
 * is gone and must not come back: the package's `exports` are correct, and a
 * module that resolved its contract differently from the host it talks to is a
 * module testing something nobody ships. The `@` alias below is a different
 * thing entirely — it points at `src`, and is what shadcn's generated components
 * import through.
 *
 * ## And no `server.port` either, because `serves()` decides it
 *
 * 7960 used to be written twice — `--port "${PORT:-7960}"` in `run.sh` and
 * `Number(process.env.PORT ?? 7960)` in `register.ts` — and true in neither
 * place once anything else took the port, because `--strictPort` meant the
 * module simply died. It is now `PREFERRED_PORT` in `manifest.ts`, stated once
 * beside the id it belongs with and read by both this file and `register.ts`.
 * See `roadmap-module-protocol/serve`: a free 7960 is taken silently, this
 * module already answering there is an exit rather than a second copy, and
 * anything else is a loud move to the next port with the registration rewritten
 * to wherever the server actually bound.
 */
export default defineConfig({
  /**
   * `base: './'`, because this page is served at `/app` here and framed by a
   * host at whatever address that host wrote down. Absolute asset paths are
   * correct in the first case and a guess in the second; relative ones are a
   * fact in both.
   */
  base: './',
  plugins: [serves({ id: ID, prefer: PREFERRED_PORT }), doors(), react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
})
