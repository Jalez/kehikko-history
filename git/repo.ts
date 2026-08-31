import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { KEHIKOT_DIR, kehikotDir, withKehikotIgnored, within } from 'roadmap-module-protocol'

import { branchName, commitish, message as checkMessage, repoPath, type Which } from './names.ts'
import type { GitRunner, GitResult } from './run.ts'

/**
 * The two repositories, found rather than named — and the one this module makes.
 *
 * ## `.kehikot` is a repository of its own, and this file is what makes it one
 *
 * The four data modules create `<project>/.kehikot/<module>/` and write JSON
 * into it. None of them makes it a repository, and none of them should: four
 * programs racing to run `git init` on one directory is a race with a real loser
 * — two `init`s and a half-written `HEAD` — for a job that only needs doing
 * once. So this module owns it. `ensure()` below is the only place in this
 * workspace that runs `git init` on that folder.
 *
 * **One repository for the whole folder, not one per module.** "My work on this
 * project" is a single story: a note taken while ticking a checklist item
 * belongs in the same commit as the tick, and four repositories would be four
 * things to back up and four histories to line up by timestamp when somebody
 * wants to know what an afternoon looked like.
 *
 * ## Why a nested repository inside an ignored folder is safe
 *
 * This was checked before it was agreed to, because the obvious worry is that
 * `git clean` in the parent would take the whole thing away.
 *
 *     git clean -xdf   # SKIPS a nested repository. Prints "Skipping repository".
 *     git clean -xdff  # DESTROYS it. Two f's, and it is gone.
 *
 * The single `-f` is what people run and what tooling runs, and it leaves a
 * nested repository alone — that property is the thing that makes this design
 * workable at all. The double `-f` exists precisely to override it. The README
 * says both, because a hazard nobody has written down is a hazard.
 *
 * ## The fence
 *
 * `projectPath` arrives OVER THE WIRE, from a host, into functions that are
 * about to create directories and run `git`. So it is resolved with
 * `realpathSync` and the folder it lands in is checked to be under the project
 * it claims to be under AFTER that resolution — because a `.kehikot` that is a
 * symlink pointing somewhere else is exactly the case a string comparison
 * misses. `within()` from the protocol package is the comparison and explicitly
 * not the check; see its own note.
 *
 * There is no fallback anywhere in this file. No `process.cwd()`, no this
 * module's own directory, nothing. The argument is the one `store.ts` makes in
 * every other module here and it is stronger for this one: a silently wrong
 * location would mean running `git init` in a folder nobody chose.
 */

/** As long as a project path may be: the protocol package's own `LIMITS.PATH`. */
const MAX_PROJECT = 4096

/** How far up from a project this will look for a repository. A bound, not an opinion about depth. */
const UPWARD = 64

export interface Where {
  /** The project root as it resolves on this disk. */
  project: string
  /** `<project>/.kehikot`, resolved where it exists. */
  kehikot: string
}

export type Located = { ok: true; where: Where } | { ok: false; why: string } | { ok: null }

/**
 * Where the two repositories would be, for a project a host named.
 *
 * Three answers, because they mean three different things that must not be
 * collapsed onto one screen: here it is, there is no project open, and a project
 * was named that this module will not work under. The middle one is `{ ok: null }`
 * and is an ordinary state rather than a fault — no project is open, or the host
 * is older than `projectPath`.
 */
export function locate(projectPath: string | null | undefined): Located {
  if (typeof projectPath !== 'string') return { ok: null }
  const raw = projectPath.trim()
  if (!raw) return { ok: null }
  if (raw.length > MAX_PROJECT) {
    return { ok: false, why: `That project path is ${raw.length} characters long, which is past what this module treats as a path.` }
  }
  if (!raw.startsWith('/')) {
    return {
      ok: false,
      why: `"${raw}" is not an absolute path. A relative one would be relative to wherever this module happened to be started from, which is not where the project is.`,
    }
  }

  let project: string
  try {
    project = realpathSync(raw)
  } catch {
    return { ok: false, why: `There is nothing at "${raw}" on this machine, so there is no history to read there.` }
  }
  try {
    if (!statSync(project).isDirectory()) return { ok: false, why: `"${project}" is not a directory.` }
  } catch {
    return { ok: false, why: `"${project}" could not be read.` }
  }

  const dir = kehikotDir(project)
  if (dir === null) return { ok: null }

  /* Only what exists can be resolved, and only what exists can escape. A folder
     that is not there yet cannot be a symlink to somewhere else; it becomes one
     the moment it is created, which is why `ensure` checks again after it. */
  if (existsSync(dir)) {
    const escaped = escapes(project, dir)
    if (escaped) return { ok: false, why: escaped }
    return { ok: true, where: { project, kehikot: realpathSync(dir) } }
  }
  return { ok: true, where: { project, kehikot: dir } }
}

/** The refusal for a folder that resolves outside the project it claims to be inside, or null. */
function escapes(project: string, dir: string): string | null {
  let real: string
  try {
    real = realpathSync(dir)
  } catch {
    return `"${dir}" could not be resolved, so this module will not run git in it.`
  }
  if (within(project, real)) return null
  return (
    `${dir} resolves to ${real}, which is outside ${project}. This module will not initialise or commit to a `
    + `repository outside the project it was told about — a ${KEHIKOT_DIR} that is a link somewhere else is exactly `
    + 'the case a string comparison misses, so the check is made after the link is followed.'
  )
}

/* ------------------------------------------------------------------ *
 * Making the .kehikot repository
 * ------------------------------------------------------------------ */

export interface Ensured {
  ok: boolean
  /** Whether this call is what created it. False when it was already there. */
  created: boolean
  why: string | null
  path: string
}

/**
 * The `.kehikot` folder, as a git repository, creating both if they are not
 * there.
 *
 * ## The initial branch is named explicitly
 *
 * `--initial-branch=main`. Without it the name comes from whatever
 * `init.defaultBranch` says on this machine, which is `master` on an unconfigured
 * git and prints a paragraph of advice to stderr every time. Neither of those is
 * something this module should inherit from a person's global config for a
 * repository the person did not ask to create.
 *
 * ## The folder gets a `.gitignore` of its own, and it is nearly empty
 *
 * One line: `.DS_Store`. Not a rule about the modules' data — that is the whole
 * point of the repository. What it must NOT do is touch
 * `.kehikot/references/.gitignore`, which contains `*` deliberately: that folder
 * is a cache rebuilt from GitHub, and a derived cache does not belong in a data
 * history. Authored data is committed, derived data is not, and the file saying
 * so was written by the module that owns it. See `stageAll()`.
 *
 * ## The project's own `.gitignore` gets the `.kehikot` line, once
 *
 * Appended by the protocol package's own `withKehikotIgnored`, which is
 * append-only and idempotent, and only when this call is what created the
 * folder. A project that has REMOVED that line has said something, and a program
 * that put it back on the next save would be overruling them every few seconds.
 */
export async function ensure(where: Where, git: GitRunner): Promise<Ensured> {
  const path = where.kehikot
  const existed = existsSync(path)

  if (!existed) {
    try {
      mkdirSync(path, { recursive: true })
    } catch (error) {
      return { ok: false, created: false, why: `${path} could not be created: ${(error as Error).message}`, path }
    }
  }

  /* Checked again after the create, because the only honest moment to ask where
     a directory actually is, is once it is there. */
  const escaped = escapes(where.project, path)
  if (escaped) return { ok: false, created: false, why: escaped, path }

  if (existsSync(join(path, '.git'))) {
    return { ok: true, created: false, why: null, path }
  }

  const init = await git(['init', '--initial-branch=main'], { cwd: path })
  if (!init.ok) {
    return { ok: false, created: false, why: `git init failed in ${path}: ${(init.err || init.out).trim()}`, path }
  }

  const ignore = join(path, '.gitignore')
  if (!existsSync(ignore)) {
    writeFileSync(
      ignore,
      '# This folder is a git repository of its own, made and committed to by the History\n'
        + '# module. What is in it is authored data — checklists, notes, questions,\n'
        + '# journeys — and all of it is meant to be committed. The one thing that is not\n'
        + '# is a derived cache, and a cache says so in a .gitignore of its own inside its\n'
        + '# own folder, which this file deliberately does not override.\n'
        + '.DS_Store\n',
    )
  }

  /* And the project is told to ignore the folder, once, at the moment it is
     created. Append-only and idempotent — see the protocol package's own note. */
  const projectIgnore = join(where.project, '.gitignore')
  try {
    const current = existsSync(projectIgnore) ? readFileSync(projectIgnore, 'utf8') : ''
    const next = withKehikotIgnored(current)
    if (next !== current) writeFileSync(projectIgnore, next)
  } catch {
    /* A project whose .gitignore cannot be written is not a reason to fail the
       repository that was just made. The folder is ignored or it is not; either
       way the history now exists, which is what was asked for. */
  }

  return { ok: true, created: true, why: null, path }
}

/* ------------------------------------------------------------------ *
 * Reading a repository
 * ------------------------------------------------------------------ */

export interface Commit {
  sha: string
  short: string
  /** ISO 8601, as git prints it with `%aI`. */
  at: string
  who: string
  subject: string
}

export interface Branch {
  name: string
  /** Whether HEAD is on it. False for every branch when HEAD is detached. */
  current: boolean
  sha: string
}

export interface Head {
  /** The branch name, or null when HEAD is detached. */
  branch: string | null
  detached: boolean
  sha: string | null
}

export interface Dirty {
  /** `git status --porcelain` two-character code, e.g. ` M`, `??`, `A `. */
  code: string
  path: string
}

export interface Reading {
  which: Which
  /** Where the repository is on disk. */
  root: string
  /** Whether there is a git repository there at all. */
  present: boolean
  /** Why there is not, when there is not. Never null when `present` is false. */
  absent: string | null
  head: Head
  commits: Commit[]
  branches: Branch[]
  dirty: Dirty[]
  /** Anything git said that a person should see. */
  trouble: string | null
}

/** How many commits one read brings back. A page, not a history. */
export const PAGE = 40

/**
 * A separator that cannot appear in any of the fields it separates.
 *
 * `%x1f` is the ASCII unit separator. Splitting `git log` output on a character
 * a commit subject could contain — a tab, a pipe — is a parser that works until
 * somebody writes a subject with one in it, at which point the author column
 * fills with half a sentence. This is the character that exists for the job.
 */
const FIELD = ''
const LOG_FORMAT = `--format=%H${FIELD}%h${FIELD}%aI${FIELD}%an${FIELD}%s`

export async function read(root: string, which: Which, git: GitRunner): Promise<Reading> {
  const empty: Reading = {
    which,
    root,
    present: false,
    absent: null,
    head: { branch: null, detached: false, sha: null },
    commits: [],
    branches: [],
    dirty: [],
    trouble: null,
  }

  if (!existsSync(root)) {
    return {
      ...empty,
      absent:
        which === 'kehikot'
          ? `There is no ${KEHIKOT_DIR} folder in this project yet. It appears the first time a module writes something, and this module makes it a repository at the same moment.`
          : `There is nothing at ${root}.`,
    }
  }

  const top = await git(['rev-parse', '--show-toplevel'], { cwd: root })
  if (!top.ok) {
    return {
      ...empty,
      absent:
        which === 'kehikot'
          ? `${root} is not a git repository yet. Press Start this history and it becomes one.`
          : `${root} is not inside a git repository, so the project has no history of its own to show. \`git init\` there, if that is what you want — this module will not do it for you, because a project’s own repository is the project’s decision.`,
    }
  }

  /*
   * The toplevel git found has to BE the directory we asked about, for the
   * `.kehikot` case.
   *
   * Without this check the answer is quietly wrong in exactly the situation this
   * module exists for: before `.kehikot` is a repository of its own, `git
   * rev-parse` run inside it walks upward and finds the PROJECT's repository. The
   * pane would then show the project's commits under the heading "kehikot", the
   * two columns would be identical, and a commit made "to the data" would land in
   * the project's history — which is the one outcome nobody wants.
   */
  const found = top.out.trim()
  if (which === 'kehikot' && found && realpathish(found) !== realpathish(root)) {
    return {
      ...empty,
      absent: `${root} is not a repository of its own yet — git finds ${found} above it. Press Start this history to make it one; until then its data is not versioned anywhere.`,
    }
  }

  const cwd = found || root
  const [headRef, headSha, log, branches, status] = await Promise.all([
    git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd }),
    git(['rev-parse', 'HEAD'], { cwd }),
    git(['log', `--max-count=${PAGE}`, LOG_FORMAT], { cwd }),
    git(['for-each-ref', '--sort=-committerdate', `--format=%(refname:short)${FIELD}%(objectname)`, 'refs/heads/'], { cwd }),
    git(['status', '--porcelain'], { cwd }),
  ])

  const branch = headRef.ok ? headRef.out.trim() || null : null
  const sha = headSha.ok ? headSha.out.trim() || null : null

  return {
    which,
    root: cwd,
    present: true,
    absent: null,
    /* Detached is `HEAD points at a commit and no branch`, and that is only true
       when there IS a commit. A repository with no commits at all has a symbolic
       HEAD pointing at a branch that does not exist yet, which is not detached
       and must not be drawn as though a person had wandered off somewhere. */
    head: { branch, detached: sha !== null && branch === null, sha },
    commits: log.ok ? parseLog(log.out) : [],
    branches: branches.ok ? parseBranches(branches.out, branch) : [],
    dirty: status.ok ? parseStatus(status.out) : [],
    trouble: trouble([headSha, log, branches, status]),
  }
}

/**
 * A cheap normalisation for comparing two paths git and node both printed.
 *
 * Not `realpathSync` — that throws for a path that does not exist and this is
 * comparing two paths that both do. What it removes is the one difference that
 * actually shows up: a trailing slash.
 */
function realpathish(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  try {
    return realpathSync(trimmed)
  } catch {
    return trimmed
  }
}

/** Whatever went wrong, as one sentence, or null when nothing did. */
function trouble(results: GitResult[]): string | null {
  /* A repository with no commits answers `rev-parse HEAD` and `log` with an
     error, and that is not trouble — it is a new repository. Said here rather
     than in four places, and matched on git's own words. */
  const said = results
    .filter((result) => !result.ok)
    .map((result) => (result.err || result.out).trim())
    .filter((text) => text && !/unknown revision|does not have any commits|ambiguous argument 'HEAD'/i.test(text))
  return said.length ? said.join(' ') : null
}

function parseLog(out: string): Commit[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', short = '', at = '', who = '', ...rest] = line.split(FIELD)
      return { sha, short, at, who, subject: rest.join(FIELD) }
    })
    .filter((commit) => commit.sha)
}

function parseBranches(out: string, current: string | null): Branch[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', sha = ''] = line.split(FIELD)
      return { name, sha, current: name === current }
    })
    .filter((branch) => branch.name)
}

function parseStatus(out: string): Dirty[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ code: line.slice(0, 2), path: line.slice(3) }))
    .filter((entry) => entry.path)
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/**
 * Stage everything, honouring every `.gitignore` in the tree.
 *
 * `git add -A` is the whole of it, and the fact worth writing down is what it
 * does NOT add: `.kehikot/references/.gitignore` contains `*`, and `git add`
 * reads nested ignore files as it descends, so the whole of that folder is left
 * out with no help from this module and no list of exceptions to keep current.
 *
 * That is the right mechanism as well as the easy one. The alternative —
 * enumerating what to stage — would be this module holding an opinion about
 * which folders are caches, which is an opinion that goes stale the first time a
 * module adds one. The module that owns a derived folder says so in its own
 * `.gitignore`, and git is what reads it.
 */
export async function stageAll(cwd: string, git: GitRunner): Promise<GitResult> {
  return git(['add', '-A', '--', '.'], { cwd })
}

/** Every file staged for the next commit, with git's own status letter. */
export async function staged(cwd: string, git: GitRunner): Promise<{ status: 'A' | 'M' | 'D'; path: string }[]> {
  const result = await git(['diff', '--cached', '--name-status', '-z'], { cwd })
  if (!result.ok) return []
  /*
   * `-z` and a manual walk, rather than splitting lines.
   *
   * A path with a newline in it is legal on every filesystem this runs on, and
   * git's default output quotes such a path in a format that then has to be
   * unquoted. `-z` sidesteps both: fields are NUL-separated, nothing is quoted,
   * and a newline in a name is just a byte in a field.
   */
  const parts = result.out.split('\0').filter((part) => part !== '')
  const out: { status: 'A' | 'M' | 'D'; path: string }[] = []
  for (let index = 0; index < parts.length; index += 1) {
    const code = parts[index] ?? ''
    const letter = code[0]
    if (letter !== 'A' && letter !== 'M' && letter !== 'D' && letter !== 'R' && letter !== 'C') continue
    /* A rename or a copy carries two paths. Both are consumed; the new one is
       what the message is about, and it is reported as an addition because that
       is what it is from the point of view of somebody looking for content. */
    if (letter === 'R' || letter === 'C') {
      index += 1
      const to = parts[index + 1]
      index += 1
      if (to) out.push({ status: 'A', path: to })
      continue
    }
    index += 1
    const path = parts[index]
    if (path) out.push({ status: letter, path })
  }
  return out
}

/** One file as HEAD has it, or null when HEAD does not have it — or there is no HEAD. */
export async function atHead(cwd: string, path: string, git: GitRunner): Promise<string | null> {
  const checked = repoPath(path)
  if (!checked.ok) return null
  const result = await git(['show', `HEAD:./${checked.value}`], { cwd })
  return result.ok ? result.out : null
}

export interface Committed {
  ok: boolean
  /** The subject line of what was committed, for saying so on screen. */
  subject: string
  sha: string | null
  why: string | null
}

/**
 * Commit what is staged, under a message that has been checked.
 *
 * ## The identity, and why it is only ever a fallback
 *
 * A commit needs a name and an address. Nearly everybody has them in their git
 * config and those are used unchanged — a commit made in somebody's data folder
 * should be theirs, in their own name, the same as every other commit they make.
 *
 * When they are not configured, git refuses to commit at all, with a paragraph
 * about telling it who you are. Refusing here would mean a person's data folder
 * silently never getting a history because of a global setting they have never
 * needed. So an identity is supplied for that case and only that case, it is
 * named after this module rather than pretending to be a person, and it is
 * passed with `-c` for the one call rather than written into their config —
 * this module does not edit somebody's git configuration.
 */
export async function commit(cwd: string, text: string, git: GitRunner): Promise<Committed> {
  const checked = checkMessage(text)
  if (!checked.ok) return { ok: false, subject: '', sha: null, why: checked.why }

  const staged_ = await staged(cwd, git)
  if (!staged_.length) return { ok: false, subject: '', sha: null, why: 'There is nothing staged to commit.' }

  const identity = await needsIdentity(cwd, git)
  const args = identity
    ? ['-c', 'user.name=kehikot', '-c', 'user.email=kehikot@localhost', 'commit', '-m', checked.value]
    : ['commit', '-m', checked.value]

  const result = await git(args, { cwd })
  if (!result.ok) {
    return { ok: false, subject: '', sha: null, why: (result.err || result.out).trim() || 'git refused the commit and said nothing.' }
  }
  const sha = await git(['rev-parse', 'HEAD'], { cwd })
  return { ok: true, subject: checked.value.split('\n')[0] ?? '', sha: sha.ok ? sha.out.trim() : null, why: null }
}

async function needsIdentity(cwd: string, git: GitRunner): Promise<boolean> {
  const [name, email] = await Promise.all([
    git(['config', '--get', 'user.name'], { cwd }),
    git(['config', '--get', 'user.email'], { cwd }),
  ])
  return !(name.ok && name.out.trim()) || !(email.ok && email.out.trim())
}

/* ------------------------------------------------------------------ *
 * Moving around, which is the part that needs care
 * ------------------------------------------------------------------ */

export interface Moved {
  ok: boolean
  said: string
  /** What would have been lost, named, when the move was refused for that reason. */
  wouldLose: string[]
}

/**
 * Switch to a branch, or make one — and never over the top of uncommitted work.
 *
 * ## The decision about an agent mid-edit
 *
 * The brief said, at minimum, to say that uncommitted changes exist before
 * moving. This does more than the minimum, and the reason is that the minimum is
 * a warning nobody can act on from inside a pane: **it refuses.** A working tree
 * with changes in it does not get checked out from under whoever is making them.
 *
 * There is no override flag, no second press that forces it, and no `-f`
 * anywhere — `checkout --force` is refused by the runner's own allowlist, so
 * this is not a policy one edit away from being bypassed. The two ways forward
 * are named in the refusal and both preserve the work: commit it, or stash it.
 * A person who genuinely wants to throw it away has a terminal, and doing it
 * there is a thing they will remember doing.
 *
 * ## Detached HEAD, said plainly
 *
 * Checking out a commit rather than a branch is offered, because looking at what
 * the data was yesterday is most of why this module exists. What it must not do
 * is leave somebody somewhere they cannot name. So the answer says, in
 * sentences: you are not on a branch, this is what that means, and here is the
 * branch to press to get back. `said` is written for a person and shown verbatim.
 */
export async function switchTo(
  cwd: string,
  target: { branch?: unknown; commit?: unknown; create?: boolean },
  git: GitRunner,
): Promise<Moved> {
  const status = await git(['status', '--porcelain'], { cwd })
  const dirty = status.ok ? parseStatus(status.out) : []
  if (dirty.length) {
    return {
      ok: false,
      said:
        'There is work here that is not committed, so nothing was moved. Checking out over it would take it away with '
        + 'no record of what it was — and if an agent is editing in this project right now, it would take the file out '
        + 'from under it mid-write. Commit it, or stash it, and then move.',
      wouldLose: dirty.map((entry) => entry.path).slice(0, 50),
    }
  }

  if (target.create) {
    const name = branchName(target.branch)
    if (!name.ok) return { ok: false, said: name.why, wouldLose: [] }
    const made = await git(['checkout', '-b', name.value, '--'], { cwd })
    if (!made.ok) return { ok: false, said: (made.err || made.out).trim() || 'git refused to make that branch.', wouldLose: [] }
    return { ok: true, said: `You are now on a new branch, ${name.value}, starting from where you were.`, wouldLose: [] }
  }

  if (typeof target.branch === 'string' && target.branch) {
    const name = branchName(target.branch)
    if (!name.ok) return { ok: false, said: name.why, wouldLose: [] }
    const gone = await git(['checkout', name.value, '--'], { cwd })
    if (!gone.ok) return { ok: false, said: (gone.err || gone.out).trim() || 'git refused that checkout.', wouldLose: [] }
    return { ok: true, said: `You are on ${name.value}.`, wouldLose: [] }
  }

  const sha = commitish(target.commit)
  if (!sha.ok) return { ok: false, said: sha.why, wouldLose: [] }

  /* Where we were, read BEFORE the move, so the sentence about getting back can
     name the actual branch rather than telling somebody to guess. */
  const wasOn = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd })
  const back = wasOn.ok ? wasOn.out.trim() : ''

  const gone = await git(['checkout', sha.value, '--'], { cwd })
  if (!gone.ok) return { ok: false, said: (gone.err || gone.out).trim() || 'git refused that checkout.', wouldLose: [] }

  return {
    ok: true,
    said:
      `You are now looking at commit ${sha.value.slice(0, 8)} and you are NOT on a branch — git calls this a detached `
      + 'HEAD. Everything is here and nothing is lost; what it means is that a commit made from here would belong to '
      + `no branch and be hard to find again. ${back ? `Press ${back} to go back to where you were.` : 'Check out a branch to get back on one.'}`,
    wouldLose: [],
  }
}

/**
 * Bring one file back from an older commit — which is what "restore" means here.
 *
 * The one recovery operation this module offers, and it is deliberately narrow:
 * one named file, from one named commit, into the working tree. It does not
 * commit. The file lands as an ordinary uncommitted change, the person looks at
 * it, and the next automatic commit records it with a message saying what moved.
 *
 * ## Why it names what it would overwrite, first
 *
 * Restoring over a file with uncommitted changes destroys those changes and git
 * says nothing about it. So the changes are looked for first and the restore is
 * refused with the file named, unless the caller has already been told and asked
 * again — which on the page is the second press of the arm, and over MCP is an
 * explicit `overwrite`. What is never destroyed without being named is the
 * whole of the rule.
 */
export async function restore(
  cwd: string,
  from: unknown,
  path: unknown,
  overwrite: boolean,
  git: GitRunner,
): Promise<Moved> {
  const sha = commitish(from)
  if (!sha.ok) return { ok: false, said: sha.why, wouldLose: [] }
  const file = repoPath(path)
  if (!file.ok) return { ok: false, said: file.why, wouldLose: [] }

  if (!overwrite) {
    const status = await git(['status', '--porcelain', '--', file.value], { cwd })
    const dirty = status.ok ? parseStatus(status.out) : []
    if (dirty.length) {
      return {
        ok: false,
        said:
          `${file.value} has changes that are not committed. Restoring would write over them and they are not `
          + 'anywhere else — git keeps no copy of what was never committed. Say so again to go ahead, or commit '
          + 'what is there first and then restore, which leaves both versions in the history.',
        wouldLose: [file.value],
      }
    }
  }

  const done = await git(['restore', `--source=${sha.value}`, '--worktree', '--', file.value], { cwd })
  if (!done.ok) {
    return { ok: false, said: (done.err || done.out).trim() || 'git refused that restore.', wouldLose: [] }
  }
  return {
    ok: true,
    said:
      `${file.value} is back as it was at ${sha.value.slice(0, 8)}. It is an uncommitted change now, so nothing has `
      + 'been decided yet — look at it, and the next commit will record it either way.',
    wouldLose: [],
  }
}

/** Put uncommitted work aside, which is the way forward this module offers instead of forcing anything. */
export async function stash(cwd: string, git: GitRunner): Promise<Moved> {
  const done = await git(['stash', 'push', '--include-untracked', '-m', 'set aside from the History pane'], { cwd })
  if (!done.ok) return { ok: false, said: (done.err || done.out).trim() || 'git refused to stash.', wouldLose: [] }
  if (/No local changes/i.test(done.out)) return { ok: true, said: 'There was nothing to set aside.', wouldLose: [] }
  return {
    ok: true,
    said: 'Set aside. It is on the stash, not deleted — `git stash pop` in this repository brings it back exactly as it was.',
    wouldLose: [],
  }
}

/** One commit in full: its message and the files it touched. */
export async function show(cwd: string, from: unknown, git: GitRunner): Promise<{ ok: boolean; said: string }> {
  const sha = commitish(from)
  if (!sha.ok) return { ok: false, said: sha.why }
  const result = await git(['show', '--stat', '--format=%H%n%an <%ae>%n%aI%n%n%B', sha.value, '--'], { cwd })
  if (!result.ok) return { ok: false, said: (result.err || result.out).trim() || 'git could not show that commit.' }
  return { ok: true, said: result.out }
}

/** The project's own repository root, walked upward from the project. */
export function projectRepo(project: string): string {
  let at = project
  for (let step = 0; step < UPWARD; step += 1) {
    if (existsSync(join(at, '.git'))) return at
    const up = dirname(at)
    if (up === at) break
    at = up
  }
  return project
}
