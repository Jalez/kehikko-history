import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { runningCount, standing, stopAll, sweep, watching } from '../git/committer.ts'

/** A renamed project must not leave a committer behind at its old path. */

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'

const made: string[] = []
function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'history-moved-')))
  made.push(dir)
  return dir
}

function project(root: string, name: string, id: string | null): string {
  const path = join(root, name)
  mkdirSync(join(path, '.kehikot'), { recursive: true })
  if (id) writeFileSync(join(path, '.kehikot', 'project.json'), JSON.stringify({ id, createdAt: null }))
  spawnSync('git', ['init', '-q'], { cwd: join(path, '.kehikot') })
  return path
}

afterEach(() => {
  stopAll()
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true })
})

const SLOW = 3_600_000

describe('a project that moves', () => {
  test('one committer per project, and none left at the old path after a rename', async () => {
    const root = scratch()
    const old = project(root, 'old', ID_A)
    expect((await watching(old, undefined, false, SLOW, SLOW)).ok).toBe(true)
    expect(runningCount()).toBe(1)

    const next = join(root, 'new')
    renameSync(old, next)
    const moved = await watching(next, undefined, false, SLOW, SLOW)
    expect(moved.ok).toBe(true)
    expect(moved.standing?.root).toBe(join(next, '.kehikot'))
    expect(runningCount()).toBe(1)
    /* Asking again is the same one. */
    expect((await watching(next, undefined, false, SLOW, SLOW)).created).toBe(false)
    expect(runningCount()).toBe(1)
  })

  test('sweep stops a committer whose folder is gone', async () => {
    const root = scratch()
    const old = project(root, 'gone', ID_A)
    await watching(old, undefined, false, SLOW, SLOW)
    renameSync(old, join(root, 'elsewhere'))
    sweep()
    expect(runningCount()).toBe(0)
    expect(standing(old)).toBe(null)
  })

  test('a new unrelated folder at the old path does not reuse the stale committer', async () => {
    const root = scratch()
    const old = project(root, 'p', ID_A)
    const first = await watching(old, undefined, false, SLOW, SLOW)
    expect(first.created).toBe(false) // an existing repo is resumed, not made
    renameSync(old, join(root, 'q'))

    const fresh = project(root, 'p', ID_B)
    const second = await watching(fresh, undefined, false, SLOW, SLOW)
    expect(second.ok).toBe(true)
    expect(runningCount()).toBe(1)
    expect(second.standing).not.toBe(first.standing)
    /* The renamed project is still its own, separate one. */
    expect((await watching(join(root, 'q'), undefined, false, SLOW, SLOW)).ok).toBe(true)
    expect(runningCount()).toBe(2)
  })

  test('a folder without an id is keyed by its path and swept when gone', async () => {
    const root = scratch()
    const old = project(root, 'noid', null)
    await watching(old, undefined, false, SLOW, SLOW)
    rmSync(old, { recursive: true })
    sweep()
    expect(runningCount()).toBe(0)
  })
})
