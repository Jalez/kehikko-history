import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

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

  test('the select is disabled while anything is uncommitted, and says why', () => {
    paint({ dirty: [dirty(' M', 'notes/notes.json'), dirty('??', 'checklist/new.json')] })
    const select = screen.getByRole('combobox', { name: 'Branch' })
    expect(select.hasAttribute('disabled')).toBe(true)
    expect(select.getAttribute('data-frozen')).toBe('dirty')
    /* One line, pointing at the tab where the changes are — not git's refusal
       rewritten. Git's own words arrive from `switchTo` for the cases this
       row cannot see coming. */
    expect(document.body.textContent).toContain('Switching branches is off while 2 changes are uncommitted')
    expect(document.body.textContent).toContain('in the Uncommitted tab')
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
    const words = [...document.querySelectorAll('[data-kind]')].map((node) => node.textContent)
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
  test('an arm over a dirty tree says the move will be refused rather than done', () => {
    paint({ dirty: [dirty(' M', 'notes/notes.json')] })
    fireEvent.click(screen.getByRole('button', { name: 'Go here' }))
    expect(screen.getByRole('alert').textContent).toContain('refuse this rather than do it')
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
