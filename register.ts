#!/usr/bin/env bun
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { originFor, registerAt } from 'roadmap-module-protocol/serve'

import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * Tell a host on this machine where this app answers.
 *
 *   bun run register            # or: PORT=7961 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision on
 * their behalf every time they pressed start.
 *
 * ## That argument still stands, and the plugin does not contradict it
 *
 * `serves()` in `vite.config.ts` now writes this same file every time the server
 * starts, which looks like exactly what the paragraph above forbids. It is not,
 * and the distinction is worth being precise about, because collapsing the two
 * loses something either way round.
 *
 * ADOPTION is the decision a person makes once, and this program is it. Running
 * this is how a module that was not on somebody's canvas gets onto it, and
 * deleting the file is how it comes off.
 *
 * The ADDRESS is not a decision anybody made. Nobody chose 7960; they chose to
 * be framed, and 7960 is a fact about where this process happened to bind — a
 * fact that changes between one start and the next when something else has the
 * port. A registration still naming the old number is one the host sweeps to
 * find nothing: it reports this module as not running while it is running one
 * port over, and offers a Start button that would spawn a second copy. Rewriting
 * the address keeps the decision the person made TRUE. It does not make one.
 *
 * ## Which leaves this program the short one it should always have been
 *
 * The registry directory, the rule that the FILENAME carries the id, the shape
 * of the document, and the argument for each are in
 * `roadmap-module-protocol/serve` now — imported by this and by every other
 * module rather than copied into fourteen repositories where one of them will
 * eventually disagree by a character. Writing to the wrong directory is the
 * worst failure a module can have, because the host finds nothing and finds it
 * silently.
 *
 * `dir` is still derived from this file's own location rather than from
 * `process.cwd()`, so `bun run register` works from anywhere and records where
 * the program actually is instead of where somebody happened to be standing.
 */
const port = Number(process.env.PORT ?? PREFERRED_PORT)
const written = registerAt({
  id: ID,
  origin: originFor(port),
  dir: dirname(fileURLToPath(import.meta.url)),
})

console.log(`registered: ${written.file} -> ${written.url} (${written.dir})`)
if (written.was) console.log(`  (was ${written.was.url} in ${written.was.dir})`)
console.log('Start the app with ./run.sh, then reload the host; it sweeps the directory on every read.')
console.log(`If ${port} is taken, ./run.sh moves to the next free port and rewrites this file to match.`)
