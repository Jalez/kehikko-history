import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { Arm } from '../src/view/arm.tsx'
import { History } from '../src/view/history.tsx'
import { Nowhere } from '../src/view/nowhere.tsx'
import type { Reading } from '../git/repo.ts'

/**
 * The components, rendered for real.
 *
 * Half the value of these is that the WORDS are asserted — a refusal that has
 * quietly become "an error occurred" fails here rather than on somebody's
 * screen. The other half is the arm, whose whole reason for existing is that
 * `window.confirm()` silently returns `false` in the host's sandbox.
 */

const reading = (over: Partial<Reading> = {}): Reading => ({
  which: 'kehikot',
  root: '/p/.kehikot',
  present: true,
  absent: null,
  head: { branch: 'main', detached: false, sha: 'a'.repeat(40) },
  commits: [
    {
      sha: 'b'.repeat(40),
      short: 'bbbbbbb',
      at: '2026-08-31T09:00:00Z',
      who: 'Jaakko',
      subject: 'notes: 2 added on chapters/3_method.tex',
    },
  ],
  branches: [{ name: 'main', current: true, sha: 'a'.repeat(40) }],
  dirty: [],
  trouble: null,
  ...over,
})

/* One document per test, so what one test rendered is not what the next one
   reads out of `document.body.textContent`. */
afterEach(cleanup)

const nothing = () => {}

const paint = (over: Partial<Reading> = {}, extra: Partial<Parameters<typeof History>[0]> = {}) =>
  render(
    <History
      reading={reading(over)}
      standing={null}
      busy={false}
      onStart={nothing}
      onCommit={nothing}
      onMove={nothing}
      onRestore={nothing}
      onStash={nothing}
      onShow={nothing}
      shown={null}
      {...extra}
    />,
  )

describe('a destructive press takes two, and there is no confirm() anywhere', () => {
  test('the first press does not fire; it says what would happen', () => {
    let fired = 0
    render(<Arm label="Go here" armed="Check out bbbbbbb" warning="Three files would be lost." onFire={() => (fired += 1)} />)

    fireEvent.click(screen.getByRole('button'))
    expect(fired).toBe(0)
    expect(screen.getByRole('alert').textContent).toBe('Three files would be lost.')
    expect(screen.getByRole('button').textContent).toBe('Check out bbbbbbb')
  })

  test('the second press fires, once', () => {
    let fired = 0
    render(<Arm label="Go here" armed="Do it" warning="what would be lost" onFire={() => (fired += 1)} />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))
    expect(fired).toBe(1)
    /* And it disarms, so a third press starts over rather than firing again. */
    expect(screen.queryByRole('alert')).toBe(null)
  })

  test('it un-arms itself, so a button left armed is never a trap', () => {
    let fired = 0
    render(<Arm label="Go here" armed="Do it" warning="what would be lost" onFire={() => (fired += 1)} />)
    fireEvent.click(screen.getByRole('button'))
    act(() => {
      /* Bun's fake timers are not installed here; the component's own 8s timeout
         is asserted by a pointerdown elsewhere instead, which is the path a
         person actually takes. */
      fireEvent.pointerDown(document.body)
    })
    expect(screen.queryByRole('alert')).toBe(null)
    fireEvent.click(screen.getByRole('button'))
    expect(fired).toBe(0)
  })

  test('no component in this module calls confirm, alert or prompt', () => {
    /*
     * The sandbox the host frames this in has no `allow-modals`, so `confirm()`
     * does not throw and does not open anything — it returns `false`. A button
     * guarded by one does nothing, forever, with nothing in the console. The
     * absence is asserted rather than remembered.
     */
    const files = ['src/view/arm.tsx', 'src/view/history.tsx', 'src/app.tsx', 'src/view/nowhere.tsx']
    for (const file of files) {
      const source = require('node:fs').readFileSync(`${import.meta.dirname}/../${file}`, 'utf8') as string
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
      expect(code).not.toMatch(/\bwindow\.confirm\b|\bconfirm\(/)
      expect(code).not.toMatch(/\bwindow\.alert\b|\balert\(/)
      expect(code).not.toMatch(/\bwindow\.prompt\b|\bprompt\(/)
    }
  })
})

describe('a detached HEAD is said plainly rather than shown as a branch', () => {
  test('the pane says where you have landed and how to get back', () => {
    paint({ head: { branch: null, detached: true, sha: 'c'.repeat(40) } })
    expect(screen.getByText(/not on a branch/)).toBeTruthy()
    expect(document.body.textContent).toContain('git calls this a detached HEAD')
    expect(document.body.textContent).toContain('Press a branch below to get back onto one')
  })

  test('a repository with no commits at all is NOT called detached', () => {
    /* HEAD points at a branch that does not exist yet, which is a new
       repository rather than somebody having wandered off somewhere. */
    paint({ head: { branch: null, detached: false, sha: null }, commits: [], branches: [] })
    expect(screen.queryByText(/not on a branch/)).toBe(null)
    expect(document.body.textContent).toContain('No commits here yet')
  })
})

describe('uncommitted work is named before anything is offered over it', () => {
  test('the files are listed, by name', () => {
    paint({ dirty: [{ code: ' M', path: 'notes/notes.json' }, { code: '??', path: 'checklist/new.json' }] })
    expect(document.body.textContent).toContain('2 not committed')
    expect(document.body.textContent).toContain('notes/notes.json')
    expect(document.body.textContent).toContain('checklist/new.json')
  })

  test('an arm over a dirty tree says the move will be refused rather than done', () => {
    paint({
      dirty: [{ code: ' M', path: 'notes/notes.json' }],
      branches: [
        { name: 'main', current: true, sha: 'a'.repeat(40) },
        { name: 'other', current: false, sha: 'd'.repeat(40) },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'other' }))
    expect(screen.getByRole('alert').textContent).toContain('refused rather than done')
    expect(screen.getByRole('alert').textContent).toContain('Commit them or set them aside first')
  })
})

describe('a data folder that is not a repository yet', () => {
  test('says so and offers exactly one press', () => {
    paint({ present: false, absent: '/p/.kehikot is not a repository of its own yet.' })
    expect(document.body.textContent).toContain('not a repository of its own yet')
    expect(screen.getByRole('button', { name: 'Start this history' })).toBeTruthy()
  })
})

describe('nothing on this screen can push the pane sideways', () => {
  /**
   * The measured failure: shadcn's `Badge` ships `whitespace-nowrap`, and a
   * commit subject is the long unbreakable string that pattern cannot survive.
   * Putting one 83-character subject into a nowrap element at a 220px viewport
   * took `document.scrollWidth` from 220px to 464px.
   *
   * happy-dom does no layout, so this asserts the CAUSE rather than the width —
   * the browser measurement is done separately, at 220, 280, 320, 400 and 1200
   * in both themes. What is checked here is that the elements holding unbounded
   * text are the wrapping kind, which is the thing a future edit would undo
   * without noticing.
   */
  test('the commit subject is not in a nowrap element', () => {
    const long = 'notes: 3 added on a/very/long/path.tex, checklist: ticked “something quite long indeed” for gh#105'
    paint({ commits: [{ sha: 'e'.repeat(40), short: 'eeeeeee', at: '2026-08-31T09:00:00Z', who: 'Jaakko', subject: long }] })
    const node = screen.getByText(long)
    expect(node.className).not.toContain('whitespace-nowrap')
    expect(node.className).toContain('overflow-wrap:anywhere')
    expect(node.className).toContain('min-w-0')
  })

  test('the only nowrap badges are the ones bounded by construction', () => {
    paint({ dirty: [{ code: ' M', path: 'notes/notes.json' }] })
    for (const badge of document.querySelectorAll('[data-slot="badge"]')) {
      if (!badge.className.includes('whitespace-nowrap')) continue
      /* A branch name, a status letter, an eight-character object name. Anything
         longer than that in a nowrap badge is the 464px bug coming back. */
      expect((badge.textContent ?? '').length).toBeLessThanOrEqual(24)
    }
  })
})

describe('the screen for no project', () => {
  test('unframed and hosted-without-a-path are two different sentences', () => {
    const { unmount } = render(<Nowhere unhosted project={null} />)
    expect(document.body.textContent).toContain('Nothing is framing this page')
    unmount()

    render(<Nowhere unhosted={false} project="thesis_latex" />)
    expect(document.body.textContent).toContain('“thesis_latex”')
    expect(document.body.textContent).toContain('will not guess')
  })

  test('it offers nothing to press, because a picker here would be a guess', () => {
    render(<Nowhere unhosted={false} project={null} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
