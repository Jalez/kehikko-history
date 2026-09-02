import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'

import { message as checkMessage } from './names.ts'
import type { GitRunner } from './run.ts'
import type { Where } from './repo.ts'

/**
 * Look before you `init`: what the repository AROUND `.kehikot` already says
 * about it.
 *
 * ## What went wrong, written down before the fix
 *
 * This module used to run `git init` inside `<project>/.kehikot/` the moment a
 * pane learned which project was open. It did that in two of the user's
 * projects without being asked, and one of them was the one that mattered: a
 * thesis at `…/CS-DEGREE/05_drafts/thesis_latex`, several levels inside a
 * repository that — earlier the same day, deliberately, through the host's
 * "keep .kehikot in git" setting — had been made to TRACK that folder. So there
 * were two repositories claiming the same files. Git tolerated it only because
 * the outer one had them first; anything added under `.kehikot` afterwards
 * would have begun behaving in ways nobody could have explained.
 *
 * The mistake was not `git init`. Starting a history for a folder that has none
 * is the reason this module exists, and it is still right. The mistake was
 * doing it **without looking first**, and the thing that had to be looked at is
 * a question with more than two answers.
 *
 * ## The test, and why it is four answers
 *
 * "Is `.kehikot` in a git repository?" is not the question. Nearly every project
 * is in one. The question is what that repository has already been told about
 * this folder, and there are several ways for it to have been told:
 *
 * - **`alone`** — there is no repository above `.kehikot` at all. Nobody has
 *   decided anything, because there is nothing to decide with. A history of its
 *   own is the only history available, and making one takes nothing away.
 *
 * - **`declined`** — there is a repository above it and a `.gitignore` rule
 *   covers the folder. The enclosing repository has been told, in writing, not
 *   to keep this. Its history will never contain these files no matter how long
 *   anybody waits, so a history of its own is not a second history — it is the
 *   only one there will be.
 *
 * - **`kept`** — there is a repository above it and it TRACKS files in the
 *   folder. Somebody has already chosen where this folder's history lives, and
 *   the answer they chose is "here, with the rest of my work". A second
 *   repository over the top of that is the fault above. This module does not
 *   make one, ever, and there is no flag, setting or press that makes it.
 *
 * And a fourth, which the three-answer version misses and which is exactly the
 * state the thesis was in for the few minutes between the setting being switched
 * and the first commit:
 *
 * - **`offered`** — inside a repository, no ignore rule, and nothing tracked
 *   yet. The enclosing repository has NOT declined this folder; it simply has
 *   not been given it. `git status` there shows it as untracked, and the next
 *   `git add` its owner types will pick it up. Initialising here would be the
 *   original fault a few minutes early, so this module does not.
 *
 * ## `git` is asked, rather than reimplemented
 *
 * `git check-ignore` and `git ls-files` answer the two questions directly.
 * Neither is reimplemented here, and that is deliberate: `.gitignore` has
 * negations, directory-only rules, `**`, per-directory files, `core.excludesFile`
 * and `.git/info/exclude`, and a hand-rolled matcher that is right about eight
 * of those is a program that is confidently wrong about the ninth in somebody's
 * thesis. The cost is two `spawn`s per look, which is nothing beside that.
 *
 * ## The order the two questions are asked in, which matters
 *
 * Tracked first, ignored second. A path can be BOTH — a file already committed
 * and a rule added afterwards — and in that state git keeps tracking it, the
 * ignore rule does nothing, and the honest answer is `kept`. Asking
 * `check-ignore` first would answer `declined` for a folder whose files are in
 * somebody's history right now, which is the wrong answer to the only question
 * that matters here.
 *
 * ## Where the walk starts, which also matters
 *
 * `rev-parse --show-toplevel` is run from the PROJECT directory and never from
 * `.kehikot`. Run from inside `.kehikot` it would answer `.kehikot` itself the
 * moment this module had already made it a repository — so the check would say
 * "no enclosing repository" precisely in the case it exists to catch, which is
 * the second time it runs.
 */

/** What the repository around `.kehikot` has already said about it. */
export type Stance =
  /** No git repository anywhere above the folder. */
  | { at: 'alone' }
  /** Inside a repository, and a `.gitignore` rule covers the folder. */
  | { at: 'declined'; root: string }
  /** Inside a repository that already tracks files in the folder. */
  | { at: 'kept'; root: string; spec: string }
  /** Inside a repository, not ignored, nothing tracked yet. */
  | { at: 'offered'; root: string; spec: string }
  /** Git could not be asked, so nothing is assumed. Never treated as `alone`. */
  | { at: 'unreadable'; why: string }

/**
 * The one sentence each stance is worth, written for the person in the pane.
 *
 * Kept beside the type rather than in the view, because these sentences are also
 * what an agent reads out of the MCP door, and two copies of a sentence about
 * somebody's repository is one copy that goes stale.
 *
 * Every one of them **names the actual path**. The sentence this replaced said
 * "this project's data folder", and the person who read it owned a folder
 * called `data/` and reasonably concluded that a program had started a
 * repository in it. It had not; it had never touched `data/`. A sentence about
 * a folder that does not say which folder is a sentence that will be read as
 * being about a different one.
 */
export function saying(stance: Stance, kehikot: string): string {
  switch (stance.at) {
    case 'alone':
      return (
        `${kehikot} — the folder your modules keep this project’s material in — is not inside any git repository, `
        + 'so nothing is keeping a history of it. Starting one here makes a repository in that folder and nowhere '
        + 'else.'
      )
    case 'declined':
      return (
        `${kehikot} is inside the repository at ${stance.root}, and that repository is told to ignore it — a `
        + '.gitignore rule covers the folder, so its files will never appear in that history. Starting one here '
        + 'makes a repository in that folder and nowhere else.'
      )
    case 'kept':
      return (
        `${kehikot} is already in the history of the repository at ${stance.root}: git is tracking files in it. `
        + 'Somebody has already chosen where this folder’s history lives, so this module has not started a second '
        + 'one — two repositories over the same files is a state git only half tolerates. A commit here goes into '
        + 'that repository, carrying that folder and nothing else, and only when you press for one.'
      )
    case 'offered':
      return (
        `${kehikot} is inside the repository at ${stance.root} and nothing is keeping it out — there is no ignore `
        + 'rule for it, so `git status` there lists it as untracked and the next `git add` you type picks it up. '
        + 'This module has not started a repository inside it: that would put a second history over files the one '
        + 'you already have is willing to take. Either commit it into that repository from here, or add a .gitignore '
        + 'rule for it and this module will keep a history of its own.'
      )
    case 'unreadable':
      return stance.why
  }
}

/**
 * Whether this module may make `.kehikot` a repository of its own.
 *
 * Two of the five stances, and the reason is one sentence: a history of its own
 * is right exactly when the enclosing repository is not going to keep one.
 */
export function mayInit(stance: Stance): boolean {
  return stance.at === 'alone' || stance.at === 'declined'
}

/** The pathspec naming `.kehikot` inside the repository above it. Never anything wider. */
function relativeTo(root: string, kehikot: string): string | null {
  const rel = relative(root, kehikot)
  /*
   * An empty relative path would mean `.kehikot` IS the repository root, and the
   * pathspec would then be the whole repository — the one thing this file exists
   * to make impossible. It cannot happen for a folder that is by construction a
   * child of the project; it is checked anyway, because "it cannot happen" is
   * how a whole-repository commit gets written. `..` means the folder is outside
   * the repository the project is in, which is not a shape this module reasons
   * about, so it refuses rather than guesses.
   */
  if (!rel || rel === '.' || rel.split(/[/\\]/)[0] === '..') return null
  return rel.split('\\').join('/')
}

export async function surrounding(where: Where, git: GitRunner): Promise<Stance> {
  /* From the project, never from `.kehikot`. See the essay. */
  const top = await git(['rev-parse', '--show-toplevel'], { cwd: where.project })
  if (!top.ok || !top.out.trim()) return { at: 'alone' }
  const root = top.out.trim()

  const rel = relativeTo(root, where.kehikot)
  if (rel === null) {
    return {
      at: 'unreadable',
      why:
        `${where.kehikot} could not be placed inside the repository at ${root}, so this module will not decide `
        + 'anything about it. It has not started a history there and it will not commit there.',
    }
  }
  /* `:(literal,top)` — literal so a folder with a `*` or a `!` in a name above it
     is a folder and not a pattern, top so it is read from the repository root
     rather than from wherever git was invoked. */
  const spec = `:(literal,top)${rel}`

  /* Tracked first. A folder can be both tracked and covered by a rule, and in
     that state git keeps tracking it and the rule does nothing. */
  const tracked = await git(['ls-files', '-z', '--', spec], { cwd: root })
  if (!tracked.ok) {
    return {
      at: 'unreadable',
      why:
        `git could not say whether ${where.kehikot} is in the history at ${root}: `
        + `${(tracked.err || tracked.out).trim() || 'it said nothing'}. Nothing was started and nothing was `
        + 'committed — this module does not initialise a repository on an answer it did not get.',
    }
  }
  if (tracked.out.replace(/\0/g, '').trim()) return { at: 'kept', root, spec }

  /*
   * `check-ignore --quiet`: exit 0 means a rule matches. The plain relative path
   * rather than the pathspec, because this subcommand takes pathnames; `--`
   * keeps it a name whatever it begins with.
   */
  const ignored = await git(['check-ignore', '--quiet', '--', rel], { cwd: root })
  if (ignored.code === 0) return { at: 'declined', root }

  return { at: 'offered', root, spec }
}

/* ------------------------------------------------------------------ *
 * Committing into somebody else's repository
 * ------------------------------------------------------------------ */

/**
 * A commit into the repository the project is already in, holding `.kehikot`
 * and nothing else.
 *
 * ## This is a bigger act than the rest of this module, and is treated as one
 *
 * Everywhere else, this module commits to a repository it made, containing only
 * data its own modules wrote. Here it writes into a history full of work that
 * has nothing to do with it — the thesis this was written against sits in a
 * repository that also holds coursework, notes and scripts — next to whatever
 * its owner had half-finished at the moment the commit was made.
 *
 * So there is **no automatic commit in this direction, ever.** No debounce, no
 * timer, no watcher, and no MCP tool that reaches it. The `.kehikot` repository
 * this module makes gets a commit three seconds after a write because nobody
 * else is looking at it and the value there is recovery; somebody's own
 * repository gets a commit when they press for one, because the value there is
 * a log they read, and forty machine-written commits a day is not one.
 *
 * That is also why refusing costs nothing: in this stance the person's own
 * repository is already keeping the folder, so their next ordinary commit
 * carries it. The button is a convenience, not the history.
 *
 * ## The rules, taken from the paper module rather than rediscovered
 *
 * `kehikko-paper`'s `git.ts` worked this out first, against the same repository,
 * and every one of its conclusions applies here unchanged:
 *
 * - **By pathspec, with `--only`.** `-- :(literal,top)<.kehikot>` makes git build
 *   the commit from HEAD plus the working-tree state of those paths alone. What
 *   is staged anywhere else is neither consulted nor recorded, so somebody who
 *   had a file staged still has it staged afterwards.
 * - **`git add` with the SAME pathspec first**, because a folder that has never
 *   been committed is untracked and pathspec-mode commit refuses it. Never
 *   `git add -A`, never `git add .`, and never a path this module did not
 *   compute itself.
 * - **Refusals rather than guesses.** Detached HEAD, a merge or rebase in
 *   progress, no configured identity — each is a state where a commit made by a
 *   program is a commit somebody has to undo.
 * - **No `--no-verify`.** A repository with a pre-commit hook has one because
 *   its owner wanted one. A hook that fails takes the commit with it, and that
 *   is reported with the hook's own words.
 *
 * The one deliberate difference from the rest of THIS module: `run.ts` prefixes
 * every invocation with `-c core.hooksPath=`, which disables hooks. That is
 * right for a repository this module created and nobody has configured, and
 * wrong here — so `hooked` below points `core.hooksPath` back at the
 * repository's own default for these calls.
 */
export interface Landed {
  ok: boolean
  said: string
  sha: string | null
}

/**
 * `core.hooksPath` put back to the repository's own default for one call.
 *
 * The prefix in `run.ts` exists because a module committing on a TIMER must not
 * run arbitrary code on a timer. Nothing in this file is on a timer — every
 * commit it makes is one a person pressed for — and the repository is theirs,
 * with their hooks in it. A later `-c` wins over an earlier one, so this is
 * appended rather than the prefix being made conditional, which keeps the prefix
 * one unconditional thing.
 */
export const hooked = ['-c', 'core.hooksPath=.git/hooks']

/**
 * Every reason this repository is not one to commit into right now, or null.
 *
 * Exported because `commitPaths` in `repo.ts` — the Uncommitted tab's commit,
 * made into whichever repository is in front — runs the same three checks
 * before writing into somebody's own repository, and a second copy of "is HEAD
 * detached, is a merge half-done, is there an identity" is a copy that drifts.
 */
export async function refusal(root: string, git: GitRunner): Promise<string | null> {
  /* `symbolic-ref` rather than `rev-parse --abbrev-ref`, because it also answers
     correctly in a repository with no commits yet — where HEAD points at a
     branch that does not exist. That is an ordinary state and not a refusal: the
     commit made there is simply the first one. */
  const head = await git(['symbolic-ref', '--quiet', 'HEAD'], { cwd: root })
  if (!head.ok) {
    const at = await git(['rev-parse', '--short', 'HEAD'], { cwd: root })
    return (
      `${root} is not on a branch — HEAD is detached${at.ok && at.out.trim() ? ` at ${at.out.trim()}` : ''}. `
      + 'Check out a branch there and this will commit onto it. Nothing was committed.'
    )
  }

  /* Something half-finished. A commit into the middle of a merge or a rebase
     either becomes the merge commit itself or lands on a temporary head the
     operation is about to throw away, and in both cases it is somewhere its
     author will not look for it. */
  const dir = await git(['rev-parse', '--absolute-git-dir'], { cwd: root })
  if (dir.ok && dir.out.trim()) {
    const midway: [string, string][] = [
      ['MERGE_HEAD', 'A merge'],
      ['rebase-merge', 'A rebase'],
      ['rebase-apply', 'A rebase'],
      ['CHERRY_PICK_HEAD', 'A cherry-pick'],
      ['REVERT_HEAD', 'A revert'],
      ['BISECT_LOG', 'A bisect'],
    ]
    for (const [entry, what] of midway) {
      if (existsSync(join(dir.out.trim(), entry))) {
        return `${what} is in progress in ${root}. Finish it or abort it, and this will commit. Nothing was committed.`
      }
    }
  }

  /*
   * An identity, and it must be CONFIGURED rather than invented.
   *
   * The `.kehikot` repository this module makes gets a `kehikot@localhost`
   * fallback when git has no identity, and that is right there: it is a
   * repository nobody else reads and a history that would otherwise not exist.
   * It is wrong HERE. Git will happily invent `someone@their-laptop.local` from
   * the login name and the hostname, and a commit in somebody's thesis
   * attributed to an address that does not exist is worse than no commit — it is
   * a wrong answer to "who wrote this", written into a history that keeps it.
   */
  const [name, email] = await Promise.all([
    git(['config', '--get', 'user.name'], { cwd: root }),
    git(['config', '--get', 'user.email'], { cwd: root }),
  ])
  const missing = [
    name.ok && name.out.trim() ? null : 'user.name',
    email.ok && email.out.trim() ? null : 'user.email',
  ].filter((one): one is string => one !== null)
  if (missing.length) {
    return (
      `${root} has no ${missing.join(' and no ')} set, so git cannot record who made this commit. Set it — for `
      + `example \`git -C ${root} config user.email you@example.com\` — and this will commit. Nothing was committed.`
    )
  }

  return null
}

/**
 * Commit `.kehikot` into the repository the project is already in.
 *
 * Only ever reached from a press. `stance` is passed in rather than recomputed
 * so that what is committed is what the caller was told about — a folder that
 * became tracked between the read and the press is a different decision, and it
 * gets made on the next read.
 */
export async function commitInto(
  stance: Stance,
  kehikot: string,
  text: string | null,
  git: GitRunner,
): Promise<Landed> {
  if (stance.at !== 'kept' && stance.at !== 'offered') {
    return {
      ok: false,
      said:
        `${kehikot} is not in a repository this module would commit into. It commits into the repository around a `
        + 'project only when that repository already has this folder, which this one does not.',
      sha: null,
    }
  }

  const no = await refusal(stance.root, git)
  if (no) return { ok: false, said: no, sha: null }

  /* Nothing to do is not a failure and is said as its own sentence, because
     "nothing changed" and "this could not be committed" are different things and
     collapsing them tells somebody their work was saved when it was refused. */
  const changed = await git(['status', '--porcelain', '-z', '--', stance.spec], { cwd: stance.root })
  if (!changed.ok) {
    return {
      ok: false,
      said: `git could not say what has changed under ${kehikot}: ${(changed.err || changed.out).trim()}`,
      sha: null,
    }
  }
  const touched = pathsIn(changed.out)
  if (!touched.length) {
    return { ok: false, said: `Nothing under ${kehikot} has changed since the last commit in ${stance.root}.`, sha: null }
  }

  const checked = checkMessage(text && text.trim() ? text : derived(touched, stance.spec))
  if (!checked.ok) return { ok: false, said: checked.why, sha: null }

  /* Staged by the folder's own pathspec and nothing else. Here for the untracked
     case, which pathspec-mode commit refuses on its own. */
  const staged = await git([...hooked, 'add', '--', stance.spec], { cwd: stance.root })
  if (!staged.ok) {
    return { ok: false, said: `git would not stage ${kehikot}: ${(staged.err || staged.out).trim()}`, sha: null }
  }

  /*
   * `--cleanup=whitespace` rather than the default `strip`, which deletes every
   * line beginning with `#`. These messages are derived from JSON that people
   * wrote, and a note beginning with a `#` would silently become an empty commit
   * body. `--only` is implied by the trailing pathspec and is written out anyway,
   * because it is the flag that says what this whole function is about.
   */
  const made = await git(
    [...hooked, 'commit', '--only', '--cleanup=whitespace', '-m', checked.value, '--', stance.spec],
    { cwd: stance.root },
  )
  if (!made.ok) {
    return {
      ok: false,
      said:
        `git would not make that commit in ${stance.root}: `
        + `${(made.err || made.out).trim() || 'it said nothing about why'}`,
      sha: null,
    }
  }
  const sha = await git(['rev-parse', 'HEAD'], { cwd: stance.root })
  return {
    ok: true,
    said: `Committed into ${stance.root}, carrying ${kehikot} and nothing else: ${checked.value.split('\n')[0] ?? ''}`,
    sha: sha.ok ? sha.out.trim() : null,
  }
}

/**
 * The paths out of `git status --porcelain -z`.
 *
 * `-z` because a path with a space or a quote in it comes back quoted and
 * escaped in the ordinary format, and unquoting that correctly is a parser
 * nobody should write twice. A rename emits two records and both are kept: this
 * list is counted and shown, and an extra path in a display is a smaller wrong
 * than a dropped one.
 */
function pathsIn(out: string): string[] {
  return out
    .split('\0')
    .map((record) => (record.length > 3 ? record.slice(3) : ''))
    .filter((one) => one.length > 0)
}

/**
 * A commit subject for the enclosing repository when nobody typed one.
 *
 * Deliberately dull. The `.kehikot` repository this module owns gets a message
 * derived by diffing the JSON — "notes: 2 added on chapters/3_method.tex" — and
 * that machinery is not reached from here, because here the commit is being made
 * by hand into somebody's own log and there is a person present who can say what
 * it was in their own words. What this writes when they do not is a true
 * sentence and not an invented one: which module folders changed, and how many
 * files. `describe.ts` argues the same thing at length about its own dull cases.
 */
function derived(touched: string[], spec: string): string {
  const under = spec.replace(/^:\([^)]*\)/, '')
  const folders = new Set<string>()
  for (const path of touched) {
    const rest = path.startsWith(`${under}/`) ? path.slice(under.length + 1) : path
    const first = rest.split('/')[0]
    if (first) folders.add(first)
  }
  const named = [...folders].sort().slice(0, 6).join(', ')
  const count = `${touched.length} file${touched.length === 1 ? '' : 's'}`
  return named ? `${under}: ${count} changed under ${named}` : `${under}: ${count} changed`
}
