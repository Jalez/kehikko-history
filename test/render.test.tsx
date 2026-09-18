import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { Banner } from '../src/app.tsx'
import { Arm } from '../src/view/arm.tsx'
import { History, Pick } from '../src/view/history.tsx'
import { Nowhere } from '../src/view/nowhere.tsx'
import type { Dirty, Reading } from '../git/repo.ts'

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
  remote: {
    remotes: ['origin'],
    branch: 'main',
    upstream: 'origin/main',
    pushTo: 'origin/main',
    ahead: 0,
    behind: 0,
    gone: false,
    publishTo: null,
    fetchedAt: '2026-08-31T09:00:00Z',
  },
  trouble: null,
  ...over,
})

const dirty = (code: string, path: string, from: string | null = null): Dirty => ({
  code,
  path,
  from,
  kind:
    code === '??' ? 'untracked'
    : code[0] === 'R' ? 'renamed'
    : code.includes('D') ? 'deleted'
    : code[0] === 'A' ? 'new'
    : 'modified',
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
      at="repository"
      stanceSaid={null}
      kehikot="/p/.kehikot"
      busy={false}
      onStart={nothing}
      onCommitPaths={nothing}
      onDiscard={nothing}
      onMove={nothing}
      onPush={nothing}
      onPull={nothing}
      onRestore={nothing}
      onShow={nothing}
      shown={null}
      {...extra}
    />,
  )

/** The Uncommitted tab, opened. Radix tabs switch on click in happy-dom as they do in a browser. */
const openUncommitted = () => {
  fireEvent.mouseDown(screen.getByRole('tab', { name: /Uncommitted/ }))
  fireEvent.click(screen.getByRole('tab', { name: /Uncommitted/ }))
}

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
    const files = [
      'src/view/arm.tsx',
      'src/view/history.tsx',
      'src/view/head.tsx',
      'src/view/commits.tsx',
      'src/view/uncommitted.tsx',
      'src/app.tsx',
      'src/view/nowhere.tsx',
    ]
    for (const file of files) {
      const source = require('node:fs').readFileSync(`${import.meta.dirname}/../${file}`, 'utf8') as string
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
      expect(code).not.toMatch(/\bwindow\.confirm\b|\bconfirm\(/)
      expect(code).not.toMatch(/\bwindow\.alert\b|\balert\(/)
      expect(code).not.toMatch(/\bwindow\.prompt\b|\bprompt\(/)
    }
  })
})

describe('the row above the tabs: branch and commit', () => {
  test('on a branch, the select shows it and the badge shows the commit', () => {
    paint()
    const select = screen.getByRole('combobox', { name: 'Branch' })
    expect(select.textContent).toContain('main')
    expect(select.hasAttribute('disabled')).toBe(false)
    expect(document.body.textContent).toContain('aaaaaaa')
    expect(screen.queryByText(/Switching branches is off/)).toBe(null)
  })

  test('the select is disabled while anything is uncommitted, and the reason is attached to it', () => {
    paint({ dirty: [dirty(' M', 'notes/notes.json'), dirty('??', 'checklist/new.json')] })
    const select = screen.getByRole('combobox', { name: 'Branch' })
    expect(select.hasAttribute('disabled')).toBe(true)
    expect(select.getAttribute('data-frozen')).toBe('dirty')
    /* The reason is a tooltip now rather than a paragraph — a permanent three
       lines of a 220-pixel column, read once, is not what that space is for.
       A tooltip cannot be hovered in this harness and a disabled control
       cannot be hovered at all, which is exactly why `Explaining` also puts
       the sentence in the DOM and points at it with `aria-describedby`. That
       is what a screen reader reaches, so it is what this asserts. */
    const described = document.getElementById('branch-frozen')
    expect(described?.textContent).toContain('Moving to another branch or commit is off while 2 changes are uncommitted')
    expect(described?.textContent).toContain('in the Uncommitted tab')
    expect(described?.className).toContain('sr-only')
  })

  test('the reason is nowhere on screen when the tree is clean', () => {
    paint()
    expect(document.getElementById('branch-frozen')).toBe(null)
    expect(document.body.textContent).not.toContain('Moving to another branch or commit is off')
  })

  test('detached HEAD is said as such, in the select and the badge and a sentence', () => {
    paint({ head: { branch: null, detached: true, sha: 'c'.repeat(40) }, branches: [{ name: 'main', current: false, sha: 'a'.repeat(40) }] })
    expect(screen.getByRole('combobox', { name: 'Branch' }).textContent).toContain('not on a branch')
    const badge = document.querySelector('[data-detached="yes"]')
    expect(badge?.textContent).toBe('detached at ccccccc')
    expect(document.body.textContent).toContain('git calls this a detached HEAD')
    expect(document.body.textContent).toContain('Pick a branch above to get back onto one')
  })

  test('a repository with no commits at all is NOT called detached', () => {
    /* HEAD points at a branch that does not exist yet, which is a new
       repository rather than somebody having wandered off somewhere. */
    paint({ head: { branch: null, detached: false, sha: null }, commits: [], branches: [] })
    expect(document.querySelector('[data-detached="yes"]')).toBe(null)
    expect(document.body.textContent).toContain('no commits yet')
    expect(document.body.textContent).toContain('No commits here yet')
  })
})

describe('an answer can be taken off the screen', () => {
  test('the dismiss press clears the box, and the newlines in it survive', () => {
    let closed = 0
    render(
      <Banner kind="failed" onClose={() => (closed += 1)}>
        <p className="whitespace-pre-line">{'Pull to bring their commits in, then push again.\n\ngit said: ! [rejected]'}</p>
      </Banner>,
    )
    const box = document.querySelector('[data-banner="failed"]')
    expect(box).not.toBe(null)
    /* The seam between this pane talking and git talking is a real newline in
       the DOM, not a space — see the essay on `Banner`. */
    expect(box?.textContent).toContain('push again.\n\ngit said:')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(closed).toBe(1)
  })

  test('a success box carries the same press', () => {
    let closed = 0
    render(
      <Banner kind="done" onClose={() => (closed += 1)}>
        <p>Pushed 1 commit to origin/main.</p>
      </Banner>,
    )
    expect(document.querySelector('[data-banner="done"]')).not.toBe(null)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(closed).toBe(1)
  })
})

describe('push and pull sit on the branch row, and say what they will do', () => {
  const tracking = (over: Partial<NonNullable<Reading['remote']>> = {}): Reading['remote'] => ({
    remotes: ['origin'],
    branch: 'main',
    upstream: 'origin/main',
    pushTo: 'origin/main',
    ahead: 0,
    behind: 0,
    gone: false,
    publishTo: null,
    fetchedAt: '2026-08-31T09:00:00Z',
    ...over,
  })

  test('both are in the same row as the select and the badge', () => {
    paint({ remote: tracking({ ahead: 2, behind: 1 }) })
    const row = screen.getByRole('combobox', { name: 'Branch' }).closest('div.flex.items-center')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByRole('button', { name: 'Push' })).toBeTruthy()
    expect(within(row as HTMLElement).getByRole('button', { name: 'Pull' })).toBeTruthy()
    expect(within(row as HTMLElement).getByText('aaaaaaa')).toBeTruthy()
  })

  test('ahead and behind are the numbers on the controls, and the words are there for wider panes', () => {
    paint({ remote: tracking({ ahead: 2, behind: 1 }) })
    const push = screen.getByRole('button', { name: 'Push' })
    const pull = screen.getByRole('button', { name: 'Pull' })
    expect(push.getAttribute('data-count')).toBe('2')
    expect(pull.getAttribute('data-count')).toBe('1')
    expect(push.textContent).toBe('push2')
    expect(pull.textContent).toBe('pull1')
    /* The word is hidden below `@xs/pane` and the number is not: the number
       is what the control is for. happy-dom does no layout, so what is
       asserted is the class that decides it, as the tab test does. */
    expect(push.querySelector('span:not(.tabular-nums)')?.className).toContain('@xs/pane:inline')
    expect(push.querySelector('.tabular-nums')?.className).not.toContain('hidden')
  })

  test('pressing them calls the two handlers, once each', () => {
    let pushed = 0
    let pulled = 0
    paint({ remote: tracking({ ahead: 1, behind: 1 }) }, { onPush: () => (pushed += 1), onPull: () => (pulled += 1) })
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    expect(pushed).toBe(1)
    expect(pulled).toBe(1)
  })

  test('nothing to push is grey with the reason in the DOM, and pull stays on with the age of its number', () => {
    paint({ remote: tracking() })
    const push = screen.getByRole('button', { name: 'Push' })
    expect(push.hasAttribute('disabled')).toBe(true)
    expect(push.getAttribute('data-why')).toBe('nothing')
    expect(document.getElementById('push-off')?.textContent).toBe('Nothing to push: origin/main already has every commit on main.')
    const pull = screen.getByRole('button', { name: 'Pull' })
    expect(pull.hasAttribute('disabled')).toBe(false)
    expect(document.getElementById('pull-off')).toBe(null)
  })

  test('no remote greys both, with the same sentence', () => {
    paint({ remote: tracking({ remotes: [], upstream: null, pushTo: null }) })
    expect(screen.getByRole('button', { name: 'Push' }).getAttribute('data-why')).toBe('no-remote')
    expect(screen.getByRole('button', { name: 'Pull' }).getAttribute('data-why')).toBe('no-remote')
    expect(document.getElementById('push-off')?.textContent).toContain('git remote add origin')
  })

  test('no upstream: push becomes publish, pull is grey and says push sets one', () => {
    paint({ remote: tracking({ upstream: null, pushTo: null, publishTo: 'origin' }) })
    const push = screen.getByRole('button', { name: 'Push' })
    expect(push.hasAttribute('disabled')).toBe(false)
    expect(push.textContent).toBe('publish')
    const pull = screen.getByRole('button', { name: 'Pull' })
    expect(pull.getAttribute('data-why')).toBe('no-upstream')
    expect(document.getElementById('pull-off')?.textContent).toContain('Pushing publishes it and sets one')
  })

  test('uncommitted changes leave pull pressable, with the caveat in its tooltip', () => {
    paint({ dirty: [dirty(' M', 'a')], remote: tracking({ ahead: 1, behind: 1 }) })
    const pull = screen.getByRole('button', { name: 'Pull' })
    expect(pull.hasAttribute('disabled')).toBe(false)
    expect(pull.getAttribute('data-why')).toBe('none')
    expect(document.getElementById('pull-off')).toBe(null)
    expect(screen.getByRole('button', { name: 'Push' }).hasAttribute('disabled')).toBe(false)
  })

  test('detached HEAD greys both and says why', () => {
    paint({ head: { branch: null, detached: true, sha: 'c'.repeat(40) }, remote: tracking({ branch: null }) })
    expect(screen.getByRole('button', { name: 'Push' }).getAttribute('data-why')).toBe('detached')
    expect(screen.getByRole('button', { name: 'Pull' }).getAttribute('data-why')).toBe('detached')
  })

  test('busy greys both without changing the reason', () => {
    paint({ remote: tracking({ ahead: 1 }) }, { busy: true })
    expect(screen.getByRole('button', { name: 'Push' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Push' }).getAttribute('data-why')).toBe('none')
  })

  test('a grey press is wrapped so it can still be pointed at, and a live one is not', () => {
    paint({ remote: tracking({ ahead: 1 }) })
    /* `Explaining` puts a tabIndex=0 span round a disabled control, because a
       disabled control emits no pointer events; `Explained` hangs the tooltip
       off the control itself. */
    expect(screen.getByRole('button', { name: 'Pull' }).parentElement?.tagName).not.toBe('SPAN')
    paint({ remote: tracking() })
    const off = screen.getAllByRole('button', { name: 'Push' }).at(-1)
    expect(off?.parentElement?.tagName).toBe('SPAN')
    expect(off?.parentElement?.getAttribute('tabindex')).toBe('0')
    expect(off?.parentElement?.getAttribute('aria-describedby')).toBe('push-off')
  })
})

describe('the two tabs are two halves of one repository', () => {
  test('they are called Commits and Uncommitted, and the count is in the title', () => {
    paint({ dirty: [dirty(' M', 'a'), dirty('??', 'b'), dirty(' D', 'c')] })
    expect(screen.getByRole('tab', { name: 'Commits' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Uncommitted (3)' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Project' })).toBe(null)
    expect(screen.queryByRole('tab', { name: 'Data' })).toBe(null)
  })

  test('a clean tree is Uncommitted (0), and the tab says so in words', () => {
    paint()
    expect(screen.getByRole('tab', { name: 'Uncommitted (0)' })).toBeTruthy()
    openUncommitted()
    expect(document.body.textContent).toContain('Nothing is uncommitted')
  })

  test('the Commits tab is what is shown first, with the commit list on it', () => {
    paint()
    expect(screen.getByRole('tab', { name: 'Commits' }).getAttribute('aria-selected')).toBe('true')
    expect(document.body.textContent).toContain('notes: 2 added on chapters/3_method.tex')
  })
})

describe('the Uncommitted tab names each change in a word, not a porcelain code', () => {
  test('modified, new, deleted, renamed and untracked are words; the codes are not on screen', () => {
    paint({
      dirty: [
        dirty(' M', 'notes/notes.json'),
        dirty('A ', 'checklist/added.json'),
        dirty(' D', 'learning/gone.json'),
        dirty('R ', 'journeys/new-name.json', 'journeys/old-name.json'),
        dirty('??', 'questions/'),
      ],
    })
    openUncommitted()
    /* The badge holds a word and, for a narrow pane, a letter; the word is
       what is asked about here, and the letters are asserted on their own
       further down. */
    const words = [...document.querySelectorAll('[data-kind] [data-word]')].map((node) => node.textContent)
    expect(words).toEqual(['modified', 'new', 'deleted', 'renamed', 'untracked'])
    expect(document.body.textContent).not.toContain('??')
    expect(document.body.textContent).not.toContain(' M ')
    /* A rename says where from, because "renamed" without a from is a riddle. */
    expect(document.body.textContent).toContain('journeys/old-name.json → journeys/new-name.json')
    /* And a folder git has not looked inside keeps its slash, as git lists it. */
    expect(document.body.textContent).toContain('questions/')
  })

  test('every row has a checkbox, and tick-all ticks them all', () => {
    paint({ dirty: [dirty(' M', 'a.json'), dirty('??', 'b.json')] })
    openUncommitted()
    expect(screen.getByRole('checkbox', { name: 'Select a.json' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Select b.json' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every file' }))
    expect(document.querySelector('[data-selected-count]')?.textContent).toBe('2 of 2')
    expect(screen.getByRole('button', { name: 'Commit' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(false)
  })
})

describe('committing goes through a dialog that names the files and takes a message', () => {
  test('the ticked files are named, and the commit is disabled until there is a message', () => {
    const made: { entries: Dirty[]; message: string }[] = []
    paint(
      { dirty: [dirty(' M', 'a.json'), dirty('??', 'b.json'), dirty(' D', 'c.json')] },
      { onCommitPaths: (entries, message) => made.push({ entries, message }) },
    )
    openUncommitted()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select a.json' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select c.json' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Commit 2 files' })).toBeTruthy()
    const named = dialog.querySelector('[data-named]')
    expect(named?.textContent).toContain('a.json')
    expect(named?.textContent).toContain('c.json')
    expect(named?.textContent).not.toContain('b.json')

    const button = within(dialog).getByRole('button', { name: 'Commit 2 files' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Commit message' }), { target: { value: 'two things' } })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)

    expect(made).toHaveLength(1)
    expect(made[0]?.message).toBe('two things')
    expect(made[0]?.entries.map((entry) => entry.path)).toEqual(['a.json', 'c.json'])
    /* And the dialog closes. */
    expect(screen.queryByRole('dialog')).toBe(null)
  })

  test('one file at a time: the row button commits that row alone, whatever is ticked', () => {
    const made: Dirty[][] = []
    paint(
      { dirty: [dirty(' M', 'a.json'), dirty('??', 'b.json')] },
      { onCommitPaths: (entries) => made.push(entries) },
    )
    openUncommitted()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Commit b.json' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Commit b.json' })).toBeTruthy()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Commit message' }), { target: { value: 'just b' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Commit this file' }))
    expect(made).toEqual([[dirty('??', 'b.json')]])
  })
})

describe('discarding takes a dialog AND two presses, and never a single click', () => {
  test('the dialog names the files, says where they go, and the first press inside it does not fire', () => {
    const discarded: Dirty[][] = []
    paint(
      { dirty: [dirty(' M', 'a.json'), dirty('??', 'b.json')] },
      { onDiscard: (entries) => discarded.push(entries) },
    )
    openUncommitted()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select every file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Discard changes to 2 files?')).toBeTruthy()
    expect(dialog.querySelector('[data-named]')?.textContent).toContain('a.json')
    expect(dialog.querySelector('[data-named]')?.textContent).toContain('b.json')
    /* Where they go: the stash, not nowhere. It is the sentence that makes
       this a discard a person can undo, and it is asserted as words. */
    expect(dialog.textContent).toContain('git stash pop')
    expect(dialog.textContent).toContain('New files leave the working tree')

    /* Press one: arms. Nothing fired. */
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard 2 files' }))
    expect(discarded).toHaveLength(0)
    expect(within(dialog).getByRole('alert').textContent).toContain('last press')

    /* Press two: fires, once, and the dialog closes. */
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, discard' }))
    expect(discarded).toHaveLength(1)
    expect(discarded[0]?.map((entry) => entry.path)).toEqual(['a.json', 'b.json'])
    expect(screen.queryByRole('dialog')).toBe(null)
  })

  test('cancel closes it with nothing discarded, even after arming', () => {
    const discarded: Dirty[][] = []
    paint({ dirty: [dirty(' M', 'a.json')] }, { onDiscard: (entries) => discarded.push(entries) })
    openUncommitted()
    fireEvent.click(screen.getByRole('button', { name: 'Discard a.json' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard this change' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(discarded).toHaveLength(0)
    expect(screen.queryByRole('dialog')).toBe(null)
  })
})

describe('the Commits tab keeps what already worked', () => {
  test('going to a commit is frozen over a dirty tree, for the branch select’s reason', () => {
    /* Going to a commit and switching branch are one command, so they are one
       rule. This used to be pressable: an arm that warned, on the second
       press, that git was about to refuse — two presses to learn what grey
       says for free. */
    const moved: unknown[] = []
    paint({ dirty: [dirty(' M', 'notes/notes.json')] }, { onMove: (target) => moved.push(target) })
    const go = screen.getByRole('button', { name: 'Go here' })
    expect(go.hasAttribute('disabled')).toBe(true)
    fireEvent.click(go)
    expect(moved).toHaveLength(0)
    const described = document.getElementById(`gohere-${'b'.repeat(40)}`)
    expect(described?.textContent).toContain('Moving to another branch or commit is off while 1 change is uncommitted')
  })

  test('over a clean tree it is an armed icon that still warns about detaching', () => {
    const moved: unknown[] = []
    paint({}, { onMove: (target) => moved.push(target) })
    const go = screen.getByRole('button', { name: 'Go here' })
    expect(go.hasAttribute('disabled')).toBe(false)
    fireEvent.click(go)
    expect(moved).toHaveLength(0)
    expect(screen.getByRole('alert').textContent).toContain('detached HEAD')
    fireEvent.click(screen.getByRole('button', { name: `Check out bbbbbbb` }))
    expect(moved).toEqual([{ commit: 'b'.repeat(40) }])
  })

  test('the three presses are icons named by their labels, not words in the row', () => {
    /* The words are still the accessible names — nothing is lost to a screen
       reader or to a test — but they are not forty words of chrome down a
       column forty commits long. */
    paint()
    for (const name of ['Open', 'Go here', 'Restore a file']) {
      const button = screen.getByRole('button', { name })
      expect(button.textContent).toBe('')
      expect(button.querySelector('svg')).not.toBe(null)
    }
  })

  test('the three presses share the first line with the badge, and the subject has the second', () => {
    /* They were a third line under the subject, and in a pane 340 pixels
       tall a line that holds three icons and nothing else is the most
       expensive line in the row. happy-dom does no layout, so what is
       asserted is the STRUCTURE: the presses and the badge are children of
       the one element marked as line one, and the subject is not in it. */
    paint()
    const line = document.querySelector('[data-line="one"]')
    expect(line).not.toBe(null)
    const badge = line?.querySelector('[data-slot="badge"]')
    expect(badge?.textContent).toBe('bbbbbbb')
    for (const name of ['Open', 'Go here', 'Restore a file']) {
      expect(line?.contains(screen.getByRole('button', { name }))).toBe(true)
    }
    expect(line?.contains(screen.getByText('notes: 2 added on chapters/3_method.tex'))).toBe(false)
    /* And the date and author are on it too, in one node beside the badge —
       read by their long forms, because the short forms sit beside them in
       the same node for a narrow pane (see "under 320 pixels" below). */
    const wide = [...(line?.querySelectorAll('[data-wide]') ?? [])].map((node) => node.textContent)
    expect(wide).toEqual(['2026-08-31 09:00', 'Jaakko'])
    expect(line?.textContent).toContain(' · ')
  })

  test('restoring a file is still there, behind an arm', () => {
    const restored: [string, string, boolean][] = []
    paint({}, { onRestore: (commit, path, overwrite) => restored.push([commit, path, overwrite]) })
    fireEvent.click(screen.getByRole('button', { name: 'Restore a file' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'File to restore' }), { target: { value: 'notes/notes.json' } })
    fireEvent.click(screen.getByRole('button', { name: 'Restore it' }))
    expect(restored).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Overwrite notes/notes.json' }))
    expect(restored).toEqual([['b'.repeat(40), 'notes/notes.json', true]])
  })
})

/**
 * The ways `.kehikot` can fail to be a repository, and the fact that they are
 * NOT one screen.
 *
 * This is the fix for the incident in `git/enclosing.ts`, asserted where a
 * person would see it. The old screen had one sentence and one Start button
 * whatever the situation was, so pressing Start on a folder the project's own
 * repository already tracked was a thing a person could do — and did.
 */
describe('what is drawn when there is no repository in .kehikot', () => {
  const absent = { present: false, absent: '/p/.kehikot is not a repository of its own.' } as const

  test('waiting: the sentence names the folder, and Start is offered', () => {
    paint(absent, {
      at: 'waiting',
      stanceSaid: '/p/.kehikot — the folder your modules keep this project’s material in — is not inside any git repository.',
    })
    /* The path, in the sentence. The sentence this replaced said "this project's
       data folder" and was read as being about a folder called `data/`. */
    expect(document.body.textContent).toContain('/p/.kehikot')
    expect(screen.getByRole('button', { name: 'Start a history here' })).toBeTruthy()
  })

  test('elsewhere: no Start button, and no commit box either — that folder is in the project’s tabs now', () => {
    paint(absent, {
      at: 'elsewhere',
      stanceSaid: '/p/.kehikot is already in the history of the repository at /p: git is tracking files in it.',
    })
    expect(screen.queryByRole('button', { name: 'Start a history here' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Commit this folder there' })).toBeNull()
  })

  test('refused: the sentence is the loud kind and nothing is offered', () => {
    paint(absent, {
      at: 'refused',
      stanceSaid: '/p/.kehikot/.git.disabled is a git repository somebody set aside.',
    })
    expect(document.body.textContent).toContain('.git.disabled')
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('the project’s own repository never offers to be started', () => {
    paint({ ...absent, which: 'project' }, { at: 'waiting', stanceSaid: 'anything at all' })
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the repository chooser is not the tabs', () => {
  test('it is a captioned radio pair naming the two repositories', () => {
    render(<Pick which="project" onPick={nothing} />)
    expect(screen.getByRole('radiogroup', { name: 'Which repository' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Project' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: '.kehikot' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('tab')).toBe(null)
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
   * the browser measurement is done separately, at 220 and up in both themes.
   * What is checked here is that the elements holding unbounded text are the
   * wrapping kind, which is the thing a future edit would undo without
   * noticing.
   */
  test('the commit subject is not in a nowrap element', () => {
    const long = 'notes: 3 added on a/very/long/path.tex, checklist: ticked “something quite long indeed” for gh#105'
    paint({ commits: [{ sha: 'e'.repeat(40), short: 'eeeeeee', at: '2026-08-31T09:00:00Z', who: 'Jaakko', subject: long }] })
    const node = screen.getByText(long)
    expect(node.className).not.toContain('whitespace-nowrap')
    expect(node.className).toContain('overflow-wrap:anywhere')
    expect(node.className).toContain('min-w-0')
  })

  test('the first line of a commit row cannot push the pane sideways either, armed or not', () => {
    /**
     * The presses moved up beside the badge, the date and the author, and two
     * things on that line are unbounded: the author's name, and — once "Go
     * here" is armed — a sentence about detached HEAD under a button that has
     * gone back to words. The meta wraps inside a zero-basis box, and the
     * presses group may shrink, which is what lets the armed sentence wrap
     * on a line of its own. A `shrink-0` on that group, or a `nowrap` on the
     * meta, is the 464px bug reachable by one press; both are asserted here
     * because both are one-word edits somebody would make for tidiness.
     */
    paint({ commits: [{ sha: 'f'.repeat(40), short: 'fffffff', at: '2026-08-31T09:00:00Z', who: 'Somebody With A Rather Long Name', subject: 'x' }] })
    const line = document.querySelector('[data-line="one"]') as HTMLElement
    expect(line.className).toContain('flex-wrap')
    expect(line.className).toContain('min-w-0')

    const meta = line.querySelector('[data-meta]') as HTMLElement
    expect([...meta.querySelectorAll('[data-wide]')].map((node) => node.textContent)).toEqual([
      '2026-08-31 09:00',
      'Somebody With A Rather Long Name',
    ])
    /* The badge is in the meta's text flow, so the date can share its line at
       220px — a flex item beside it cost the row a third line. */
    expect(meta.querySelector('[data-slot="badge"]')?.textContent).toBe('fffffff')
    expect(meta.className).not.toContain('whitespace-nowrap')
    expect(meta.className).toContain('overflow-wrap:anywhere')
    /* `min-w-min`, and NOT `min-w-0`: a zero minimum let the box be squeezed
       narrower than the badge, and the badge was drawn on under the presses
       — measured at 140 pixels, badge 8–66 and presses from 56, with the
       document exactly 140 wide throughout. See the comment on the box. */
    expect(meta.className).toContain('min-w-min')
    expect(meta.className).not.toMatch(/\bmin-w-0\b/)
    expect(meta.className).toContain('basis-0')

    const presses = line.querySelector('[data-presses]') as HTMLElement
    expect(presses.className).toContain('min-w-0')
    expect(presses.className).not.toContain('shrink-0')

    /* Armed: the words are back, on the same line, with the sentence under
       them, and nothing about that changed the classes that keep it inside. */
    fireEvent.click(screen.getByRole('button', { name: 'Go here' }))
    const armed = screen.getByRole('button', { name: 'Check out fffffff' })
    expect(presses.contains(armed)).toBe(true)
    expect(presses.contains(screen.getByRole('alert'))).toBe(true)
    expect(presses.className).not.toContain('shrink-0')
    for (const node of line.querySelectorAll('*')) {
      if (!node.className || typeof node.className !== 'string') continue
      if (!node.className.includes('whitespace-nowrap')) continue
      /* A button's label and the object-name badge are the only nowrap
         things here, and both are bounded by construction. */
      expect(node.matches('button, [data-slot="badge"]')).toBe(true)
      expect((node.textContent ?? '').length).toBeLessThanOrEqual(24)
    }
  })

  test('the only nowrap badges are the ones bounded by construction', () => {
    paint({ dirty: [dirty(' M', 'notes/a/really/quite/long/path/to/some/file/that/goes/on/notes.json')] })
    openUncommitted()
    for (const badge of document.querySelectorAll('[data-slot="badge"]')) {
      if (!badge.className.includes('whitespace-nowrap')) continue
      /* A branch name, a kind word, an eight-character object name. Anything
         longer than that in a nowrap badge is the 464px bug coming back. */
      expect((badge.textContent ?? '').length).toBeLessThanOrEqual(24)
    }
    /* And the path itself wraps. */
    const path = screen.getByText('notes/a/really/quite/long/path/to/some/file/that/goes/on/notes.json')
    expect(path.className).toContain('overflow-wrap:anywhere')
  })
})

/**
 * Under 320 pixels the pane says the same things in fewer letters.
 *
 * happy-dom does no layout and loads no stylesheet, so it cannot know how
 * wide the pane is. What it CAN see is that both forms of each thing are in
 * the DOM — the short one drawn small, the long one drawn wide — and which
 * is which: the short one is `aria-hidden` and the long one is what a screen
 * reader gets at every width. So these assert the WORDS of each form and the
 * attributes that keep the long one reachable, and leave the width to the
 * browser (`dev/small.drive.mjs`), which measured 24 pixels for line one at
 * 220 against 36 to 68 before.
 */
describe('under 320 pixels the pane says the same things in fewer letters', () => {
  const short = (root: ParentNode) => [...root.querySelectorAll('[data-terse]')].map((node) => node.textContent)
  const long = (root: ParentNode) => [...root.querySelectorAll('[data-wide]')].map((node) => node.textContent)

  test('a commit row shows an age and initials, with the full time and name a hover away', () => {
    paint({
      commits: [
        {
          sha: 'b'.repeat(40),
          short: 'bbbbbbb',
          /* Long enough ago that the age is in years whatever the clock says
             when this runs — an age that depends on the run is a test that
             passes on Tuesday. */
          at: '2020-08-31T09:00:00+03:00',
          who: 'Jaakko Matias Rajala',
          subject: 'x',
        },
      ],
    })
    const meta = document.querySelector('[data-meta]') as HTMLElement
    expect(short(meta)).toEqual([expect.stringMatching(/^\d+y$/), 'JR'])
    expect(long(meta)).toEqual(['2020-08-31 09:00', 'Jaakko Matias Rajala'])

    /* The short forms are not read out — a screen reader hears the long ones
       at every width — and the long ones are in the document, hidden from
       sight only, and only below the boundary. */
    for (const node of meta.querySelectorAll('[data-terse]')) {
      expect(node.getAttribute('aria-hidden')).toBe('true')
    }
    for (const node of meta.querySelectorAll('[data-wide]')) {
      expect(node.className).toMatch(/@max-(xs|sm)\/pane:sr-only/)
      expect(node.className).not.toContain('hidden')
    }

    /* The full values are reachable by pointing, verbatim. */
    const time = meta.querySelector('time') as HTMLElement
    expect(time.getAttribute('dateTime')).toBe('2020-08-31T09:00:00+03:00')
    expect(time.getAttribute('title')).toBe('2020-08-31T09:00:00+03:00')
    expect(meta.querySelector('[title="Jaakko Matias Rajala"]')).not.toBe(null)
  })

  test('the author goes long later than the time does, because a name is not bounded', () => {
    /* At 320 there is room for the full time beside initials, and not for a
       full name; at 384 there is room for both. Two boundaries, and this
       holds them apart so that "tidy them into one" is a deliberate act. */
    paint()
    const [time, who] = [...document.querySelectorAll('[data-meta] [data-terse]')]
    expect(time?.className).toContain('@xs/pane:hidden')
    expect(who?.className).toContain('@sm/pane:hidden')
  })

  test('an author git names strangely still gets initials, never an empty badge', () => {
    paint({
      commits: [
        { sha: 'c'.repeat(40), short: 'ccccccc', at: '2020-01-01T00:00:00Z', who: 'jaakko.rajala@example.com', subject: 'x' },
        { sha: 'd'.repeat(40), short: 'ddddddd', at: '2020-01-01T00:00:00Z', who: '山田太郎', subject: 'y' },
        { sha: 'e'.repeat(40), short: 'eeeeeee', at: '2020-01-01T00:00:00Z', who: '   ', subject: 'z' },
      ],
    })
    const who = [...document.querySelectorAll('[data-meta]')].map((meta) => short(meta)[1])
    expect(who).toEqual(['JR', '山', '?'])
  })

  test('a kind is a letter, and the six letters are six different letters', () => {
    /* The column exists so a person can tell a new file from a deleted one
       before pressing discard. Six words that shrink to five letters would
       be a column that lies at one row. */
    paint({
      dirty: [
        dirty(' M', 'm'),
        dirty('A ', 'n'),
        dirty(' D', 'd'),
        dirty('R ', 'r', 'q'),
        dirty('??', 'u'),
        { code: 'UU', path: 'c', from: null, kind: 'conflicted' },
      ],
    })
    openUncommitted()
    const badges = [...document.querySelectorAll('[data-kind]')]
    const letters = badges.map((badge) => badge.querySelector('[data-letter]')?.textContent)
    expect(letters).toEqual(['M', 'N', 'D', 'R', 'U', 'C'])
    expect(new Set(letters).size).toBe(6)
    for (const badge of badges) {
      const letter = badge.querySelector('[data-letter]') as HTMLElement
      const word = badge.querySelector('[data-word]') as HTMLElement
      expect(letter.getAttribute('aria-hidden')).toBe('true')
      expect(letter.className).toContain('@xs/pane:hidden')
      expect(word.className).toContain('@max-xs/pane:sr-only')
      /* And the word is on the badge itself, for a pointer. */
      expect(badge.getAttribute('title')).toBe(word.textContent)
    }
  })

  test('the tabs keep their names as icons: Uncommitted (4) is still Uncommitted (4)', () => {
    paint({ dirty: [dirty(' M', 'a'), dirty(' M', 'b'), dirty(' M', 'c'), dirty(' M', 'd')] })
    for (const name of ['Commits', 'Uncommitted (4)']) {
      const tab = screen.getByRole('tab', { name })
      expect(tab.querySelector('svg')).not.toBe(null)
      expect(tab.getAttribute('title')).toBe(name)
    }
    /* The count is drawn beside the icon, not hidden with the word. */
    const uncommitted = screen.getByRole('tab', { name: 'Uncommitted (4)' })
    const drawnSmall = [...uncommitted.querySelectorAll('span')].filter((span) => !span.className.includes('hidden '))
    expect(drawnSmall.map((span) => span.textContent)).toContain('4')
  })

  test('detached HEAD keeps its sentence for a reader and its object name for the eye', () => {
    paint({ head: { branch: null, detached: true, sha: 'c'.repeat(40) }, branches: [] })
    const badge = document.querySelector('[data-detached="yes"]') as HTMLElement
    expect(badge.textContent).toBe('detached at ccccccc')
    expect(badge.getAttribute('title')).toBe('detached at ccccccc')
    const words = badge.querySelector('span') as HTMLElement
    expect(words.textContent).toBe('detached at ')
    expect(words.className).toContain('@max-xs/pane:sr-only')
  })

  test('the subject is clamped to two lines under 320, with the whole of it a hover away', () => {
    /* Somebody asked whether the subject belonged in a tiny pane at all. It
       does — it is the only part of a row that says what the commit did —
       so it is clamped rather than dropped: two lines below 320 pixels, and
       `title` carries all of it. The text stays in the DOM in full, which is
       what a screen reader gets and what this reads. */
    const long = 'notes: 3 added on a/very/long/path.tex, checklist: ticked “something quite long indeed” for gh#105'
    paint({ commits: [{ sha: 'e'.repeat(40), short: 'eeeeeee', at: '2020-08-31T09:00:00Z', who: 'Jaakko', subject: long }] })
    const subject = screen.getByText(long)
    expect(subject.className).toContain('@max-xs/pane:line-clamp-2')
    expect(subject.className).not.toMatch(/(^|\s)line-clamp-/)
    expect(subject.getAttribute('title')).toBe(long)
    expect(subject.textContent).toBe(long)
  })

  test('the presses’ tooltips open above the row, not over the subject under it', () => {
    /* Measured before this held: at 220, 320 and 400 a tooltip under any of
       the three presses covered the whole subject — the one sentence a
       person reads before pressing. The side is asserted on the trigger's
       content because Radix draws the tooltip only on hover, which this
       harness cannot do; the browser measurement is in dev/small.drive.mjs. */
    paint()
    fireEvent.pointerMove(screen.getByRole('button', { name: 'Open' }))
    fireEvent.focus(screen.getByRole('button', { name: 'Open' }))
    const content = document.querySelector('[data-slot="tooltip-content"]')
    if (content) expect(content.getAttribute('data-side')).toBe('top')
    /* Whether or not the harness opened it, the default is what the row
       relies on: read from the module rather than remembered. */
    const source = require('node:fs').readFileSync(`${import.meta.dirname}/../src/components/ui/tooltip.tsx`, 'utf8') as string
    expect(source).not.toMatch(/side = 'bottom'/)
    expect(source.match(/side = 'top'/g)?.length).toBe(2)
  })

  test('an armed label wraps: "Overwrite <a long path>" is not a nowrap button', () => {
    /* Measured before this held: the restore box armed over a 54-character
       path set the body 73 pixels wider than a 220-pixel pane, because the
       button it turned into was shadcn's `whitespace-nowrap`. */
    paint()
    fireEvent.click(screen.getByRole('button', { name: 'Restore a file' }))
    const path = 'notes/a/really/quite/long/path/to/some/file/notes.json'
    fireEvent.change(screen.getByRole('textbox', { name: 'File to restore' }), { target: { value: path } })
    const rest = screen.getByRole('button', { name: 'Restore it' })
    expect(rest.className).toContain('whitespace-nowrap')
    fireEvent.click(rest)
    const armed = screen.getByRole('button', { name: `Overwrite ${path}` })
    expect(armed.className).not.toContain('whitespace-nowrap')
    expect(armed.className).toContain('whitespace-normal')
    expect(armed.className).toContain('overflow-wrap:anywhere')
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
