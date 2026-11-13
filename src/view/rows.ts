import type { Reading } from '@/store/ask.ts'
import { footerItems, troubleFooter } from '@/view/footer.ts'
import { headerOf } from '@/view/header.ts'

/**
 * the rows Source Control declares to a host that draws a header and a footer, one state per moment
 * worth checking, for `kehikot-check-rows` (protocol 2.70.0). Built from the real header and footer
 * functions, so `kehikot.rows.json` (written by `bun run rows`, held equal to this by
 * `test/rows.test.ts`) cannot drift from what the page sends.
 *
 * The header sets the module up (which half of the history, which repository); the footer says how
 * the repository stands (branch, what is uncommitted, Push and Pull beside the counts they move).
 */

const NOW = Date.parse('2026-11-10T12:00:00Z')

const reading = (over: Partial<Reading> = {}, ahead = 0, behind = 0): Reading => ({
  which: 'project',
  root: '/project',
  present: true,
  absent: null,
  head: { branch: 'main', detached: false, sha: 'a'.repeat(40) },
  commits: [],
  branches: [{ name: 'main', current: true, sha: 'a'.repeat(40) }],
  dirty: [],
  remote: { remotes: ['origin'], branch: 'main', upstream: 'origin/main', pushTo: 'origin/main', ahead, behind, gone: false, publishTo: null, fetchedAt: '2026-11-10T11:58:00Z' },
  trouble: null,
  ...over,
})

const dirty = [
  { code: ' M', path: 'notes/a.md', kind: 'modified' as const, from: null },
  { code: '??', path: 'notes/b.md', kind: 'untracked' as const, from: null },
]

export function rowsStates() {
  return [
    {
      name: 'commits, one repository, clean',
      header: headerOf({ tab: 'commits', uncommitted: 0, repository: null, footed: true }),
      footer: footerItems({ reading: reading(), busy: false, said: null, now: NOW }),
      state: true,
    },
    {
      name: 'uncommitted, two repositories, ahead and behind',
      header: headerOf({ tab: 'uncommitted', uncommitted: dirty.length, repository: 'kehikot', footed: true }),
      footer: footerItems({ reading: reading({ which: 'kehikot', root: '/project/.kehikot', dirty }, 2, 1), busy: false, said: null, now: NOW }),
      state: true,
    },
    {
      name: 'a push refused',
      header: headerOf({ tab: 'commits', uncommitted: 0, repository: null, footed: true }),
      footer: footerItems({ reading: reading({}, 1, 0), busy: false, said: { kind: 'failed', text: 'The remote has commits you do not.' }, now: NOW }),
      state: true,
    },
    {
      name: 'detached, busy',
      header: headerOf({ tab: 'commits', uncommitted: 0, repository: null, footed: true }),
      footer: footerItems({ reading: reading({ head: { branch: null, detached: true, sha: 'b'.repeat(40) } }), busy: true, said: null, now: NOW }),
      state: true,
    },
    { name: 'the read failed', header: [], footer: troubleFooter('git could not read this repository.'), state: true },
    { name: 'nothing read yet', header: [], footer: [] },
  ]
}
