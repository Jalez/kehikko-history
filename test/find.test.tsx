import { afterEach, describe, expect, test } from 'bun:test'
import { useState } from 'react'
import { cleanup, render } from '@testing-library/react'
import { FIND_MARK_ATTRIBUTE, pageFind } from 'kehikot-module-protocol/client'

import { History } from '../src/view/history.tsx'
import type { Reading } from '../git/repo.ts'

/**
 * Find (protocol 2.69.0). The commits are plain DOM, so the host's find bar is answered by the
 * protocol client's own search of the page with no code here. This holds that the search marks,
 * counts, moves and clears on the history this page renders. Marked with `<mark>` here (the test
 * document has no `CSS.highlights`), which also proves the marks come back out of React's DOM
 * without a trace.
 */

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const commit = (n: number, subject: string) => ({ sha: String(n).repeat(40).slice(0, 40), short: String(n).repeat(7).slice(0, 7), at: '2026-08-31T09:00:00Z', who: 'Jaakko', subject })

const reading: Reading = {
  which: 'kehikot',
  root: '/p/.kehikot',
  present: true,
  absent: null,
  head: { branch: 'main', detached: false, sha: 'a'.repeat(40) },
  commits: [commit(1, 'notes: 2 added on the method chapter'), commit(2, 'journeys: the method step moved'), commit(3, 'paper: a figure'), commit(4, 'notes: method resolved')],
  branches: [{ name: 'main', current: true, sha: 'a'.repeat(40) }],
  dirty: [],
  remote: { remotes: ['origin'], branch: 'main', upstream: 'origin/main', pushTo: 'origin/main', ahead: 0, behind: 0, gone: false, publishTo: null, fetchedAt: '2026-08-31T09:00:00Z' },
  trouble: null,
}

const nothing = () => {}
function Shown() {
  const [tab] = useState<'commits' | 'uncommitted'>('commits')
  return (
    <History reading={reading} tab={tab} standing={null} at="repository" stanceSaid={null} kehikot="/p/.kehikot" busy={false}
      onStart={nothing} onCommitPaths={nothing} onDiscard={nothing} onMove={nothing} onPush={nothing} onPull={nothing} onRestore={nothing} onShow={nothing} shown={null} />
  )
}

const history = () => render(<Shown />).container
const marks = (root: Element) => [...root.querySelectorAll(`mark[${FIND_MARK_ATTRIBUTE}]`)]
const words = { caseSensitive: false, wholeWord: true }

describe('find in the history', () => {
  test('marks and counts the matches in the commits, and moves between them', () => {
    const root = history()
    const search = pageFind(() => {}, { root, visible: () => true, highlights: false })
    expect(search.run('method', words, 'first')).toEqual({ total: 3, current: 1 })
    expect(marks(root)).toHaveLength(3)
    expect(search.run('method', words, 'next')).toEqual({ total: 3, current: 2 })
    expect(search.run('method', words, 'prev')).toEqual({ total: 3, current: 1 })
    expect(search.run('method', words, 'prev')).toEqual({ total: 3, current: 3 })
    expect(root.querySelectorAll('[data-current]')).toHaveLength(1)
    search.close()
  })

  test('close clears every mark and leaves the history as React drew it', () => {
    const root = history()
    const before = root.innerHTML
    const search = pageFind(() => {}, { root, visible: () => true, highlights: false })
    search.run('method', words, 'first')
    search.close()
    expect(marks(root)).toHaveLength(0)
    expect(root.innerHTML).toBe(before)
  })
})
