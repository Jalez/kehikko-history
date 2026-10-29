import { existsSync, watch, type FSWatcher } from 'node:fs'

import { events, publish, watching } from 'kehikot-module-protocol/serve'

import { locate, projectRepo } from './git/repo.ts'

/**
 * Telling the page that a project's histories changed, over one held stream: the page never asks on
 * a clock (protocol 2.32.0, `events`/`subscribe`). What travels is that there IS news; the page reads
 * `/api/histories` again, the door it already reads.
 *
 * News is published where the change happens:
 *
 * - a commit the committer made on its own (`git/committer.ts`), and every press and agent tool that
 *   writes (`doors.ts`);
 * - a watcher over the project's repository while a page follows it, for everything this process did
 *   not do itself: a commit, a checkout or a `git add` in a terminal, a file edited in the working
 *   tree (the Uncommitted tab), and a module writing into `.kehikot/` (the "pending" line). One
 *   recursive watch covers both histories, because `.kehikot` sits inside the project.
 *
 * The read this triggers runs `git status`, which may not write the index while it reads
 * (`GIT_OPTIONAL_LOCKS=0`, `git/run.ts`), so a read never wakes the watcher it answers. Git's object
 * store and reflogs are not watched: a commit or a checkout also moves a ref or HEAD, which is.
 * Nothing here runs `git fetch`; a fetch happens only on a person's press.
 */

export const EVENTS_PATH = '/api/histories/events'

/** The news itself. The page re-reads on any event; the first is sent as a stream opens. */
export const NEWS = { changed: true } as const

/** The topic for a project, keyed on the folder as it resolves, so every spelling of it is one topic. */
export function topicOf(projectPath: string | null | undefined): string {
  const found = locate(projectPath)
  if (found.ok === true) return `histories:${found.where.project}`
  return `histories:${typeof projectPath === 'string' ? projectPath.trim() : ''}`
}

/* A burst — a commit writes several files, a checkout many — is one piece of news. */
const SETTLE_MS = 250
const settling = new Map<string, ReturnType<typeof setTimeout>>()

/** Say that `projectPath`'s histories changed. Nothing is sent when no page follows it. */
export function changed(projectPath: string | null | undefined): void {
  if (!projectPath) return
  const topic = topicOf(projectPath)
  if (settling.has(topic) || watching(topic) === 0) return
  settling.set(
    topic,
    setTimeout(() => {
      settling.delete(topic)
      publish(topic, NEWS)
    }, SETTLE_MS),
  )
}

/** Paths under the watched folder whose change is not something the page shows. */
export function ignorable(name: string): boolean {
  const path = `/${name.replace(/\\/g, '/')}`
  return path.includes('/.git/objects/') || path.includes('/.git/logs/') || path.includes('/node_modules/') || path.endsWith('/node_modules')
}

const watchers = new Map<string, FSWatcher>()

/**
 * Watch the project's repository (or the project folder, when it is in none) for `topic` while a
 * page follows it. A watcher whose topic nobody follows any more is closed at its next event.
 */
function watchProject(topic: string, projectPath: string): void {
  if (watchers.has(topic)) return
  const found = locate(projectPath)
  if (found.ok !== true) return
  const folder = projectRepo(found.where.project)
  if (!existsSync(folder)) return
  try {
    const watcher = watch(folder, { recursive: true, persistent: false }, (_event, name) => {
      if (watching(topic) === 0) {
        watcher.close()
        watchers.delete(topic)
        return
      }
      if (typeof name === 'string' && ignorable(name)) return
      changed(projectPath)
    })
    watcher.on('error', () => {
      watcher.close()
      watchers.delete(topic)
    })
    watchers.set(topic, watcher)
  } catch {
    /* A folder that cannot be watched: this process's own commits and presses still publish. */
  }
}

/** Stop every watcher (tests, and a server that stops). */
export function stopWatching(): void {
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
  for (const timer of settling.values()) clearTimeout(timer)
  settling.clear()
}

/** How many watchers are open, for tests. */
export const watcherCount = (): number => watchers.size

/** The doors' `stream` option: `/api/histories/events?project=…`. No project is a topic too: nothing ever changes on it. */
export const stream = events((path, query) => {
  if (path !== EVENTS_PATH) return null
  const project = query.get('project')?.trim() || null
  const topic = topicOf(project)
  if (project) watchProject(topic, project)
  return { topic, initial: NEWS }
})
