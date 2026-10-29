import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { watching as following } from 'kehikot-module-protocol/serve'

import { TICKET, answer, stream } from '../doors.ts'
import { stopAll, watching } from '../git/committer.ts'
import type { GitRunner } from '../git/run.ts'
import { EVENTS_PATH, NEWS, ignorable, stopWatching, topicOf, watcherCount } from '../live.ts'

/**
 * The page's stream: the server says when a project's histories changed, so the page never asks on a
 * clock. Each test opens the stream the way the doors do (`stream(method, path, query, emit)`), then
 * makes a change down one of the real paths and checks the news arrived.
 */

const made: string[] = []
function scratch(): string {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'history-live-')))
  made.push(project)
  mkdirSync(join(project, '.kehikot', 'notes'), { recursive: true })
  writeFileSync(join(project, '.kehikot', 'notes', 'notes.json'), '{"notes":[]}')
  return project
}

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' })

const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms))

type Closable = { close: () => void }
const open: Closable[] = []
function follow(project: string | null): unknown[] {
  const heard: unknown[] = []
  const query = new URLSearchParams(project ? { project } : {})
  const live = stream('GET', EVENTS_PATH, query, (event) => heard.push(event), null) as Closable | null
  expect(live && 'close' in live).toBe(true)
  open.push(live!)
  return heard
}

afterEach(() => {
  while (open.length) open.pop()!.close()
  stopWatching()
  stopAll()
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

describe('the stream door', () => {
  test('opens with the news once, follows the topic, and lets go when closed', () => {
    const project = scratch()
    const heard = follow(project)
    expect(heard).toEqual([NEWS])
    expect(following(topicOf(project))).toBe(1)
    expect(watcherCount()).toBe(1)
    open.pop()!.close()
    expect(following(topicOf(project))).toBe(0)
  })

  test('every spelling of a project is one topic', () => {
    const project = scratch()
    expect(topicOf(`${project}/`)).toBe(topicOf(project))
  })

  test('no project is a stream with nothing to watch; another path is not the stream', () => {
    expect(follow(null)).toEqual([NEWS])
    expect(watcherCount()).toBe(0)
    expect(stream('GET', '/api/histories', new URLSearchParams(), () => {}, null)).toBeNull()
  })

  test('the object store and node_modules are not news; HEAD, refs, the index and the work are', () => {
    expect(ignorable('.git/objects/ab/cdef')).toBe(true)
    expect(ignorable('.kehikot/.git/objects/ab/cdef')).toBe(true)
    expect(ignorable('.git/logs/HEAD')).toBe(true)
    expect(ignorable('node_modules/x/index.js')).toBe(true)
    expect(ignorable('.git/HEAD')).toBe(false)
    expect(ignorable('.git/refs/heads/main')).toBe(false)
    expect(ignorable('.git/index')).toBe(false)
    expect(ignorable('src/thesis.tex')).toBe(false)
  })
})

describe('news is published where the histories change', () => {
  test('a press: a write door publishes once the answer is given', async () => {
    const project = scratch()
    git(join(project, '.kehikot'), 'init', '-q')
    const heard = follow(project)
    stopWatching() /* only the door, not the watcher */
    const quiet: GitRunner = async () => ({ ok: true, code: 0, out: '', err: '' })
    await answer('POST', '/api/stash', new URLSearchParams(), { project, which: 'kehikot' }, TICKET, quiet)
    await settle(400)
    expect(heard).toEqual([NEWS, NEWS])
  })

  test('an agent: `record` publishes, `history` (a read) does not', async () => {
    const project = scratch()
    const heard = follow(project)
    stopWatching()
    const quiet: GitRunner = async () => ({ ok: true, code: 0, out: '', err: '' })
    const call = (name: string) =>
      answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { project, which: 'kehikot' } } }, null, quiet)
    await call('history')
    await settle(400)
    expect(heard).toEqual([NEWS])
    await call('record')
    await settle(400)
    expect(heard).toEqual([NEWS, NEWS])
  })

  test('the committer: a commit it makes on its own is news', async () => {
    const project = scratch()
    git(join(project, '.kehikot'), 'init', '-q')
    const heard = follow(project)
    stopWatching() /* so the commit is the only thing that can publish */
    expect((await watching(project, undefined, false, 50, 100)).ok).toBe(true)
    /* The startup pass commits what is there, at the next half-second tick. */
    await settle(1500)
    expect(heard.length).toBeGreaterThan(1)
    expect(heard.every((one) => JSON.stringify(one) === JSON.stringify(NEWS))).toBe(true)
  })

  test('outside this process: a file edited in the work, and a commit made in a terminal', async () => {
    const project = scratch()
    git(project, 'init', '-q')
    writeFileSync(join(project, 'thesis.tex'), 'one')
    git(project, 'add', '-A')
    git(project, 'commit', '-qm', 'first')
    const heard = follow(project)
    await settle(300)
    const opened = heard.length

    writeFileSync(join(project, 'thesis.tex'), 'two')
    await settle()
    expect(heard.length).toBeGreaterThan(opened)

    const edited = heard.length
    git(project, 'commit', '-qam', 'second')
    await settle()
    expect(heard.length).toBeGreaterThan(edited)
  })

  test('a watcher nobody follows any more closes at its next event', async () => {
    const project = scratch()
    follow(project)
    expect(watcherCount()).toBe(1)
    open.pop()!.close()
    writeFileSync(join(project, 'thesis.tex'), 'x')
    await settle()
    expect(watcherCount()).toBe(0)
  })
})
