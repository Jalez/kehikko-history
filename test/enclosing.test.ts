import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commitInto, surrounding, type Stance } from '../git/enclosing.ts'
import { ensure, locate, type Where } from '../git/repo.ts'
import { spawnGit } from '../git/run.ts'

/**
 * Look before you `init`, asserted against REAL repositories.
 *
 * ## Why this file runs `git` for real when every other test here fakes it
 *
 * Every other test in this repository passes its own runner and asserts the
 * argument array, which is right: the refusals, the message composition and the
 * debounce are all decisions this module makes, and exercising them against a
 * real binary would be slower and would prove less.
 *
 * This file is the exception, and the reason is the whole point of the change it
 * covers. The question being answered — "has the repository around this project
 * already got this folder?" — is a question about `.gitignore` semantics and the
 * git index, and this module deliberately does NOT implement either: it asks
 * `git check-ignore` and `git ls-files`. A test with a fake runner would assert
 * that this module asks the right questions, which is worth something, and would
 * say nothing at all about whether the answers are read correctly. The incident
 * this change comes from was a wrong answer in somebody's thesis, so the answers
 * are what get asserted.
 *
 * Everything is built in a fresh temporary directory and removed afterwards. No
 * test here touches a project of anybody's.
 */

const made: string[] = []

afterEach(() => {
  while (made.length) {
    const path = made.pop()
    if (path) rmSync(path, { recursive: true, force: true })
  }
})

/** A scratch project directory with a `.kehikot` in it, removed after the test. */
function project(withKehikot = true): string {
  const path = mkdtempSync(join(tmpdir(), 'kehikko-history-enclosing-'))
  made.push(path)
  if (withKehikot) {
    mkdirSync(join(path, '.kehikot', 'notes'), { recursive: true })
    writeFileSync(join(path, '.kehikot', 'notes', 'notes.json'), '{"notes":[]}\n')
  }
  return path
}

async function git(args: string[], cwd: string) {
  const result = await spawnGit(args, { cwd })
  if (!result.ok) throw new Error(`git ${args.join(' ')} in ${cwd}: ${result.err || result.out}`)
  return result
}

/** A repository around a project, with an identity, so a commit in it is possible. */
async function repoAround(path: string): Promise<void> {
  await git(['init', '--initial-branch=main'], path)
  await git(['config', 'user.name', 'Scratch'], path)
  await git(['config', 'user.email', 'scratch@example.invalid'], path)
}

function where(path: string): Where {
  const found = locate(path)
  if (found.ok !== true) throw new Error('the scratch project did not locate')
  return found.where
}

describe('the test that tells tracked from ignored from no repository', () => {
  test('no repository above it at all is `alone`', async () => {
    const path = project()
    expect((await surrounding(where(path), spawnGit)).at).toBe('alone')
  })

  test('a repository that ignores the folder is `declined`', async () => {
    const path = project()
    await repoAround(path)
    writeFileSync(join(path, '.gitignore'), '.kehikot/\n')
    const stance = await surrounding(where(path), spawnGit)
    expect(stance.at).toBe('declined')
  })

  test('a repository that tracks a file in the folder is `kept`', async () => {
    const path = project()
    await repoAround(path)
    await git(['add', '--', '.kehikot/notes/notes.json'], path)
    await git(['commit', '-m', 'the folder belongs here'], path)
    const stance = await surrounding(where(path), spawnGit)
    expect(stance.at).toBe('kept')
  })

  /**
   * The state the thesis was in for the minutes between the host's "keep
   * .kehikot in git" switch being turned on and the first commit — and the state
   * a brand new project is in before anybody has decided anything.
   *
   * Three answers would collapse this onto `declined` and initialise, which is
   * the original fault a few minutes early.
   */
  test('a repository with no rule and nothing tracked yet is `offered`, not `declined`', async () => {
    const path = project()
    await repoAround(path)
    const stance = await surrounding(where(path), spawnGit)
    expect(stance.at).toBe('offered')
  })

  /**
   * Tracked AND ignored. Git keeps tracking, the rule does nothing, and the
   * honest answer is `kept`. Asking `check-ignore` first would answer `declined`
   * for a folder whose files are in somebody's history right now.
   */
  test('tracked wins over ignored, because that is what git does', async () => {
    const path = project()
    await repoAround(path)
    await git(['add', '--', '.kehikot/notes/notes.json'], path)
    await git(['commit', '-m', 'in the history'], path)
    writeFileSync(join(path, '.gitignore'), '.kehikot/\n')
    expect((await surrounding(where(path), spawnGit)).at).toBe('kept')
  })

  /**
   * The walk starts at the project and not at `.kehikot`.
   *
   * Run from inside `.kehikot`, `rev-parse --show-toplevel` answers `.kehikot`
   * itself the moment this module has already made it a repository — so the
   * check would report "no enclosing repository" precisely in the case it exists
   * to catch, which is the second time it runs.
   */
  test('a .kehikot that is already a repository does not hide the one around it', async () => {
    const path = project()
    await repoAround(path)
    await git(['add', '--', '.kehikot/notes/notes.json'], path)
    await git(['commit', '-m', 'in the history'], path)
    await git(['init', '--initial-branch=main'], join(path, '.kehikot'))
    expect((await surrounding(where(path), spawnGit)).at).toBe('kept')
  })
})

describe('what `ensure` does with each of those answers', () => {
  const dotGit = (path: string) => join(path, '.kehikot', '.git')

  test('alone, and asked: it makes one, and touches nothing outside the folder', async () => {
    const path = project()
    const stance = await surrounding(where(path), spawnGit)
    const made_ = await ensure(where(path), spawnGit, stance, true)
    expect(made_.at).toBe('made')
    expect(existsSync(dotGit(path))).toBe(true)
    /* It used to append `.kehikot` to the project's own .gitignore whenever it
       created the folder. That decision is the host's switch to make, not this
       module's, and it is no longer written from here. */
    expect(existsSync(join(path, '.gitignore'))).toBe(false)
  })

  test('declined, and asked: it makes one', async () => {
    const path = project()
    await repoAround(path)
    writeFileSync(join(path, '.gitignore'), '.kehikot/\n')
    const stance = await surrounding(where(path), spawnGit)
    expect((await ensure(where(path), spawnGit, stance, true)).at).toBe('made')
    expect(existsSync(dotGit(path))).toBe(true)
  })

  test('not asked: nothing is made, and it is `waiting` rather than a fault', async () => {
    const path = project()
    const stance = await surrounding(where(path), spawnGit)
    const seen = await ensure(where(path), spawnGit, stance, false)
    expect(seen.at).toBe('waiting')
    expect(seen.ok).toBe(false)
    expect(existsSync(dotGit(path))).toBe(false)
  })

  test('not asked, and the folder does not exist: it is not created either', async () => {
    const path = project(false)
    const stance = await surrounding(where(path), spawnGit)
    await ensure(where(path), spawnGit, stance, false)
    expect(existsSync(join(path, '.kehikot'))).toBe(false)
  })

  /** The fault this whole change exists to prevent, asserted directly. */
  test('kept: it refuses even when asked, and makes nothing', async () => {
    const path = project()
    await repoAround(path)
    await git(['add', '--', '.kehikot/notes/notes.json'], path)
    await git(['commit', '-m', 'the folder belongs here'], path)
    const stance = await surrounding(where(path), spawnGit)
    const seen = await ensure(where(path), spawnGit, stance, true)
    expect(seen.at).toBe('elsewhere')
    expect(existsSync(dotGit(path))).toBe(false)
    expect(seen.why).toContain('already in the history of the repository at')
    expect(seen.why).toContain(join(path, '.kehikot'))
  })

  test('offered: it refuses even when asked, and makes nothing', async () => {
    const path = project()
    await repoAround(path)
    const stance = await surrounding(where(path), spawnGit)
    const seen = await ensure(where(path), spawnGit, stance, true)
    expect(seen.at).toBe('elsewhere')
    expect(existsSync(dotGit(path))).toBe(false)
  })

  /**
   * The two repositories found on this machine were disabled by renaming `.git`
   * to `.git.disabled`, so what was committed into them is still recoverable.
   * Nothing this module does may resurrect one or write beside one.
   */
  /**
   * The exact shape of the two projects on this machine: a repository around
   * them, `.kehikot/` ignored by it, and a `.git.disabled` inside the folder.
   * Without the check this is `declined` — press Start and a second, empty
   * history appears beside the set-aside one, which becomes unreachable from any
   * ordinary git command.
   */
  test('a .git.disabled beside the folder stops it, and is left exactly as it was', async () => {
    const path = project()
    await repoAround(path)
    writeFileSync(join(path, '.gitignore'), '.kehikot/\n')
    const setAside = join(path, '.kehikot', '.git.disabled')
    mkdirSync(setAside, { recursive: true })
    writeFileSync(join(setAside, 'HEAD'), 'ref: refs/heads/main\n')

    const stance = await surrounding(where(path), spawnGit)
    expect(stance.at).toBe('declined')
    const seen = await ensure(where(path), spawnGit, stance, true)
    expect(seen.at).toBe('refused')
    expect(seen.why).toContain('.git.disabled')
    expect(existsSync(dotGit(path))).toBe(false)
    await expect(Bun.file(join(setAside, 'HEAD')).text()).resolves.toBe('ref: refs/heads/main\n')
  })

  /* Where the enclosing repository is keeping the folder, a set-aside repository
     is not what is stopping anything, and the sentence says where the history
     already is rather than answering a question nobody asked. */
  test('a .git.disabled does not shout over the answer that matters more', async () => {
    const path = project()
    await repoAround(path)
    await git(['add', '--', '.kehikot/notes/notes.json'], path)
    await git(['commit', '-m', 'the folder belongs here'], path)
    mkdirSync(join(path, '.kehikot', '.git.disabled'), { recursive: true })

    const stance = await surrounding(where(path), spawnGit)
    const seen = await ensure(where(path), spawnGit, stance, true)
    expect(seen.at).toBe('elsewhere')
    expect(seen.why).toContain('already in the history of the repository at')
  })
})

describe('a commit into the repository the project is already in', () => {
  async function kept(path: string): Promise<Stance> {
    await repoAround(path)
    await git(['add', '--', '.kehikot/notes/notes.json'], path)
    await git(['commit', '-m', 'the folder belongs here'], path)
    return surrounding(where(path), spawnGit)
  }

  /**
   * The property the whole pathspec argument rests on, measured rather than
   * asserted from the docs: an unrelated file staged in somebody's repository is
   * neither consulted nor recorded, and is still staged afterwards.
   */
  test('it carries .kehikot and nothing else, and leaves other staged work staged', async () => {
    const path = project()
    const stance = await kept(path)

    writeFileSync(join(path, '.kehikot', 'notes', 'notes.json'), '{"notes":[{"id":"a"}]}\n')
    writeFileSync(join(path, 'thesis.tex'), '\\documentclass{article}\n')
    await git(['add', '--', 'thesis.tex'], path)

    const landed = await commitInto(stance, join(path, '.kehikot'), 'notes: one added', spawnGit)
    expect(landed.ok).toBe(true)

    const inCommit = await git(['show', '--name-only', '--format=', 'HEAD'], path)
    expect(inCommit.out).toContain('.kehikot/notes/notes.json')
    expect(inCommit.out).not.toContain('thesis.tex')

    const stillStaged = await git(['diff', '--cached', '--name-only'], path)
    expect(stillStaged.out).toContain('thesis.tex')
  })

  test('nothing changed is its own sentence, not a failure about the repository', async () => {
    const path = project()
    const stance = await kept(path)
    const landed = await commitInto(stance, join(path, '.kehikot'), 'nothing to say', spawnGit)
    expect(landed.ok).toBe(false)
    expect(landed.said).toContain('has changed since the last commit')
  })

  test('with no message it writes a dull true one rather than inventing a description', async () => {
    const path = project()
    const stance = await kept(path)
    writeFileSync(join(path, '.kehikot', 'notes', 'notes.json'), '{"notes":[{"id":"a"}]}\n')
    const landed = await commitInto(stance, join(path, '.kehikot'), null, spawnGit)
    expect(landed.ok).toBe(true)
    const subject = await git(['log', '-1', '--format=%s'], path)
    expect(subject.out.trim()).toBe('.kehikot: 1 file changed under notes')
  })

  /**
   * The one refusal here that cannot be staged with a real repository.
   *
   * `git config --get user.email` reads the person's GLOBAL config as well as
   * the repository's, and unsetting the local one on a machine where a global
   * one exists changes nothing. Isolating `HOME` for one test would mean this
   * file's runner stopped being the runner the module actually uses, so the
   * runner is faked for this case alone and every other case here stays real.
   *
   * What matters is the outcome and it is worth saying plainly: with no
   * configured identity git does not refuse, it INVENTS one — `someone@their-
   * laptop.local`, from the login name and the hostname. A commit in somebody's
   * thesis attributed to an address that does not exist is a wrong answer to
   * "who wrote this", written into a history that keeps it.
   */
  test('no identity configured is a refusal, never a commit under an invented address', async () => {
    const path = project()
    const kehikot = join(path, '.kehikot')
    const wrote: string[][] = []
    const stance: Stance = { at: 'kept', root: path, spec: ':(literal,top).kehikot' }

    const landed = await commitInto(stance, kehikot, 'notes: one added', async (args) => {
      const subcommand = args.find((one) => !one.startsWith('-') && one !== 'core.hooksPath=.git/hooks')
      if (subcommand === 'symbolic-ref') return { ok: true, code: 0, out: 'refs/heads/main', err: '' }
      if (subcommand === 'config') {
        /* A name, and no address. Both are asked for and the refusal names
           whichever is missing. */
        const forName = args.includes('user.name')
        return { ok: forName, code: forName ? 0 : 1, out: forName ? 'Scratch' : '', err: '' }
      }
      wrote.push(args)
      return { ok: true, code: 0, out: '', err: '' }
    })

    expect(landed.ok).toBe(false)
    expect(landed.said).toContain('user.email')
    expect(landed.said).toContain('Nothing was committed')
    /* And it stopped before anything: no status, no add, no commit. */
    expect(wrote.some((args) => args.includes('add') || args.includes('commit'))).toBe(false)
  })

  test('a detached HEAD is a refusal that says how to get off it', async () => {
    const path = project()
    const stance = await kept(path)
    const head = await git(['rev-parse', 'HEAD'], path)
    await git(['checkout', head.out.trim(), '--'], path)
    writeFileSync(join(path, '.kehikot', 'notes', 'notes.json'), '{"notes":[{"id":"a"}]}\n')
    const landed = await commitInto(stance, join(path, '.kehikot'), 'notes: one added', spawnGit)
    expect(landed.ok).toBe(false)
    expect(landed.said).toContain('not on a branch')
    expect(landed.said).toContain('Check out a branch')
  })

  test('it refuses outright for a stance where the folder has its own history', async () => {
    const path = project()
    const landed = await commitInto({ at: 'alone' }, join(path, '.kehikot'), 'anything', spawnGit)
    expect(landed.ok).toBe(false)
    expect(landed.said).toContain('not in a repository this module would commit into')
  })
})
