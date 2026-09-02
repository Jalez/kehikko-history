import { mkdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

import { commitInto, saying, surrounding, type Stance } from './enclosing.ts'
import { commitMessage, type FileChange } from './describe.ts'
import { atHead, commit, ensure, locate, read, staged, stageAll, type At, type Ensured, type Where } from './repo.ts'
import type { GitRunner } from './run.ts'
import { spawnGit } from './run.ts'

/**
 * The thing that actually makes the commits: a watcher, a debounce, and exactly
 * one committer.
 *
 * ## Why automatic, and why debounced
 *
 * The user chose this over a timer and over doing it by hand, and the reason
 * given is the one to design to: **the value here is recovery, not a curated
 * log.** Nobody is going to browse these commits. Somebody is going to want the
 * state of their notes from before the thing that just went wrong, and what they
 * need is that a commit exists close to that moment, with a message specific
 * enough to pick out of forty others.
 *
 * A timer would commit at times unrelated to what happened — half a change, or
 * nothing, every five minutes. Manual would mean the commit that matters is the
 * one nobody made. Debouncing on the writes themselves puts a commit exactly
 * where a person stopped typing, which is where the recoverable states are.
 *
 * ## The two numbers
 *
 * `QUIET_MS` is how long after the last write to commit: long enough that a
 * flurry of saves inside one edit is one commit, short enough that walking away
 * mid-thought still records what was there. `MOST_MS` is the longest a burst may
 * postpone a commit for — without it, a program writing every two seconds could
 * defer the commit indefinitely, and the one afternoon somebody needs to recover
 * is the afternoon nothing was committed.
 *
 * ## One committer, and only one
 *
 * Four modules writing and one process committing is fine and is the design.
 * TWO processes committing to one repository is not: they meet on `index.lock`,
 * and what a person sees is an operation that failed at the worst possible
 * moment with a message about a lock file. Worse, `git add` and `git commit` are
 * two calls, so two committers can interleave into a commit containing half of
 * somebody else's staging.
 *
 * So there is a lock, and it has two levels because there are two ways to have
 * two committers:
 *
 * - **In this process:** one `Committer` per project path, held in a module-level
 *   map, and inside it a single-flight flag so a commit already running is never
 *   started twice.
 * - **Across processes:** a lock file inside the repository's own `.git`, written
 *   with an exclusive create so the write itself is the claim. It carries a pid
 *   and a start time; a lock whose pid is no longer alive is stale and is taken
 *   over, because the alternative is that one crash means a data folder is never
 *   committed again until somebody finds a file they have never heard of.
 *
 * A second History process against the same project therefore does not commit,
 * and says so on its own page rather than failing quietly. It still SHOWS both
 * histories — reading is safe from anywhere.
 *
 * ## What happens if somebody runs `git commit` in there by hand
 *
 * Nothing bad, and it is worth being exact rather than reassuring. The lock here
 * is advisory: it is a file this module writes and this module reads, and `git`
 * has never heard of it. A person running `git commit` in `.kehikot` makes an
 * ordinary commit that this module will show in its list like any other. The
 * only thing they can collide with is git's own `index.lock`, which git itself
 * handles — one of the two gets "another git process seems to be running", waits
 * a moment, and works. The debounce means this module's commits happen in short
 * bursts with seconds of nothing in between, so even that is unlikely.
 *
 * The one thing a person should not do is leave a long-running `git` operation
 * open in there — a rebase, a merge with conflicts — because this module will
 * keep trying to `add` and `commit` on top of it. It will fail rather than do
 * damage, and the failure is shown on the pane.
 */

/** How long after the last write to commit. */
export const QUIET_MS = 3000

/** The longest a run of writes may postpone a commit. */
export const MOST_MS = 30_000

/**
 * The debounce, as a pure object with an injected clock.
 *
 * Separated from the watcher and from git deliberately, because it is the part
 * with a behaviour worth asserting — a burst of writes becomes ONE commit and
 * not five — and asserting that against a real filesystem and real timers would
 * be a test that sleeps and is flaky. Here it is a handful of function calls.
 */
export interface Debounce {
  /** Something changed. */
  poke: (now: number) => void
  /** Should a commit run at this moment? Calling it consumes the pending state. */
  due: (now: number) => boolean
  /** Whether anything is waiting. */
  waiting: () => boolean
  /** When the commit would happen, or null when nothing is pending. */
  at: () => number | null
}

export function debounce(quietMs: number = QUIET_MS, mostMs: number = MOST_MS): Debounce {
  let first: number | null = null
  let last = 0

  return {
    poke(now) {
      if (first === null) first = now
      last = now
    },
    due(now) {
      if (first === null) return false
      /* Quiet for long enough, OR waiting for too long. The second is what stops
         a program that writes every second from postponing the commit forever —
         and forever is exactly as long as the afternoon somebody later wants
         back. */
      if (now - last >= quietMs || now - first >= mostMs) {
        first = null
        return true
      }
      return false
    },
    waiting: () => first !== null,
    at: () => (first === null ? null : Math.min(last + quietMs, first + mostMs)),
  }
}

/* ------------------------------------------------------------------ *
 * The cross-process lock
 * ------------------------------------------------------------------ */

/** Where the claim is written. Inside `.git`, because it is about the repository rather than about the data. */
const LOCK = 'kehikot-committer.lock'

export interface Claim {
  ok: boolean
  /** The sentence to show when the claim was refused. */
  why: string | null
  release: () => void
}

interface Held {
  pid: number
  at: string
}

/** Is that process still there? `kill(pid, 0)` asks without sending anything. */
function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    /* `EPERM` means it exists and belongs to somebody else, which counts as
       alive — taking over a lock held by another user's process is exactly the
       case this must not get wrong. */
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function claim(gitDir: string, pid: number = process.pid): Claim {
  const path = join(gitDir, LOCK)
  const mine = JSON.stringify({ pid, at: new Date().toISOString() } satisfies Held)

  const take = (): boolean => {
    try {
      mkdirSync(gitDir, { recursive: true })
      /* `wx` — create, and fail if it is there. The exclusive create IS the
         claim: two processes racing here cannot both succeed, which a
         read-then-write would allow. */
      writeFileSync(path, mine, { flag: 'wx' })
      return true
    } catch {
      return false
    }
  }

  if (take()) return { ok: true, why: null, release: () => release(path, pid) }

  let held: Held | null = null
  try {
    held = JSON.parse(readFileSync(path, 'utf8')) as Held
  } catch {
    held = null
  }

  if (held && held.pid !== pid && alive(held.pid)) {
    return {
      ok: false,
      why:
        `Another History process (pid ${held.pid}, since ${held.at}) is already the committer for this folder, so this `
        + 'one is only reading. Two processes committing to one repository meet on index.lock and produce a failed '
        + 'operation at the worst possible moment, so exactly one holds this at a time. Both show the same history.',
      release: () => {},
    }
  }

  /* Stale, or ours from a previous run in this same process. Taken over rather
     than left, because the alternative is that one crash means this folder is
     never committed again until somebody finds a file they have never heard of. */
  try {
    rmSync(path, { force: true })
  } catch {
    /* Nothing to do about it here; the create below will say so. */
  }
  if (take()) return { ok: true, why: null, release: () => release(path, pid) }
  return {
    ok: false,
    why: `The committer lock at ${path} could not be taken and could not be cleared, so this process is only reading.`,
    release: () => {},
  }
}

function release(path: string, pid: number): void {
  try {
    const held = JSON.parse(readFileSync(path, 'utf8')) as Held
    /* Only ever remove our own. A release that deleted whatever was there would,
       on a stale-takeover race, delete the lock the winner had just written. */
    if (held.pid !== pid) return
  } catch {
    return
  }
  try {
    rmSync(path, { force: true })
  } catch {
    /* A lock left behind is picked up as stale by the next process, so this is
       recoverable and not worth failing a shutdown over. */
  }
}

/* ------------------------------------------------------------------ *
 * The committer
 * ------------------------------------------------------------------ */

export interface Standing {
  /** Whether this process is the one committing for this project. */
  committing: boolean
  /** Why not, when it is not. */
  why: string | null
  /** Whether a commit is pending, i.e. something changed and the quiet period has not passed. */
  pending: boolean
  /** The last commit this module made, for saying so on the page. */
  last: { subject: string; sha: string | null; at: string } | null
  /** Whatever went wrong last time, or null. */
  trouble: string | null
  /** Where the repository is. */
  root: string
  /**
   * Where `.kehikot` stands as a repository of its own — see `At` in `repo.ts`.
   *
   * Separate from `committing`, and the separation is the whole point of this
   * change: `waiting` and `elsewhere` are both "this process is not committing"
   * and neither is a fault, while `refused` is. A screen that had only a boolean
   * had to draw all three the same way, which is how "no repository yet" and
   * "your repository already has this" ended up looking like the same problem.
   */
  at: At
  /** What the repository around the project says about `.kehikot`. */
  stance: Stance
}

/** How often the loop wakes to ask the debounce whether anything is due. */
const TICK_MS = 500

class Committer {
  private readonly where: Where
  private readonly git: GitRunner
  private readonly clock: Debounce
  private held: Claim | null = null
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private stopped = false

  standing: Standing

  constructor(where: Where, git: GitRunner, quietMs: number, mostMs: number) {
    this.where = where
    this.git = git
    this.clock = debounce(quietMs, mostMs)
    this.standing = {
      committing: false,
      why: null,
      pending: false,
      last: null,
      trouble: null,
      root: where.kehikot,
      at: 'waiting',
      stance: { at: 'alone' },
    }
  }

  /**
   * Look at what is around this folder, then make the repository — or not.
   *
   * `asked` is what a press supplies and nothing else does. It reaches `ensure`
   * unchanged and is the difference between a page load and an act.
   *
   * The stance is read on EVERY start rather than cached, because it is a fact
   * about somebody's own repository that changes while this process is running:
   * flicking the host's "keep .kehikot in git" switch, or one `git add`, moves a
   * project from `declined` to `offered` to `kept` with nothing here noticing.
   * Two `spawn`s per start is the price of not holding a stale answer about
   * where somebody's history lives.
   */
  async start(asked: boolean): Promise<Ensured> {
    const stance = await surrounding(this.where, this.git)
    this.standing = { ...this.standing, stance }

    const made = await ensure(this.where, this.git, stance, asked)
    this.standing = { ...this.standing, at: made.at }
    if (!made.ok) {
      this.standing = {
        ...this.standing,
        committing: false,
        why: made.why,
        /* `waiting` and `elsewhere` are ordinary states, and `trouble` is the
           red box. Only a refusal goes in it. */
        trouble: made.at === 'refused' ? made.why : null,
      }
      return made
    }

    this.held = claim(join(this.where.kehikot, '.git'))
    this.standing = { ...this.standing, committing: this.held.ok, why: this.held.why }
    if (!this.held.ok) return made

    try {
      /*
       * `recursive: true`, which macOS and Windows support and Linux has
       * supported since Node 20. A per-directory watcher tree would be the
       * portable alternative and is not worth it here: the folders inside
       * `.kehikot` are created by other modules at times this one does not
       * control, so a tree of watchers would need its own re-scan to notice a
       * new module's folder — which is the exact case this has to catch.
       */
      this.watcher = watch(this.where.kehikot, { recursive: true, persistent: false }, (_event, name) => {
        if (typeof name === 'string' && this.ignorable(name)) return
        this.clock.poke(Date.now())
        this.standing = { ...this.standing, pending: true }
      })
    } catch (error) {
      this.standing = {
        ...this.standing,
        trouble: `The data folder could not be watched (${(error as Error).message}), so commits will not happen on their own here. Use Commit now.`,
      }
    }

    this.timer = setInterval(() => void this.maybe(), TICK_MS)
    /* Unref'd: a timer is not a reason for this process to stay alive. Vite's
       server is. */
    this.timer.unref?.()

    /* One pass at startup, so a folder that changed while nothing was running is
       committed rather than waiting for the next edit. */
    this.clock.poke(Date.now() - MOST_MS)
    return made
  }

  /**
   * Changes inside the repository's own machinery, which are not changes to the
   * data.
   *
   * Without this the module commits, git writes to `.git/`, the watcher fires,
   * and it commits again — a loop that produces an empty commit every three
   * seconds forever. It stops on its own at the "nothing staged" check, but it
   * would keep the CPU busy and keep the pane saying a commit is pending, which
   * is a lie about the state of somebody's data.
   *
   * The `.gitignore` inside `references/` is not ignored here; it is left to
   * git, which honours it during `add`. See `stageAll`.
   */
  private ignorable(name: string): boolean {
    const path = name.replace(/\\/g, '/')
    return path === '.git' || path.startsWith('.git/') || path.includes('/.git/') || path.endsWith('/.git')
  }

  private async maybe(): Promise<void> {
    if (this.stopped || this.running) return
    if (!this.standing.committing) return
    if (!this.clock.due(Date.now())) return
    this.running = true
    try {
      const done = await this.commitNow(null)
      this.standing = {
        ...this.standing,
        pending: this.clock.waiting(),
        last: done.ok ? { subject: done.subject, sha: done.sha, at: new Date().toISOString() } : this.standing.last,
        trouble: done.ok || done.nothing ? null : done.why,
      }
    } finally {
      this.running = false
    }
  }

  /**
   * Stage, describe, commit — the whole of one commit, in that order.
   *
   * The "before" for every diff is what HEAD has, read out of git rather than
   * remembered in this process. That is what makes a burst of writes one commit
   * with one honest message instead of five: whatever happened in between, the
   * commit describes the difference between the last committed state and what is
   * on disk now, which is exactly what the commit contains.
   */
  async commitNow(chosen: string | null): Promise<{ ok: boolean; subject: string; sha: string | null; why: string; nothing: boolean }> {
    const cwd = this.where.kehikot
    const stage = await stageAll(cwd, this.git)
    if (!stage.ok) {
      return { ok: false, subject: '', sha: null, why: (stage.err || stage.out).trim() || 'git could not stage the folder.', nothing: false }
    }

    const files = await staged(cwd, this.git)
    if (!files.length) return { ok: false, subject: '', sha: null, why: 'Nothing has changed since the last commit.', nothing: true }

    let text = chosen
    if (text === null) {
      const described: FileChange[] = []
      for (const file of files) {
        described.push({
          path: file.path,
          status: file.status,
          before: file.status === 'A' ? null : await atHead(cwd, file.path, this.git),
          after: file.status === 'D' ? null : readOr(join(cwd, file.path)),
        })
      }
      text = commitMessage(described, this.where.project)
    }

    const done = await commit(cwd, text, this.git)
    return { ok: done.ok, subject: done.subject, sha: done.sha, why: done.why ?? '', nothing: false }
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.watcher?.close()
    this.held?.release()
  }
}

function readOr(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    /* A binary file, or one deleted between the staging and the read. Either way
       there is no text to diff, and `describeFile` says something dull and true
       about it rather than inventing a count. */
    return null
  }
}

/* ------------------------------------------------------------------ *
 * One per project, and no more
 * ------------------------------------------------------------------ */

const running = new Map<string, Committer>()

/** What one look at a project found, without having changed anything to find it. */
export interface Look {
  ok: boolean
  /** Null when no project is open, which is an ordinary state and not a refusal. */
  why: string | null
  at: At
  stance: Stance | null
  /** `<project>/.kehikot`, or null when no project is open. */
  path: string | null
}

/**
 * What is around this project's `.kehikot`, and whether it is a repository —
 * asked without answering it.
 *
 * **This creates nothing.** It runs three `git` reads (`rev-parse
 * --show-toplevel`, `ls-files`, `check-ignore`) and a handful of `existsSync`
 * calls, and there is no path through it that makes a directory, runs `init`, or
 * writes a file. `ensure` is passed `asked: false`, which is the flag that stops
 * it before any of that.
 *
 * It is what `GET /api/histories` uses, so a pane opened against somebody's
 * project can SAY what it found — "your repository already keeps this folder",
 * "there is no history of this folder anywhere" — without doing anything about
 * it. Saying and doing were the same call before, which is how the doing got
 * done without anybody asking.
 */
export async function look(projectPath: string | null, git: GitRunner = spawnGit): Promise<Look> {
  const found = locate(projectPath)
  if (found.ok === null) return { ok: false, why: null, at: 'waiting', stance: null, path: null }
  if (found.ok === false) return { ok: false, why: found.why, at: 'refused', stance: null, path: null }

  const stance = await surrounding(found.where, git)
  const made = await ensure(found.where, git, stance, false)
  return { ok: made.ok, why: made.why, at: made.at, stance, path: found.where.kehikot }
}

/**
 * Make sure this project's data folder is a repository and is being committed
 * to, and say where that stands.
 *
 * Idempotent: a second call against a project already running returns what is
 * already running rather than starting a second committer.
 *
 * ## `asked`, which is the whole of the fix
 *
 * `asked: true` comes from one place — the "Start a history here" press on the
 * pane — and means a person has read a sentence naming the folder and pressed
 * anyway. Everything else passes `asked: false`, which starts committing to a
 * repository that is ALREADY there and never makes one.
 *
 * That second half matters and is easy to miss: a project whose `.kehikot` is
 * already a repository is a project where somebody has already pressed, once,
 * and asking again every time the pane loads would be a confirmation dialog for
 * a decision that has been made. So the automatic commits resume on their own
 * there, and only there.
 *
 * ## Why this is not called from a read
 *
 * `GET /api/histories` uses `look()` above, which creates nothing. Starting is a
 * `POST` carrying the page's ticket. Both are acts, and both are the kind a
 * person can point at afterwards.
 */
export async function watching(
  projectPath: string | null,
  git: GitRunner = spawnGit,
  asked = false,
  quietMs = QUIET_MS,
  mostMs = MOST_MS,
): Promise<{ ok: boolean; why: string | null; standing: Standing | null; created: boolean; at: At }> {
  const found = locate(projectPath)
  if (found.ok === null) return { ok: false, why: null, standing: null, created: false, at: 'waiting' }
  if (found.ok === false) return { ok: false, why: found.why, standing: null, created: false, at: 'refused' }

  const key = found.where.project
  const already = running.get(key)
  if (already) {
    return {
      ok: already.standing.committing,
      why: already.standing.why,
      standing: already.standing,
      created: false,
      at: already.standing.at,
    }
  }

  const one = new Committer(found.where, git, quietMs, mostMs)
  running.set(key, one)
  const made = await one.start(asked)
  if (!made.ok) {
    /* Not kept in the map. `waiting` and `elsewhere` are states a press or a
       change to somebody's .gitignore can move out of, and a committer parked in
       the map holding a stale one would answer for the project forever. */
    running.delete(key)
    one.stop()
    return { ok: false, why: made.why, standing: null, created: false, at: made.at }
  }
  return {
    ok: one.standing.committing,
    why: one.standing.why,
    standing: one.standing,
    created: made.created,
    at: made.at,
  }
}

/** How the committer for a project is standing, without starting one. */
export function standing(projectPath: string | null): Standing | null {
  const found = locate(projectPath)
  if (found.ok !== true) return null
  return running.get(found.where.project)?.standing ?? null
}

/**
 * Commit this project's data folder now, under a message somebody chose.
 *
 * ## Two repositories this could mean, and they are not offered on the same terms
 *
 * When `.kehikot` is a repository of its own, this goes through the same
 * committer as the automatic one, so the single-flight guard and the
 * cross-process lock apply to it too. A deliberate commit from a process that is
 * not the committer is refused rather than made — the point of having one
 * committer, and it would be undone by an exception for the deliberate case.
 *
 * When the repository AROUND the project is the one keeping the folder, the
 * commit goes there instead — pathspec-scoped, carrying `.kehikot` and nothing
 * else, with the refusals `git/enclosing.ts` sets out. And it requires `press`.
 *
 * ## Why `press`
 *
 * `press` is true for the button on the pane and false for the MCP `record`
 * tool, and the difference is not squeamishness. A commit into a repository this
 * module made is a commit in a folder nobody else reads. A commit into
 * somebody's own repository lands in the log they read, next to the work they
 * were doing, attributed to them. That is a thing a person does; an agent that
 * did it on its own would be writing lines into somebody's history in their
 * name, which nothing here is entitled to. `record` gets a sentence saying where
 * the press is.
 */
export async function commitNow(
  projectPath: string | null,
  message: string | null,
  git: GitRunner = spawnGit,
  press = false,
): Promise<{ ok: boolean; said: string; sha: string | null }> {
  const found = locate(projectPath)
  if (found.ok === null) {
    return { ok: false, said: 'There is no project open, so there is no folder to commit.', sha: null }
  }
  if (found.ok === false) return { ok: false, said: found.why, sha: null }

  const seen = await look(projectPath, git)

  if (seen.at === 'elsewhere' && seen.stance) {
    if (!press) {
      return {
        ok: false,
        said:
          `${saying(seen.stance, found.where.kehikot)} Nothing commits into somebody's own repository by itself or `
          + 'from a tool — that press is on the History pane, made by the person whose repository it is.',
        sha: null,
      }
    }
    const landed = await commitInto(seen.stance, found.where.kehikot, message, git)
    return { ok: landed.ok, said: landed.said, sha: landed.sha }
  }

  if (seen.at === 'waiting' || seen.at === 'refused') {
    return {
      ok: false,
      said:
        seen.why
        ?? `${found.where.kehikot} is not a repository, so there is nothing there to commit to yet.`,
      sha: null,
    }
  }

  /* A repository is already there, so this starts committing to it without
     asking again — see `watching`. */
  const started = await watching(projectPath, git, false)
  if (!started.standing) {
    return { ok: false, said: started.why ?? 'That folder could not be committed to.', sha: null }
  }
  if (!started.standing.committing) {
    return { ok: false, said: started.standing.why ?? 'This process is not the committer for that folder.', sha: null }
  }
  const one = running.get(found.where.project)
  if (!one) return { ok: false, said: 'Nothing is watching that folder.', sha: null }

  const done = await one.commitNow(message)
  if (done.nothing) return { ok: false, said: done.why, sha: null }
  if (!done.ok) return { ok: false, said: done.why, sha: null }
  return { ok: true, said: `Committed: ${done.subject}`, sha: done.sha }
}

/** Stop everything. For tests, and for a tidy shutdown. */
export function stopAll(): void {
  for (const one of running.values()) one.stop()
  running.clear()
}

/** Re-exported so `doors.ts` has one import for the reading side too. */
export { read, locate }
