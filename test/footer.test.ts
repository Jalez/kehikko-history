import { describe, expect, test } from 'bun:test'

import type { Reading } from '../git/repo.ts'
import type { Tracking } from '../git/remote.ts'
import { headerOf } from '../src/view/header.ts'
import { FOOT, footerItems } from '../src/view/footer.ts'

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

const reading = (over: Partial<Reading> = {}, tracking: Partial<Tracking> = {}): Reading => ({
  which: 'project',
  root: '/p',
  present: true,
  absent: null,
  head: { branch: 'main', detached: false, sha: 'a'.repeat(40) },
  commits: [],
  branches: [{ name: 'main', current: true, sha: 'a'.repeat(40) }],
  dirty: [],
  remote: remote(tracking),
  trouble: null,
  ...over,
})

const NOW = Date.parse('2026-09-03T11:00:00Z')

describe('the footer', () => {
  test('the branch and commit, clean, and Push / Pull beside them with their counts', () => {
    const items = footerItems({ reading: reading({}, { ahead: 2, behind: 1 }), busy: false, said: null, now: NOW })
    expect(items.find((i) => i.id === FOOT.BRANCH)).toMatchObject({ kind: 'text', text: 'main · aaaaaaa' })
    expect(items.find((i) => i.id === FOOT.DIRTY)).toMatchObject({ text: 'Clean' })
    expect(items.find((i) => i.id === FOOT.PUSH)).toMatchObject({ kind: 'run', label: 'Push 2', disabled: null, align: 'end' })
    expect(items.find((i) => i.id === FOOT.PULL)).toMatchObject({ kind: 'run', label: 'Pull 1', disabled: null })
  })

  test('nothing to push is off with the reason; busy turns both off', () => {
    const quiet = footerItems({ reading: reading(), busy: false, said: null, now: NOW })
    expect((quiet.find((i) => i.id === FOOT.PUSH) as { disabled: string }).disabled).toContain('Nothing to push')
    const busy = footerItems({ reading: reading({}, { ahead: 2 }), busy: true, said: null, now: NOW })
    expect((busy.find((i) => i.id === FOOT.PUSH) as { disabled: string | null }).disabled).toBeTruthy()
  })

  test('detached is a warning; uncommitted is counted; a failed press is critical', () => {
    const items = footerItems({
      reading: reading({ head: { branch: null, detached: true, sha: 'b'.repeat(40) }, dirty: [{} as Reading['dirty'][number], {} as Reading['dirty'][number]] }),
      busy: false,
      said: { kind: 'failed', text: 'git refused:\n  it would overwrite' },
      now: NOW,
    })
    expect(items.find((i) => i.id === FOOT.BRANCH)).toMatchObject({ text: 'detached at bbbbbbb', level: 'warn' })
    expect(items.find((i) => i.id === FOOT.DIRTY)).toMatchObject({ text: '2 uncommitted' })
    expect(items.find((i) => i.id === FOOT.SAID)).toMatchObject({ level: 'critical', text: 'git refused: it would overwrite' })
  })
})

describe('the header with the footer drawn', () => {
  test('the Uncommitted option says no count: the footer does', () => {
    const items = headerOf({ tab: 'commits', uncommitted: 3, repository: null, footed: true })
    const tab = items[0] as { options: { label: string }[] }
    expect(tab.options.map((o) => o.label)).toEqual(['Commits', 'Uncommitted'])
    const old = headerOf({ tab: 'commits', uncommitted: 3, repository: null }) as { options: { label: string }[] }[]
    expect(old[0]!.options[1]!.label).toBe('Uncommitted (3)')
  })
})
