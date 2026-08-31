import { describe, expect, test } from 'bun:test'

import { changes, commitMessage, describeFile, place, records, type FileChange } from '../git/describe.ts'

/**
 * What a commit message says, asserted on the shapes the four data modules
 * actually write.
 *
 * The fixtures below are cut down from real files in
 * `<project>/.kehikot/<module>/`, keeping the structure and throwing away the
 * bulk. That matters: the whole claim of `describe.ts` is that it reads those
 * shapes without the modules cooperating, and a fixture invented to suit the
 * describer would test nothing.
 *
 * The tests that matter most here are the ones asserting a DULL message. It is
 * easy to make a describer that says something good about the case it was
 * written for; the failure that costs somebody their afternoon is one that says
 * something confident and wrong about a case it was not.
 */

const NOTES_BEFORE = JSON.stringify({
  version: 1,
  notes: [{ id: 'n1', path: '/p/chapters/3_method.tex', body: 'the first note' }],
})

const NOTES_AFTER = JSON.stringify({
  version: 1,
  notes: [
    { id: 'n1', path: '/p/chapters/3_method.tex', body: 'the first note' },
    { id: 'n2', path: '/p/chapters/3_method.tex', body: 'the second' },
    { id: 'n3', path: '/p/chapters/3_method.tex', body: 'the third' },
  ],
})

const CHECKLIST_BEFORE = JSON.stringify({
  checklists: {
    a1: {
      id: 'a1',
      name: 'Thesis paper checklist',
      items: [
        { id: 'i1', text: 'figures at 300dpi' },
        { id: 'i2', text: 'every table has a caption' },
      ],
    },
  },
  ticks: {},
})

const CHECKLIST_AFTER = JSON.stringify({
  checklists: {
    a1: {
      id: 'a1',
      name: 'Thesis paper checklist',
      items: [
        { id: 'i1', text: 'figures at 300dpi' },
        { id: 'i2', text: 'every table has a caption' },
      ],
    },
  },
  ticks: { a1: { 'gh#105': { i1: { at: '2026-08-31T09:00:00Z', by: 'Claude' } } } },
})

const LEARNING_BEFORE = JSON.stringify({
  projects: {
    '/p': { questions: [{ id: 'q1', question: 'What is a manifest?', passage: { path: 'chapters/1_introduction.tex' } }] },
  },
})

const LEARNING_AFTER = JSON.stringify({
  projects: {
    '/p': {
      questions: [
        { id: 'q1', question: 'What is a manifest?', passage: { path: 'chapters/1_introduction.tex' } },
        { id: 'q2', question: 'What does scope decide?', passage: { path: 'chapters/1_introduction.tex' } },
        { id: 'q3', question: 'Why one origin?', passage: { path: 'chapters/1_introduction.tex' } },
        { id: 'q4', question: 'Where does data live?', passage: { path: 'chapters/1_introduction.tex' } },
      ],
    },
  },
})

const file = (path: string, before: string | null, after: string | null): FileChange => ({
  path,
  status: before === null ? 'A' : after === null ? 'D' : 'M',
  before,
  after,
})

describe('finding records without the modules cooperating', () => {
  test('an array of objects with ids is a container, keyed by id', () => {
    const found = records(JSON.parse(NOTES_AFTER))
    expect([...found.keys()]).toEqual(['notes/n1', 'notes/n2', 'notes/n3'])
    expect(found.get('notes/n2')?.noun).toBe('notes')
    expect(found.get('notes/n2')?.label).toBe('the second')
  })

  test('an object keyed by id is the same thing written the other way', () => {
    const found = records(JSON.parse(CHECKLIST_BEFORE))
    expect(found.has('checklists/a1')).toBe(true)
    expect(found.has('checklists/a1/items/i1')).toBe(true)
    expect(found.get('checklists/a1/items/i1')?.noun).toBe('items')
  })

  test('a plain object field is not a container and does not become a record', () => {
    const found = records({ notes: [{ id: 'n1', passage: { start: 1, end: 2 }, body: 'x' }] })
    expect([...found.keys()]).toEqual(['notes/n1'])
  })
})

describe('the three messages the design asked for', () => {
  test('notes added, counted, on the file they are about', () => {
    expect(describeFile(file('notes/notes.json', NOTES_BEFORE, NOTES_AFTER), '/p')).toBe(
      'notes: 2 added on chapters/3_method.tex',
    )
  })

  test('a tick names the item it ticked and the target it was filed against', () => {
    expect(describeFile(file('checklist/checklists.json', CHECKLIST_BEFORE, CHECKLIST_AFTER), '/p')).toBe(
      'checklist: ticked “figures at 300dpi” for gh#105',
    )
  })

  test('questions are named by their container key, not by the module', () => {
    expect(describeFile(file('learning/questions.json', LEARNING_BEFORE, LEARNING_AFTER), '/p')).toBe(
      'learning: 3 questions added on chapters/1_introduction.tex',
    )
  })
})

describe('the deepest change is the one reported', () => {
  test('adding an item does not also report the checklist as edited', () => {
    const after = JSON.parse(CHECKLIST_BEFORE) as { checklists: Record<string, { items: unknown[] }> }
    after.checklists.a1!.items.push({ id: 'i3', text: 'the bibliography compiles' })
    const list = changes(JSON.parse(CHECKLIST_BEFORE), after)
    expect(list).toHaveLength(1)
    expect(list[0]?.noun).toBe('items')
    expect(list[0]?.verb).toBe('added')
  })

  test('an item added inside a NEW checklist is covered by the checklist', () => {
    const after = JSON.parse(CHECKLIST_BEFORE) as { checklists: Record<string, unknown> }
    after.checklists.b2 = { id: 'b2', name: 'A new list', items: [{ id: 'j1', text: 'a first item' }] }
    const list = changes(JSON.parse(CHECKLIST_BEFORE), after)
    expect(list.map((one) => one.key)).toEqual(['checklists/b2'])
  })

  test('renaming a checklist IS an edit of the checklist', () => {
    const after = JSON.parse(CHECKLIST_BEFORE) as { checklists: Record<string, { name: string }> }
    after.checklists.a1!.name = 'Something else entirely'
    const list = changes(JSON.parse(CHECKLIST_BEFORE), after)
    expect(list).toHaveLength(1)
    expect(list[0]?.verb).toBe('edited')
    expect(list[0]?.noun).toBe('checklists')
  })

  test('removals are counted and said as removals', () => {
    expect(describeFile(file('notes/notes.json', NOTES_AFTER, NOTES_BEFORE), '/p')).toBe(
      'notes: 2 removed from chapters/3_method.tex',
    )
  })
})

describe('true and dull, where nothing else is honest', () => {
  test('a file that is not JSON is said to have changed and nothing more', () => {
    expect(describeFile(file('notes/scratch.md', 'hello', 'hello there'), '/p')).toBe('notes: scratch.md changed')
  })

  test('JSON that no longer parses does not become a count', () => {
    expect(describeFile(file('notes/notes.json', NOTES_BEFORE, '{ broken'), '/p')).toBe('notes: notes.json changed')
  })

  test('bytes that moved while no record did says exactly that', () => {
    const reformatted = JSON.stringify(JSON.parse(NOTES_BEFORE), null, 4)
    expect(describeFile(file('notes/notes.json', NOTES_BEFORE, reformatted), '/p')).toBe(
      'notes: notes.json rewritten with no entries changed',
    )
  })

  test('a deleted file is a deletion and is never described from its content', () => {
    expect(describeFile(file('notes/notes.json', NOTES_BEFORE, null), '/p')).toBe('notes: notes.json removed')
  })

  test('a new file with no readable content is an addition and no more', () => {
    expect(describeFile(file('journeys/journeys.json', null, 'not json'), '/p')).toBe('journeys: journeys.json added')
  })
})

describe('the subject line stays a subject line', () => {
  test('a long phrase moves into the body and the subject names the file', () => {
    const before = JSON.stringify({ notes: [] })
    const after = JSON.stringify({
      notes: Array.from({ length: 3 }, (_, index) => ({
        id: `n${index}`,
        body: 'x',
        path: `/p/a/very/deeply/nested/directory/structure/file-number-${index}.tex`,
      })),
    })
    const message = commitMessage([file('notes/notes.json', before, after)], '/p')
    const [subject = '', blank, ...rest] = message.split('\n')
    expect(subject.length).toBeLessThanOrEqual(72)
    expect(blank).toBe('')
    expect(rest.join('\n').length).toBeGreaterThan(0)
  })

  test('several files get a counted subject and one body line each', () => {
    const message = commitMessage(
      [
        file('notes/notes.json', NOTES_BEFORE, NOTES_AFTER),
        file('checklist/checklists.json', CHECKLIST_BEFORE, CHECKLIST_AFTER),
      ],
      '/p',
    )
    const lines = message.split('\n')
    expect(lines[0]).toBe('2 files changed in notes, checklist')
    expect(lines[0]!.length).toBeLessThanOrEqual(72)
    expect(lines[2]).toBe('notes: 2 added on chapters/3_method.tex')
    expect(lines[3]).toBe('checklist: ticked “figures at 300dpi” for gh#105')
  })

  test('a file at the root of the data folder is counted, never named as a module', () => {
    /* The first commit this module makes contains its own `.gitignore`, which has
       no module folder. Naming it in the subject read as though `.gitignore` were
       a module — measured on the first scratch project this module ever made. */
    const message = commitMessage(
      [file('.gitignore', null, '.DS_Store\n'), file('notes/notes.json', null, '{"notes":[]}')],
      '/p',
    )
    const lines = message.split('\n')
    expect(lines[0]).toBe('2 files changed in notes')
    expect(lines[2]).toBe('.gitignore added')
    expect(lines[3]).toBe('notes: notes.json added')
  })

  test('files with no module at all are counted and nothing is invented', () => {
    const message = commitMessage([file('a.txt', null, 'x'), file('b.txt', null, 'y')], '/p')
    expect(message.split('\n')[0]).toBe('2 files changed')
  })

  test('nothing changed is said rather than guessed at', () => {
    expect(commitMessage([], '/p')).toBe('nothing changed')
  })
})

describe('places are shortened from the left, keeping the file name', () => {
  test('a path under the project loses the project', () => {
    expect(place('/p/chapters/3_method.tex', '/p')).toBe('chapters/3_method.tex')
  })

  test('a long path keeps the last two segments where they fit', () => {
    expect(place('/p/data/papers/modes-are-modules/chapters/bridge.tex', '/p')).toBe('chapters/bridge.tex')
  })

  test('a path outside the project is left alone rather than mangled', () => {
    expect(place('gh#105', '/p')).toBe('gh#105')
  })
})
