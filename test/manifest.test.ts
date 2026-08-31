import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PROTOCOL, manifestSchema } from 'roadmap-module-protocol'

import { ID, MANIFEST, PREFERRED_PORT, VERSION } from '../manifest.ts'

/**
 * What this module says about itself, and the two claims a host acts on.
 *
 * The manifest is the smallest half of this program and the only half a host
 * ever reads, so the things asserted here are the ones whose failure is silent:
 * a manifest a host will not accept, and a `storage: true` that has quietly
 * acquired a `server.cors` beside it.
 */

const root = join(import.meta.dirname, '..')

describe('a host will accept this', () => {
  test('it parses against the protocol’s own schema', () => {
    expect(() => manifestSchema.parse(MANIFEST)).not.toThrow()
  })

  test('it is built against the protocol actually installed', () => {
    expect(MANIFEST.protocol).toBe(PROTOCOL)
    expect(MANIFEST.declares.protocol).toBe(`>=${PROTOCOL} <${PROTOCOL + 1}`)
  })

  test('the protocol installed is 0.13.0', () => {
    /* The version is pinned by hand because `bun update` ALONE will not move a
       `#main` git dependency — it takes `bun pm cache rm` first — and a stale
       copy fails in the quietest possible way: `parse` strips fields it has
       never heard of without complaining. 0.12 carried
       `roadmap-module-protocol/client`, the wire this module stopped writing for
       itself; 0.13 carries `/serve`, the port and the registration it stopped
       deciding for itself. A copy older than that has no `serves()` at all, and
       the failure is a Vite config that will not load. */
    const pkg = JSON.parse(
      readFileSync(join(root, 'node_modules', 'roadmap-module-protocol', 'package.json'), 'utf8'),
    ) as { version: string }
    expect(pkg.version).toBe('0.13.0')
  })

  test('the id, the entry and the health path are the ones every other file uses', () => {
    expect(ID).toBe('roadmap.history')
    expect(MANIFEST.id).toBe(ID)
    expect(MANIFEST.version).toBe(VERSION)
    expect(MANIFEST.entry).toBe('/app')
    expect(MANIFEST.health).toBe('/healthz')
    expect(MANIFEST.mcp?.url).toBe('/mcp')
  })
})

describe('the two declarations that decide whether this is safe', () => {
  test('storage is declared, because this module owns data and takes writes', () => {
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('there is no server.cors anywhere in the vite config', () => {
    /*
     * The pair is load-bearing and either half on its own is a bug. `storage:
     * true` without this makes the page same-origin and no CORS header is sent
     * at all; `storage: true` WITH a permissive header means any page in any tab
     * can read `/app` off loopback, take the write ticket, and post to
     * `/api/switch` on somebody's repository.
     *
     * Asserted against the source rather than against a running server, because
     * this is exactly the mistake somebody makes at four in the afternoon while
     * chasing a different bug, and the test has to fail before it ships rather
     * than during a measurement somebody might not repeat.
     */
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8')
    const code = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/cors\s*:/)
    expect(code).not.toMatch(/Access-Control-Allow-Origin/)
  })

  test('nothing is asked for that is never used', () => {
    /* A capability declared "just in case" is indistinguishable from one that
       works, and is the fastest way to teach somebody to press yes without
       reading. */
    expect(MANIFEST.declares.uses).toEqual(['state:keep'])
    expect(MANIFEST.declares.prompt).toBe(false)
    expect(MANIFEST.extensions.emits).toEqual([])
    expect(MANIFEST.extensions.consumes).toEqual([])
  })
})

describe('the mode is global, and the argument is in the file', () => {
  test('one mode, global-scoped', () => {
    expect(MANIFEST.modes).toHaveLength(1)
    expect(MANIFEST.modes[0]?.id).toBe('history')
    expect(MANIFEST.modes[0]?.scope).toBe('global')
  })

  test('the reason is written down beside it rather than left to be rediscovered', () => {
    const source = readFileSync(join(root, 'manifest.ts'), 'utf8')
    expect(source).toContain("scope: 'global'")
    expect(source).toContain("A history's subject does not")
  })
})

describe('what an agent is told', () => {
  test('the guidance fits the protocol’s bound and says the two things that matter', () => {
    expect(MANIFEST.guidance.length).toBeLessThanOrEqual(1024)
    expect(MANIFEST.guidance).toContain('two histories')
    expect(MANIFEST.guidance).toContain('record')
    /* An agent that read nothing else should still not go looking for a checkout
       tool, so the absence is stated rather than merely true. */
    expect(MANIFEST.guidance).toContain('no tool here that switches branches')
  })

  test('the summary fits its bound', () => {
    expect(MANIFEST.summary.length).toBeLessThanOrEqual(200)
  })
})

describe('the registration this module ships', () => {
  /**
   * This test used to assert that `run.sh` and `register.ts` AGREED on 7960,
   * which was the best available check while the number was written in both.
   * It is now written in neither, so the check that replaces it is that neither
   * of them says a port at all — because a second copy reappearing is exactly
   * how this stops being true again.
   */
  test('the port is stated once, beside the id, and nowhere else', () => {
    expect(PREFERRED_PORT).toBe(7960)
    /* Both of the files that used to hold a copy now ASK for it by name. The
       prose in each still says 7960 — it is discussing what was there — so the
       check is on the import rather than on the digits. */
    expect(readFileSync(join(root, 'register.ts'), 'utf8')).toContain("PREFERRED_PORT } from './manifest.ts'")
    expect(readFileSync(join(root, 'vite.config.ts'), 'utf8')).toContain('prefer: PREFERRED_PORT')
  })

  /* And `--strictPort` is gone with it. It meant this module DIED on a taken
     port, which was the only honest thing to do while nothing handled the
     collision; the drift is now decided deliberately and written into the
     registry, so Vite's own fallback is a second net rather than the absence of
     one. The whole command is asserted rather than the absence of two flags,
     because the comment above it discusses both by name. */
  test('the start script demands no port it might not get', () => {
    const lines = readFileSync(join(root, 'run.sh'), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('exec '))
    expect(lines).toEqual(['exec bunx vite'])
  })

  test('the registration carries both a url and a dir', () => {
    const source = readFileSync(join(root, 'register.ts'), 'utf8')
    expect(source).toContain('registerAt(')
    expect(source).toContain('origin: originFor(port)')
    /* From this file's own location rather than from `process.cwd()`, so
       `bun run register` works from anywhere and records where the program
       actually is. */
    expect(source).toContain('fileURLToPath(import.meta.url)')
  })

  test('there is no index.html and no build script', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts.build).toBeUndefined()
    expect(() => readFileSync(join(root, 'index.html'), 'utf8')).toThrow()
  })
})
