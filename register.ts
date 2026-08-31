#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ID } from './manifest.ts'

/**
 * Tell a host on this machine where this app answers.
 *
 *   bun run register            # or: PORT=7960 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision on
 * their behalf every time they pressed start.
 *
 * ## The filename is the module id
 *
 * Not a field inside the file — the NAME. A host sweeps the directory and takes
 * the id from the filename, so `roadmap.history.json` is what makes this
 * `roadmap.history`. Two files naming the same port under different names are
 * two modules as far as a host is concerned.
 *
 * ## `dir` as well as `url`
 *
 * The url is where to talk to this app; the directory is where to start it. A
 * host that offers a Start button needs the second, and needs it to be a
 * DIRECTORY rather than a command line — a string a host handed to a shell would
 * make this file a place to write shell. What a host runs is `run.sh` inside
 * this directory: one script, no arguments, for exactly that reason.
 *
 * It is derived from this file's own location rather than from `process.cwd()`,
 * so `bun run register` works from anywhere and records where the program
 * actually is instead of where somebody happened to be standing.
 *
 * ## Where a host looks
 *
 * This line must say exactly what a host's own registry sweep says, and it is
 * copied rather than imported because this directory is meant to stand alone.
 * Writing to the wrong directory is the worst failure a module can have: the
 * host finds nothing, and finds it silently.
 */
const registryDir = process.env.ROADMAP_MODULES_DIR ?? join(homedir(), '.roadmap', 'modules')

const port = Number(process.env.PORT ?? 7960)
const url = `http://127.0.0.1:${port}`
const dir = dirname(fileURLToPath(import.meta.url))

mkdirSync(registryDir, { recursive: true })
const file = join(registryDir, `${ID}.json`)
writeFileSync(file, `${JSON.stringify({ url, dir }, null, 2)}\n`)
console.log(`registered: ${file} -> ${url} (${dir})`)
console.log('Start the app with ./run.sh, then reload the host; it sweeps the directory on every read.')
