/**
 * Turning "these bytes changed" into "notes: 2 added on chapters/3_method.tex".
 *
 * ## What this is for, and the choice it comes out of
 *
 * Commits here are automatic and debounced. The user picked that over a timer
 * and over doing it by hand, and gave the reason to honour: **the value is
 * recovery, not a curated log.** Nobody is going to read this history for
 * pleasure. Somebody is going to read it once, in a hurry, having just lost
 * something, looking for the commit from before they lost it.
 *
 * That is exactly the reading a message like `update .kehikot` fails at. So the
 * message has to say what happened, which means the watcher cannot simply notice
 * that bytes moved — it has to **diff the JSON** and count what appeared and
 * disappeared.
 *
 * ## The rule about being wrong
 *
 * If a change cannot be described, this says something true and dull rather than
 * something invented. `notes: notes.json changed` is a fine commit message. A
 * confidently wrong one — `notes: 3 added` when three were removed — is worse
 * than no message at all, because the person reading it in a hurry believes it.
 * Every fallback below is on that side of the line, and the tests assert the
 * fallbacks as carefully as they assert the good cases.
 *
 * ## How it works without the other modules cooperating
 *
 * The four data modules need no change for this to work and must not be asked
 * for one — a describing scheme that required four repositories to agree would
 * be four repositories that can disagree. So this reads their files as ordinary
 * JSON and looks for one shape they all happen to have, because it is the shape
 * data has: **records with ids, living in a named container.**
 *
 *     { "notes":      [ { "id": "…", "path": "…", "body": "…" } ] }
 *     { "checklists": { "a49506e4": { "id": "…", "name": "…", "items": [ … ] } } }
 *     { "ticks":      { "a49506e4": { "gh#105": { "988e46b4": { "at": "…" } } } } }
 *     { "projects":   { "/Users/…": { "questions": [ { "id": "…", … } ] } } }
 *
 * An array of objects with ids, and an object whose keys are ids, are the same
 * thing written two ways, and both are recognised. The container's KEY is where
 * the noun comes from — `notes`, `items`, `questions`, `ticks` — which is why
 * this can say "3 questions added" without ever having heard of the Learning
 * module.
 *
 * ## The two things that make the messages read like sentences
 *
 * **Deepest wins.** Adding an item to a checklist changes the checklist too. If
 * both were reported, every message would say "1 checklist edited, 1 item added"
 * and the useful half would be second. So a change is dropped when an ancestor
 * of it is already being reported, and only the deepest description survives.
 *
 * **Ids are looked up across the whole file.** A tick is stored as
 * `ticks/<list>/<target>/<item>` and carries no text at all — the item's words
 * live somewhere else entirely, in `checklists/<list>/items/<item>`. So before
 * diffing, both versions of the file are indexed by id, and a change whose own
 * record has no label borrows the label of the record with the same id. That is
 * the whole of how `ticked "figures at 300dpi" for gh#105` gets written by a
 * program that has never heard of a checklist.
 */

/** The most a commit subject may be, before it is shortened from the left. */
export const MAX_SUBJECT = 72

/** The most a quoted label may be, before it is elided. */
const MAX_LABEL = 40

/** How many separate things one file's phrase names before it says "and N more". */
const MAX_GROUPS = 2

/* ------------------------------------------------------------------ *
 * Finding the records in a document
 * ------------------------------------------------------------------ */

/** One addressable thing inside a JSON document. */
interface Record_ {
  /** `checklists/a49506e4/items/988e46b4`. Stable across versions, which is what makes a diff possible. */
  key: string
  /** The container key it sits directly in: `items`, `notes`, `questions`, `ticks`. */
  noun: string
  /** The last path segment, which is the id where there is one. */
  id: string
  /** Its own scalar fields, with nested containers removed. What "edited" is decided on. */
  own: string
  /** The words a person would recognise it by, if it has any. */
  label: string | null
  /** Where it is about — a file, a passage, a target — if it says. */
  where: string | null
}

/**
 * Fields a record's words might be under, best first.
 *
 * A list rather than a guess, and the order is the order of specificity: `text`
 * and `question` are what a thing SAYS, `name` and `title` are what it is
 * CALLED, and `body` and `quoted` are long-form and come last because they are
 * usually a paragraph where the others are a line.
 */
const LABEL_FIELDS = ['text', 'question', 'name', 'title', 'label', 'summary', 'body', 'quoted', 'message']

/**
 * Fields that say what a record is ABOUT.
 *
 * `path` and `file` are the common ones; `anchor` and `section` are how a module
 * points into a document; `ref` and `epic` are how a target is spelled. Nested
 * once, because Learning keeps its location under `passage`.
 */
const WHERE_FIELDS = ['path', 'file', 'filename', 'anchor', 'section', 'ref', 'target', 'epic']
const WHERE_NESTS = ['passage', 'target', 'at', 'location']

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstString(node: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = node[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function labelOf(node: Record<string, unknown>): string | null {
  return firstString(node, LABEL_FIELDS)
}

function whereOf(node: Record<string, unknown>): string | null {
  const direct = firstString(node, WHERE_FIELDS)
  if (direct) return direct
  for (const nest of WHERE_NESTS) {
    const inner = node[nest]
    if (isObject(inner)) {
      const found = firstString(inner, WHERE_FIELDS)
      if (found) return found
    }
  }
  return null
}

/**
 * A record's own value, with nested record containers removed.
 *
 * This is what decides "edited": a checklist whose `name` changed is edited, and
 * a checklist that merely gained an item is not — the item is its own record and
 * will be reported on its own. Removing the containers before comparing is what
 * separates those two, and doing it here rather than at compare time means the
 * string is computed once per record rather than once per pair.
 *
 * Keys are sorted, because two JSON writers that disagree about key order would
 * otherwise produce a document where everything looks edited.
 */
function ownValue(node: unknown): string {
  if (!isObject(node)) return stable(node)
  const own: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (holdsRecords(value)) continue
    own[key] = value
  }
  return stable(own)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (isObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Does this value look like a container of records rather than a plain field? */
function holdsRecords(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((entry) => isObject(entry))
  if (isObject(value)) return Object.values(value).some((entry) => isObject(entry))
  return false
}

/**
 * How deep to walk. A bound rather than an opinion: a JSON file that arrived on
 * disk cannot be trusted not to be a thousand levels of nesting, and a walk that
 * recursed to the bottom of one would take the whole process down with it.
 */
const MAX_DEPTH = 12

/** How many records to collect from one file, so a large store cannot become an unbounded walk. */
const MAX_RECORDS = 20_000

/**
 * Every record in a document, keyed by its path.
 *
 * The walk descends through containers of records only. A field that happens to
 * be an object — `passage`, `options`, a settings blob — is not a container,
 * because none of its values are objects with a shape of their own, so the walk
 * stops there and the whole thing counts as part of its parent's own value.
 */
export function records(document: unknown): Map<string, Record_> {
  const found = new Map<string, Record_>()

  /**
   * `named` says whether this node's KEYS are field names or ids, and it is the
   * one piece of bookkeeping that makes a tick describable.
   *
   * A tick is stored three levels down: `ticks/<list>/<target>/<item>`. The two
   * levels in between are grouping — their keys are a checklist id and a target
   * string, neither of which is a noun for anything. Adopting a key as the noun
   * at every level would call a tick a `gh#105`, and there is no sentence that
   * can be built out of that.
   *
   * The signal is whether the node those keys belong to is itself a record. A
   * real record — a checklist, a note — has fields of its own, so its keys are
   * field names and `items` really is the noun for what is under it. A grouping
   * level has no fields of its own at all; it is nothing but a map from ids to
   * more structure, so its keys are ids and the noun stays whatever it was above.
   * The root counts as named, because a document's top-level keys are always
   * field names.
   *
   * Arrays are exempt: an array is always reached through a field name, so
   * `questions` is the noun whether or not the node holding it is a record.
   */
  const walk = (node: unknown, path: string, noun: string, depth: number, named: boolean) => {
    if (depth > MAX_DEPTH || found.size >= MAX_RECORDS) return

    if (Array.isArray(node)) {
      node.forEach((entry, index) => {
        if (!isObject(entry)) return
        const id = typeof entry.id === 'string' && entry.id ? entry.id : String(index)
        take(entry, `${path}/${id}`, noun, id, depth)
      })
      return
    }

    if (!isObject(node)) return

    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) {
        walk(value, `${path}${path ? '/' : ''}${key}`, key, depth + 1, true)
        continue
      }
      if (!isObject(value)) continue
      /*
       * An object is a MAP of records when its values are objects, and a plain
       * field when they are not. `{ "a49506e4": { … } }` is the first;
       * `{ "start": 1024, "end": 1180 }` is the second and is left alone as part
       * of whatever holds it.
       */
      if (holdsRecords(value)) {
        for (const [id, entry] of Object.entries(value)) {
          if (!isObject(entry)) continue
          take(entry, `${path}${path ? '/' : ''}${key}/${id}`, named ? key : noun, id, depth)
        }
      }
    }
  }

  /**
   * Register this node as a record, then keep walking through it.
   *
   * Registered only when it has fields of its own. A node that is nothing but a
   * map of ids to more structure is scaffolding rather than a thing that
   * changed: reporting it would mean a tick showing up as an edit to a checklist
   * id, described with whatever label that id happens to borrow — which is
   * exactly the confidently wrong message this file exists to avoid. It is still
   * walked through, because what is underneath it is real.
   *
   * The cost is that a record whose every field is a container, and which
   * therefore has nothing of its own, is invisible — its contents are reported
   * instead. That is the right way round: the contents are what a person
   * recognises.
   */
  const take = (node: Record<string, unknown>, key: string, noun: string, id: string, depth: number) => {
    if (found.size >= MAX_RECORDS) return
    const own = ownValue(node)
    const isRecord = own !== '{}'
    if (isRecord) {
      found.set(key, { key, noun, id, own, label: labelOf(node), where: whereOf(node) })
    }
    walk(node, key, noun, depth + 1, isRecord)
  }

  walk(document, '', '', 0, true)
  return found
}

/* ------------------------------------------------------------------ *
 * Diffing two documents
 * ------------------------------------------------------------------ */

export type Verb = 'added' | 'removed' | 'edited'

export interface Change {
  verb: Verb
  noun: string
  key: string
  label: string | null
  where: string | null
}

/**
 * What changed between two parsed documents.
 *
 * Ancestors are suppressed rather than reported: a change nested inside an added
 * or removed record is part of that record, and a container that is merely
 * "edited" because something below it moved is not edited at all — its own
 * fields are compared, with the containers taken out, precisely so that it is
 * not.
 */
export function changes(before: unknown, after: unknown): Change[] {
  const was = records(before)
  const now = records(after)

  /* Labels, borrowed across the whole file by id. A tick knows an item's id and
     not its words; the item knows its words. See the essay at the top. */
  const byId = new Map<string, Record_>()
  for (const record of [...was.values(), ...now.values()]) {
    if (record.label && !byId.has(record.id)) byId.set(record.id, record)
  }

  const out: Change[] = []
  const gone = new Set<string>()

  for (const [key, record] of now) {
    const before_ = was.get(key)
    if (!before_) {
      out.push(describe('added', record, byId))
      gone.add(key)
      continue
    }
    if (before_.own !== record.own) out.push(describe('edited', record, byId))
  }
  for (const [key, record] of was) {
    if (now.has(key)) continue
    out.push(describe('removed', record, byId))
    gone.add(key)
  }

  /* Deepest wins: anything sitting inside a record that was itself added or
     removed is part of that record and is not a change of its own. */
  const covered = (key: string) => {
    for (const ancestor of gone) {
      if (key !== ancestor && key.startsWith(`${ancestor}/`)) return true
    }
    return false
  }
  return out.filter((change) => !covered(change.key))
}

function describe(verb: Verb, record: Record_, byId: Map<string, Record_>): Change {
  const borrowed = record.label ? null : byId.get(record.id) ?? null
  /*
   * Where a borrowed record is used, the "where" comes from the record itself
   * where it has one, because that is the more specific fact: a tick's own path
   * names the TARGET it was filed against, and the item it borrows words from
   * knows nothing about that target.
   */
  const fromKey = targetFromKey(record.key)
  return {
    verb,
    noun: record.noun,
    key: record.key,
    label: record.label ?? borrowed?.label ?? null,
    where: record.where ?? fromKey ?? borrowed?.where ?? null,
  }
}

/**
 * The segment before the id, when it looks like something a person named.
 *
 * A tick lives at `ticks/<list>/<target>/<item>`, and the target — `gh#105`,
 * `paper:modes-are-modules` — is the one part of that path a person typed. The
 * list id beside it is a random hex string and is deliberately not offered: the
 * test is that the segment contains a character an id never would.
 */
function targetFromKey(key: string): string | null {
  const parts = key.split('/')
  const parent = parts[parts.length - 2]
  if (!parent) return null
  if (/^[0-9a-f]{6,}$/i.test(parent)) return null
  if (!/[#:.@!-]/.test(parent)) return null
  return parent
}

/* ------------------------------------------------------------------ *
 * Writing it down
 * ------------------------------------------------------------------ */

/**
 * Nouns whose change deserves a verb of its own.
 *
 * Kept to the cases where the generic verb would be actively misleading. A tick
 * that "was added" is a thing nobody says; it was ticked, and the word carries
 * the meaning of the act. Everything not listed gets `added`, `removed` and
 * `edited`, which are true of anything.
 */
const VERBS: Record<string, Partial<Record<Verb, string>>> = {
  ticks: { added: 'ticked', removed: 'unticked' },
  answers: { added: 'answered' },
}

/** Nouns whose singular is not the plural minus an s. Short on purpose. */
const SINGULARS: Record<string, string> = {
  entries: 'entry',
  histories: 'history',
  questions: 'question',
  notes: 'note',
  items: 'item',
  checklists: 'checklist',
  journeys: 'journey',
  ticks: 'tick',
  steps: 'step',
}

function singular(noun: string): string {
  if (SINGULARS[noun]) return SINGULARS[noun]
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`
  if (noun.endsWith('s') && !noun.endsWith('ss')) return noun.slice(0, -1)
  return noun
}

function quote(label: string): string {
  const one = label.replace(/\s+/g, ' ').trim()
  return one.length > MAX_LABEL ? `“${one.slice(0, MAX_LABEL - 1)}…”` : `“${one}”`
}

/**
 * A location, shortened for a subject line.
 *
 * Made relative to the project where it is under it — an absolute path in a
 * commit subject is the same fact with sixty useless characters in front of it —
 * and then shortened from the LEFT, keeping the file name, because the file name
 * is the part somebody scanning a log recognises.
 */
export function place(where: string, projectPath: string | null): string {
  let value = where
  if (projectPath && value.startsWith(`${projectPath}/`)) value = value.slice(projectPath.length + 1)
  if (value.length <= 34) return value
  const parts = value.split('/')
  const tail = parts[parts.length - 1] ?? value
  const above = parts[parts.length - 2]
  if (above && `${above}/${tail}`.length <= 34) return `${above}/${tail}`
  return tail
}

interface Group {
  verb: Verb
  noun: string
  where: string | null
  labels: string[]
  count: number
}

function group(list: Change[], projectPath: string | null): Group[] {
  const groups = new Map<string, Group>()
  for (const change of list) {
    const where = change.where ? place(change.where, projectPath) : null
    const key = `${change.verb} ${change.noun} ${where ?? ''}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      if (change.label) existing.labels.push(change.label)
      continue
    }
    groups.set(key, { verb: change.verb, noun: change.noun, where, labels: change.label ? [change.label] : [], count: 1 })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

/**
 * One group as a phrase.
 *
 * The two shapes are deliberate and they are the difference between a message
 * that reads and one that is a report:
 *
 * - **One thing, and it has words:** name the words. `ticked “figures at
 *   300dpi” for gh#105`. Somebody scanning a log recognises the sentence they
 *   typed.
 * - **Several things:** count them. `3 questions added on 1_introduction.tex`.
 *   Three quoted labels would not fit and picking one of the three to quote
 *   would be a message that describes a third of what the commit contains.
 *
 * `module` is passed in so the noun can be dropped when it merely repeats the
 * folder the commit is already labelled with: `notes: 2 notes added` says notes
 * twice, and `notes: 2 added` says it once.
 */
function phrase(one: Group, module: string): string {
  const verb = VERBS[one.noun]?.[one.verb] ?? one.verb
  const preposition = one.verb === 'added' || one.verb === 'edited' ? 'on' : 'from'
  const at = one.where ? ` ${one.noun === 'ticks' ? 'for' : preposition} ${one.where}` : ''

  if (one.count === 1 && one.labels[0]) {
    /* `ticked "…"` reads; `1 tick ticked "…"` does not. Where the noun has a verb
       of its own, the verb has already said what kind of thing it was. */
    if (VERBS[one.noun]?.[one.verb]) return `${verb} ${quote(one.labels[0])}${at}`
    const name = one.noun === module ? '' : `${singular(one.noun)} `
    return `${name}${quote(one.labels[0])} ${verb}${at}`
  }

  const name = one.noun === module ? '' : `${one.count === 1 ? singular(one.noun) : one.noun} `
  return `${one.count} ${name}${verb}${at}`.replace(/\s+/g, ' ')
}

/** What one changed file is. `notes/notes.json` and `checklist/checklists.json` are two of these. */
export interface FileChange {
  /** The path inside the `.kehikot` repository. */
  path: string
  /** What git said happened to it: `A`, `M`, `D`. */
  status: 'A' | 'M' | 'D'
  /** The file as HEAD has it, or null when HEAD does not have it. */
  before: string | null
  /** The file as it is on disk now, or null when it is gone. */
  after: string | null
}

function parse(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** The first path segment: the module folder the file belongs to. */
function moduleOf(path: string): string {
  const first = path.split('/')[0]
  return first && first !== path ? first : ''
}

function basename(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

/**
 * One file's phrase, or a true dull sentence when it cannot be described.
 *
 * Every `return` in here that is not a described change is one of those dull
 * sentences, and they are the point rather than the leftovers. A file that is
 * not JSON, a file whose JSON does not parse, a file whose records did not move
 * — each gets a sentence that is exactly as specific as what is actually known.
 */
export function describeFile(file: FileChange, projectPath: string | null): string {
  const module = moduleOf(file.path)
  const label = module ? `${module}: ` : ''
  const name = basename(file.path)

  if (file.status === 'A' && !module) return `${name} added`
  if (file.status === 'D') return `${label}${name} removed`

  const before = parse(file.before)
  const after = parse(file.after)

  /* `undefined` is "there was text and it is not JSON". Both halves have to
     parse for a diff to mean anything, and a file that is not JSON at all is a
     perfectly ordinary thing to find in a data folder. */
  if (before === undefined || after === undefined || after === null) {
    return `${label}${name} ${file.status === 'A' ? 'added' : 'changed'}`
  }

  const list = changes(before, after)
  if (!list.length) {
    /* The bytes moved and no record did: a reformat, a key order, a timestamp on
       the store itself. Said plainly rather than dressed up. */
    return `${label}${name} ${file.status === 'A' ? 'added' : 'rewritten with no entries changed'}`
  }

  const groups = group(list, projectPath)
  const shown = groups.slice(0, MAX_GROUPS).map((one) => phrase(one, module))
  const rest = groups.slice(MAX_GROUPS).reduce((sum, one) => sum + one.count, 0)
  if (rest) shown.push(`${rest} more`)
  return `${label}${shown.join(', ')}`
}

/**
 * The whole commit message for one batch of changed files.
 *
 * ## One file, one line
 *
 * The common case by a distance: somebody is writing notes, or ticking a
 * checklist, and one file moved. The subject IS the description and there is no
 * body, because a body repeating the subject is a body nobody reads.
 *
 * ## Several files, a subject and a body
 *
 * Two modules touched in the same few seconds is a real thing — an agent adding
 * questions while a person ticks items — and cramming both into seventy
 * characters would truncate both. So the subject counts them honestly and the
 * body carries one line per file, in full. A person scanning the log sees which
 * modules moved; a person who has opened the commit sees what happened in each.
 *
 * The subject is shortened rather than truncated: if one file's phrase does not
 * fit, the file's own name is used, which is shorter and still true.
 */
export function commitMessage(files: FileChange[], projectPath: string | null): string {
  const described = files.map((file) => ({ file, said: describeFile(file, projectPath) }))

  if (!described.length) return 'nothing changed'

  if (described.length === 1) {
    const only = described[0]!
    return fit(only.said, only.file)
  }

  /*
   * Only real module folders are named, and a file at the root of the data
   * folder contributes none.
   *
   * The first commit this module ever makes contains its own `.gitignore`, which
   * has no module folder, and naming it in the list produced `2 files changed in
   * .gitignore, notes` — a subject that reads as though `.gitignore` were a
   * module. It is not, and the body already says what happened to it, so the
   * subject counts and does not name it.
   */
  const modules = [...new Set(described.map((one) => moduleOf(one.file.path)).filter(Boolean))]
  const names = modules.length <= 3 ? modules.join(', ') : `${modules.slice(0, 3).join(', ')} and ${modules.length - 3} more`
  const subject = modules.length ? `${described.length} files changed in ${names}` : `${described.length} files changed`
  const body = described.map((one) => one.said).join('\n')
  return `${fitPlain(subject)}\n\n${body}`
}

function fit(said: string, file: FileChange): string {
  if (said.length <= MAX_SUBJECT) return said
  const module = moduleOf(file.path)
  const fallback = `${module ? `${module}: ` : ''}${basename(file.path)} changed`
  /* The full sentence is not thrown away — it goes into the body, where there is
     room for it. A subject that fits and a body that is complete beats one
     truncated line. */
  return `${fitPlain(fallback)}\n\n${said}`
}

function fitPlain(subject: string): string {
  return subject.length <= MAX_SUBJECT ? subject : `${subject.slice(0, MAX_SUBJECT - 1)}…`
}
