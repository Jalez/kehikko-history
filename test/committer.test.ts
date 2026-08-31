import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { claim, debounce, MOST_MS, QUIET_MS } from '../git/committer.ts'

/**
 * The debounce and the lock, without a filesystem watcher and without git.
 *
 * The behaviour worth asserting here is the one the whole design rests on — **a
 * burst of writes becomes one commit and not five** — and asserting it against
 * real timers would be a test that sleeps for ten seconds and is flaky on a busy
 * machine. So the clock is a number that the test moves, and the debounce is a
 * handful of function calls.
 */

describe('a burst becomes one commit', () => {
  test('five writes in two seconds are one commit, three seconds after the last', () => {
    const clock = debounce(3000, 30_000)
    let commits = 0
    let now = 1000

    /* Five writes, 400ms apart. */
    for (let n = 0; n < 5; n += 1) {
      clock.poke(now)
      now += 400
      if (clock.due(now)) commits += 1
    }
    expect(commits).toBe(0)
    expect(clock.waiting()).toBe(true)

    /* Nothing more happens. The loop keeps asking. */
    for (let step = 0; step < 10; step += 1) {
      now += 500
      if (clock.due(now)) commits += 1
    }
    expect(commits).toBe(1)
    expect(clock.waiting()).toBe(false)
  })

  test('nothing is due when nothing has happened', () => {
    const clock = debounce(3000, 30_000)
    expect(clock.due(1)).toBe(false)
    expect(clock.due(1_000_000)).toBe(false)
    expect(clock.at()).toBe(null)
  })

  test('two separate bursts are two commits', () => {
    const clock = debounce(3000, 30_000)
    clock.poke(0)
    expect(clock.due(4000)).toBe(true)
    clock.poke(5000)
    expect(clock.due(6000)).toBe(false)
    expect(clock.due(9000)).toBe(true)
  })

  test('a run of writes cannot postpone a commit forever', () => {
    /* The failure this closes: a program writing every second defers the commit
       indefinitely, and the one afternoon somebody needs to recover is the
       afternoon nothing was committed. */
    const clock = debounce(3000, 30_000)
    let now = 0
    let commits = 0
    for (let step = 0; step < 100; step += 1) {
      clock.poke(now)
      now += 1000
      if (clock.due(now)) commits += 1
    }
    expect(commits).toBeGreaterThanOrEqual(3)
  })

  test('the deadline it reports is the earlier of quiet and the cap', () => {
    const clock = debounce(3000, 30_000)
    clock.poke(0)
    expect(clock.at()).toBe(3000)
    clock.poke(29_000)
    expect(clock.at()).toBe(30_000)
  })

  test('the shipped numbers are the ones the essay argues for', () => {
    expect(QUIET_MS).toBe(3000)
    expect(MOST_MS).toBe(30_000)
  })
})

describe('one committer, and only one', () => {
  const scratch = () => mkdtempSync(join(tmpdir(), 'kehikko-history-lock-'))

  test('a second process against the same folder does not commit, and says why', () => {
    const dir = join(scratch(), '.git')
    mkdirSync(dir, { recursive: true })

    const first = claim(dir, process.pid)
    expect(first.ok).toBe(true)

    /* A pid that is certainly alive and is not ours: our own parent. Using a made-up
       number would test the stale path instead of the contended one. */
    const second = claim(dir, process.ppid || 1)
    expect(second.ok).toBe(false)
    expect(second.why).toContain('already the committer')
    expect(second.why).toContain('index.lock')

    first.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('after the first releases, the second can take it', () => {
    const dir = join(scratch(), '.git')
    mkdirSync(dir, { recursive: true })
    const first = claim(dir, process.pid)
    first.release()
    const second = claim(dir, process.ppid || 1)
    expect(second.ok).toBe(true)
    second.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('a lock left by a dead process is taken over rather than honoured forever', () => {
    /* The alternative is that one crash means a data folder is never committed
       again until somebody finds a file they have never heard of. */
    const dir = join(scratch(), '.git')
    mkdirSync(dir, { recursive: true })
    /* A pid that cannot be running: pid 0 is not a process anybody can signal. */
    writeFileSync(join(dir, 'kehikot-committer.lock'), JSON.stringify({ pid: 0, at: '2020-01-01T00:00:00Z' }))

    const taken = claim(dir, process.pid)
    expect(taken.ok).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'kehikot-committer.lock'), 'utf8')).pid).toBe(process.pid)
    taken.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('an unreadable lock file is treated as stale rather than as a wall', () => {
    const dir = join(scratch(), '.git')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'kehikot-committer.lock'), 'not json at all')
    const taken = claim(dir, process.pid)
    expect(taken.ok).toBe(true)
    taken.release()
    rmSync(dir, { recursive: true, force: true })
  })

  test('releasing does not remove somebody else’s claim', () => {
    /* The race this closes: a stale takeover happens between our read and our
       delete, and a release that removed whatever was there would delete the
       lock the winner had just written. */
    const dir = join(scratch(), '.git')
    mkdirSync(dir, { recursive: true })
    const mine = claim(dir, process.pid)
    writeFileSync(join(dir, 'kehikot-committer.lock'), JSON.stringify({ pid: 999_999, at: 'later' }))
    mine.release()
    expect(JSON.parse(readFileSync(join(dir, 'kehikot-committer.lock'), 'utf8')).pid).toBe(999_999)
    rmSync(dir, { recursive: true, force: true })
  })
})
