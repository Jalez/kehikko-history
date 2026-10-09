import { describe, expect, test } from 'bun:test'

import type { Reading } from '../git/repo.ts'
import type { Tracking } from '../git/remote.ts'
import { freshness, pullControl, pushControl } from '../src/view/upstream.ts'

/**
 * The table of what the push and pull controls say — every grey has a reason,
 * every reason is the one the server would give, and the two numbers are
 * treated with the different trust they deserve.
 */

const remote = (over: Partial<Tracking> = {}): Tracking => ({
  remotes: ['origin'],
  branch: 'main',
  upstream: 'origin/main',
  pushTo: 'origin/main',
  ahead: 0,
  behind: 0,
  gone: false,
  publishTo: null,
  fetchedAt: '2026-09-03T08:00:00Z',
  ...over,
})

const reading = (over: Partial<Reading> = {}, tracking: Partial<Tracking> | null = {}): Reading => ({
  which: 'project',
  root: '/p',
  present: true,
  absent: null,
  head: { branch: 'main', detached: false, sha: 'a'.repeat(40) },
  commits: [],
  branches: [{ name: 'main', current: true, sha: 'a'.repeat(40) }],
  dirty: [],
  remote: tracking === null ? null : remote(tracking),
  trouble: null,
  ...over,
})

const NOW = Date.parse('2026-09-03T11:00:00Z')

describe('push', () => {
  test('ahead of the upstream: on, with the count, and the tooltip says only a fast-forward', () => {
    const control = pushControl(reading({}, { ahead: 3 }))
    expect(control.on).toBe(true)
    expect(control.word).toBe('push')
    expect(control.count).toBe(3)
    expect(control.reason).toContain('Push 3 commits on main to origin/main')
    expect(control.reason).toContain('Only a fast-forward')
  })

  test('nothing to push is grey, and said as a fact about the remote-tracking ref', () => {
    const control = pushControl(reading())
    expect(control.on).toBe(false)
    expect(control.why).toBe('nothing')
    expect(control.reason).toBe('Nothing to push: origin/main already has every commit on main.')
  })

  test('no remote, detached, and no commits are each grey with their own sentence', () => {
    expect(pushControl(reading({}, { remotes: [], upstream: null, pushTo: null })).why).toBe('no-remote')
    expect(pushControl(reading({}, null)).why).toBe('no-remote')
    const detached = pushControl(reading({ head: { branch: null, detached: true, sha: 'c'.repeat(40) } }, { branch: null }))
    expect(detached.why).toBe('detached')
    expect(detached.reason).toContain('on a commit rather than a branch')
    expect(pushControl(reading({ head: { branch: null, detached: false, sha: null } })).why).toBe('no-commits')
  })

  test('no upstream with a clear remote is "publish", and the tooltip says the upstream gets set', () => {
    const control = pushControl(reading({}, { upstream: null, pushTo: null, publishTo: 'origin' }))
    expect(control.on).toBe(true)
    expect(control.word).toBe('publish')
    expect(control.reason).toContain('a first push')
    expect(control.reason).toContain('sets origin/main as its upstream')
  })

  test('no upstream and no clear remote is grey, naming the remotes and the terminal command', () => {
    const control = pushControl(reading({}, { remotes: ['a', 'b'], upstream: null, pushTo: null, publishTo: null }))
    expect(control.on).toBe(false)
    expect(control.why).toBe('ambiguous')
    expect(control.reason).toContain('2 remotes (a, b)')
    expect(control.reason).toContain('git push -u <remote> main')
  })

  test('a gone upstream keeps push on, and says it puts the branch back', () => {
    const control = pushControl(reading({}, { gone: true, ahead: 0 }))
    expect(control.on).toBe(true)
    expect(control.reason).toContain('gone from the remote')
  })
})

describe('pull', () => {
  test('behind the upstream: on, with the count, and how old the count is', () => {
    const control = pullControl(reading({}, { behind: 2 }), NOW)
    expect(control.on).toBe(true)
    expect(control.count).toBe(2)
    expect(control.reason).toContain('fast-forward only')
    expect(control.reason).toContain('2 commits to bring in as of the last fetch, 3h ago')
  })

  test('nothing behind is NOT grey, because the number is only as fresh as the last fetch', () => {
    const control = pullControl(reading(), NOW)
    expect(control.on).toBe(true)
    expect(control.count).toBe(null)
    expect(control.reason).toContain('Nothing new to bring in as of the last fetch, 3h ago')
  })

  test('a fetch under a minute ago is "a moment ago", never "now ago"', () => {
    expect(freshness('2026-09-03T10:59:40Z', NOW)).toBe('as of a fetch a moment ago')
    expect(freshness('2026-09-03T08:00:00Z', NOW)).toBe('as of the last fetch, 3h ago')
  })

  test('never fetched is said as not knowing, not as zero', () => {
    const control = pullControl(reading({}, { fetchedAt: null }), NOW)
    expect(control.on).toBe(true)
    expect(control.reason).toContain('never fetched from here')
    expect(freshness(null, NOW)).toContain('not known')
  })

  test('uncommitted changes are a caveat on pull rather than a refusal of it', () => {
    const control = pullControl(reading({ dirty: [{ code: ' M', path: 'a', kind: 'modified', from: null }] }, { behind: 1 }), NOW)
    expect(control.on).toBe(true)
    expect(control.why).toBe('none')
    expect(control.count).toBe(1)
    expect(control.reason).toContain('1 file has uncommitted changes')
    expect(control.reason).toContain('refuses the whole pull and changes nothing')
  })

  test('the caveat counts the files, and is absent on a clean tree', () => {
    const two = pullControl(
      reading({
        dirty: [
          { code: ' M', path: 'a', kind: 'modified', from: null },
          { code: '??', path: 'b', kind: 'untracked', from: null },
        ],
      }),
      NOW,
    )
    expect(two.on).toBe(true)
    expect(two.reason).toContain('2 files have uncommitted changes')
    expect(pullControl(reading(), NOW).reason).not.toContain('uncommitted')
  })

  test('no upstream is grey and says push sets one; no remote and detached say theirs', () => {
    const none = pullControl(reading({}, { upstream: null, pushTo: null, publishTo: 'origin' }), NOW)
    expect(none.why).toBe('no-upstream')
    expect(none.reason).toContain('Pushing publishes it and sets one')
    expect(pullControl(reading({}, { remotes: [] }), NOW).why).toBe('no-remote')
    expect(pullControl(reading({ head: { branch: null, detached: true, sha: 'c'.repeat(40) } }, { branch: null }), NOW).why).toBe('detached')
  })
})
