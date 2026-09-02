import type { Both } from '../../doors.ts'
import type { Standing } from '../../git/committer.ts'
import type { Stance } from '../../git/enclosing.ts'
import type { At, Branch, Commit, Dirty, Head, Kind, Reading } from '../../git/repo.ts'
import type { Which } from '../../git/names.ts'

/**
 * Talking to this app's own server, which is the same origin this page came
 * from.
 *
 * ## Why these are plain relative fetches and it is worth saying so
 *
 * `/api/histories` and the rest are relative paths, so the browser resolves them
 * against the document — which is `http://127.0.0.1:7960/app`, framed or not,
 * because this module declares `storage: true` and therefore keeps its origin.
 * Every request below is an ordinary same-origin request: no preflight, no CORS
 * header offered to anybody, and no way for a page in another tab to make one of
 * them. The essay in `manifest.ts` is why that was worth the declaration.
 *
 * ## The types come from the server's own files
 *
 * Imported AS TYPES from above the `src/` boundary, and erased at build. That is
 * deliberate rather than lazy: these shapes are decided in one place and drawn
 * in another, and a hand-written copy on this side would be a second definition
 * that silently disagrees the first time a row grows a field.
 *
 * `import type` and not a value import, and that is load-bearing rather than
 * tidy: `git/repo.ts` imports `node:fs` and `node:child_process` is one hop
 * away, and a value import would drag both into the browser bundle. `tsc` would
 * say nothing, `bun test` would say nothing, and the only symptom would be a
 * page that loads and never answers the host's greeting.
 */

export type { At, Both, Branch, Commit, Dirty, Head, Kind, Reading, Stance, Standing, Which }

/**
 * The ticket, read once off the inert JSON island the document carries.
 *
 * Read at module load rather than per request, because it cannot change while
 * this document is open: it is minted per server process and printed into the
 * page. A missing island is an empty string rather than a throw — that is a page
 * served by something other than this app's own server, which is a real state
 * during a build, and the writes will be refused with a sentence rather than the
 * page failing to render at all.
 */
function ticket(): string {
  const island = typeof document === 'undefined' ? null : document.getElementById('ticket')
  if (!island?.textContent) return ''
  try {
    const parsed: unknown = JSON.parse(island.textContent)
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    return ''
  }
}

const TICKET = ticket()

export type Said = { ok: true; said: string } | { ok: false; error: string; wouldLose?: string[] }

async function post(path: string, body: Record<string, unknown>): Promise<Said> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-history-ticket': TICKET },
      body: JSON.stringify(body),
    })
    const parsed = (await response.json()) as { ok?: unknown; said?: unknown; error?: unknown; wouldLose?: unknown }
    if (parsed.ok === true) return { ok: true, said: typeof parsed.said === 'string' ? parsed.said : '' }
    return {
      ok: false,
      error: typeof parsed.error === 'string' ? parsed.error : 'it did not work, and said nothing about why',
      wouldLose: Array.isArray(parsed.wouldLose) ? (parsed.wouldLose as string[]) : undefined,
    }
  } catch {
    return { ok: false, error: 'This app’s own server did not answer. It may have stopped; check the terminal it is running in.' }
  }
}

/**
 * Both histories and the folder's situation, for one project.
 *
 * A read, and it creates nothing — not a directory, not a repository, not a
 * file. That sentence used to be true of this function and false of the page
 * calling it, which POSTed a start alongside it on every mount. The situation
 * now comes back HERE, in `at`, `stance` and `said`, so the page has something
 * to draw and nothing to do.
 */
export async function histories(projectPath: string | null): Promise<Both> {
  const query = projectPath ? `?project=${encodeURIComponent(projectPath)}` : ''
  const response = await fetch(`/api/histories${query}`, { cache: 'no-store' })
  return (await response.json()) as Both
}

export interface Started {
  ok: boolean
  why: string | null
  standing: Standing | null
  created: boolean
  at: At
}

/**
 * Start committing to the `.kehikot` repository — and, when `asked`, make it one.
 *
 * Two callers and they pass different things, which is the point:
 *
 * - The page, on arrival, with `asked: false`. That resumes automatic commits to
 *   a repository that is already there and does nothing at all otherwise. A page
 *   load is not consent.
 * - The "Start a history here" press, with `asked: true`. Somebody has read a
 *   sentence naming the folder, and pressed anyway.
 *
 * This is the whole of the fix on this side. It used to be one call with no
 * argument, fired from a `useEffect` on mount, and what it did was `git init` in
 * somebody's project.
 */
export async function start(projectPath: string, asked: boolean): Promise<Started> {
  const response = await fetch('/api/watch', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-history-ticket': TICKET },
    body: JSON.stringify({ project: projectPath, asked }),
  })
  return (await response.json()) as Started
}

/** Move HEAD. Refused outright when anything is uncommitted; see `switchTo` in `git/repo.ts`. */
export function move(
  projectPath: string,
  which: Which,
  target: { branch?: string; commit?: string; create?: boolean },
): Promise<Said> {
  return post('/api/switch', { project: projectPath, which, ...target })
}

/** Bring one file back from an older commit. `overwrite` is the second press of the arm. */
export function restore(
  projectPath: string,
  which: Which,
  commitName: string,
  path: string,
  overwrite: boolean,
): Promise<Said> {
  return post('/api/restore', { project: projectPath, which, commit: commitName, path, overwrite })
}

/**
 * Commit some of what is uncommitted — the ticked rows — under a message somebody typed.
 *
 * A rename is sent as both of its paths. `git status` reports it as one entry
 * with a `from`, the page shows it as one row, and the commit has to name both
 * halves or git records the old path as deleted and the new one as added.
 */
export function commitPaths(projectPath: string, which: Which, entries: Dirty[], message: string): Promise<Said> {
  return post('/api/commit-paths', { project: projectPath, which, paths: pathsOf(entries), message })
}

/** Take the ticked rows' changes out of the working tree. They go on the stash; see `discard` in `git/repo.ts`. */
export function discard(projectPath: string, which: Which, entries: Dirty[]): Promise<Said> {
  return post('/api/discard', { project: projectPath, which, paths: pathsOf(entries) })
}

function pathsOf(entries: Dirty[]): string[] {
  const paths: string[] = []
  for (const entry of entries) {
    paths.push(entry.path)
    if (entry.from) paths.push(entry.from)
  }
  return paths
}

/** One commit in full. */
export function show(projectPath: string, which: Which, commitName: string): Promise<Said> {
  return post('/api/show', { project: projectPath, which, commit: commitName })
}
