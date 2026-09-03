import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { pull, push, tracking } from '../git/remote.ts'
import { read } from '../git/repo.ts'
import { spawnGit, type GitResult, type GitRunner } from '../git/run.ts'

/**
 * Push and pull: what is asked of git, and what comes back for a person.
 *
 * Two halves. The first is the fake runner every other file uses — the
 * argument arrays are the thing to assert, because they are what keeps a push
 * a fast-forward and a pull an `--ff-only`. The second is a real git against a
 * BARE repository in a scratch directory standing in for the remote: nothing
 * leaves this machine, and the scratch is removed when each test is done.
 */

const US = '\x1f'

function fakeGit(answers: Record<string, Partial<GitResult>> = {}) {
  const calls: string[][] = []
  const run: GitRunner = async (args) => {
    calls.push(args)
    const key = args.find((arg, index) => !arg.startsWith('-') && args[index - 1] !== '-c') ?? ''
    const said = answers[args.join(' ')] ?? answers[key] ?? { ok: true, out: '' }
    return { ok: said.ok ?? true, code: said.code ?? 0, out: said.out ?? '', err: said.err ?? '' }
  }
  return { run, calls }
}

/** One `for-each-ref` line, the way git prints it for the current branch. */
const line = (fields: Partial<Record<'upstream' | 'upRemote' | 'upRef' | 'upTrack' | 'push' | 'pushRemote' | 'pushRef' | 'pushTrack', string>> = {}, branch = 'main') =>
  ['*', branch, fields.upstream ?? '', fields.upRemote ?? '', fields.upRef ?? '', fields.upTrack ?? '', fields.push ?? '', fields.pushRemote ?? '', fields.pushRef ?? '', fields.pushTrack ?? ''].join(US)

const tracked = (extra: Record<string, Partial<GitResult>> = {}) => ({
  config: { ok: true, out: 'remote.origin.url https://example.invalid/x.git\n' },
  'for-each-ref': {
    ok: true,
    out: line({ upstream: 'origin/main', upRemote: 'origin', upRef: 'refs/heads/main', upTrack: 'ahead 2, behind 1', push: 'origin/main', pushRemote: 'origin', pushRef: 'refs/heads/main', pushTrack: 'ahead 2, behind 1' }),
  },
  'config --get remote.pushDefault': { ok: false, code: 1 },
  'rev-parse --git-path FETCH_HEAD': { ok: true, out: '/nowhere/FETCH_HEAD' },
  ...extra,
})

describe('what the page is told about the remote', () => {
  test('a branch that tracks: remotes, upstream, push destination, ahead and behind', async () => {
    const { run } = fakeGit(tracked())
    const facts = await tracking('/r', run)
    expect(facts.remotes).toEqual(['origin'])
    expect(facts.branch).toBe('main')
    expect(facts.upstream).toBe('origin/main')
    expect(facts.pushTo).toBe('origin/main')
    expect(facts.ahead).toBe(2)
    expect(facts.behind).toBe(1)
    expect(facts.gone).toBe(false)
    expect(facts.publishTo).toBe(null)
    /* FETCH_HEAD at a path that does not exist is "never fetched", not a throw. */
    expect(facts.fetchedAt).toBe(null)
  })

  test('a fork workflow: ahead is counted against where a push GOES, behind against the upstream', async () => {
    const { run } = fakeGit(
      tracked({
        'for-each-ref': {
          ok: true,
          out: line({ upstream: 'upstream/main', upRemote: 'upstream', upRef: 'refs/heads/main', upTrack: 'ahead 5, behind 3', push: 'origin/main', pushRemote: 'origin', pushRef: 'refs/heads/main', pushTrack: 'ahead 1' }),
        },
      }),
    )
    const facts = await tracking('/r', run)
    expect(facts.upstream).toBe('upstream/main')
    expect(facts.pushTo).toBe('origin/main')
    expect(facts.ahead).toBe(1)
    expect(facts.behind).toBe(3)
  })

  test('under push.default=simple git prints the push destination and no push ref; the ref is derived from the name', async () => {
    /* What git 2.50 actually prints for an ordinary `-u origin main` branch:
       `%(push:short)` and `%(push:remotename)` filled, `%(push:remoteref)`
       empty. The push must still name a full ref. */
    const { run, calls } = fakeGit(
      tracked({
        'for-each-ref': {
          ok: true,
          out: line({ upstream: 'origin/main', upRemote: 'origin', upRef: 'refs/heads/main', upTrack: 'ahead 1', push: 'origin/main', pushRemote: 'origin', pushRef: '', pushTrack: 'ahead 1' }),
        },
      }),
    )
    const done = await push('/r', run, false)
    expect(done.ok).toBe(true)
    expect(calls.find((args) => args.includes('push'))).toEqual(['push', 'origin', 'refs/heads/main:refs/heads/main'])
  })

  test('no remote at all is an ordinary answer', async () => {
    const { run } = fakeGit({ config: { ok: false, code: 1 }, 'for-each-ref': { ok: true, out: line() } })
    const facts = await tracking('/r', run)
    expect(facts.remotes).toEqual([])
    expect(facts.upstream).toBe(null)
    expect(facts.publishTo).toBe(null)
  })

  test('no upstream and one remote: that remote is where a first push would go', async () => {
    const { run } = fakeGit(tracked({ 'for-each-ref': { ok: true, out: line() } }))
    const facts = await tracking('/r', run)
    expect(facts.upstream).toBe(null)
    expect(facts.publishTo).toBe('origin')
  })

  test('no upstream and several remotes: origin if there is one, pushDefault over that, and otherwise nobody decides', async () => {
    const two = 'remote.fork.url a\nremote.origin.url b\n'
    let facts = await tracking('/r', fakeGit(tracked({ config: { ok: true, out: two }, 'for-each-ref': { ok: true, out: line() } })).run)
    expect(facts.publishTo).toBe('origin')

    facts = await tracking(
      '/r',
      fakeGit(tracked({ config: { ok: true, out: two }, 'config --get remote.pushDefault': { ok: true, out: 'fork\n' }, 'for-each-ref': { ok: true, out: line() } })).run,
    )
    expect(facts.publishTo).toBe('fork')

    facts = await tracking('/r', fakeGit(tracked({ config: { ok: true, out: 'remote.a.url a\nremote.b.url b\n' }, 'for-each-ref': { ok: true, out: line() } })).run)
    expect(facts.remotes).toEqual(['a', 'b'])
    expect(facts.publishTo).toBe(null)
  })

  test('detached HEAD has no current branch line, and that is reported as no branch', async () => {
    const { run } = fakeGit(tracked({ 'for-each-ref': { ok: true, out: ' ' + line().slice(1) } }))
    const facts = await tracking('/r', run)
    expect(facts.branch).toBe(null)
  })

  test('an upstream that is gone is said, and not counted as ahead', async () => {
    const { run } = fakeGit(tracked({ 'for-each-ref': { ok: true, out: line({ upstream: 'origin/old', upRemote: 'origin', upRef: 'refs/heads/old', upTrack: 'gone', push: 'origin/old', pushRemote: 'origin', pushRef: 'refs/heads/old', pushTrack: 'gone' }) } }))
    const facts = await tracking('/r', run)
    expect(facts.gone).toBe(true)
    expect(facts.ahead).toBe(0)
  })
})

describe('what git is asked to push, and how the answer is said', () => {
  test('a tracking branch is pushed to exactly where git says it goes, one explicit refspec, no flags', async () => {
    const { run, calls } = fakeGit(tracked())
    const done = await push('/r', run, false)
    expect(done.ok).toBe(true)
    expect(done.said).toBe('Pushed 2 commits to origin/main.')
    const sent = calls.find((args) => args.includes('push'))
    expect(sent).toEqual(['push', 'origin', 'refs/heads/main:refs/heads/main'])
  })

  test('the person’s own repository gets its pre-push hook; the .kehikot one does not', async () => {
    const own = fakeGit(tracked())
    await push('/r', own.run, true)
    expect(own.calls.find((args) => args.includes('push'))).toEqual(['-c', 'core.hooksPath=.git/hooks', 'push', 'origin', 'refs/heads/main:refs/heads/main'])
  })

  test('a first push publishes with --set-upstream and says so', async () => {
    const { run, calls } = fakeGit(tracked({ 'for-each-ref': { ok: true, out: line({}, 'feature/x') } }))
    const done = await push('/r', run, false)
    expect(done.ok).toBe(true)
    expect(done.said).toContain('Published feature/x to origin/feature/x')
    expect(done.said).toContain('now tracks origin/feature/x')
    expect(calls.find((args) => args.includes('push'))).toEqual(['push', '--set-upstream', 'origin', 'refs/heads/feature/x:refs/heads/feature/x'])
  })

  test('nothing to push is said, and git is not asked', async () => {
    const { run, calls } = fakeGit(tracked({ 'for-each-ref': { ok: true, out: line({ upstream: 'origin/main', upRemote: 'origin', upRef: 'refs/heads/main', push: 'origin/main', pushRemote: 'origin', pushRef: 'refs/heads/main' }) } }))
    const done = await push('/r', run, false)
    expect(done.ok).toBe(true)
    expect(done.said).toContain('Nothing to push')
    expect(calls.some((args) => args.includes('push'))).toBe(false)
  })

  test('detached, no remote, and several remotes with no rule are each refused before git', async () => {
    const detached = await push('/r', fakeGit(tracked({ 'for-each-ref': { ok: true, out: '' } })).run, false)
    expect(detached.ok).toBe(false)
    expect(detached.said).toContain('not on a branch')

    const none = await push('/r', fakeGit({ config: { ok: false, code: 1 }, 'for-each-ref': { ok: true, out: line() } }).run, false)
    expect(none.ok).toBe(false)
    expect(none.said).toContain('no remote')

    const which = fakeGit(tracked({ config: { ok: true, out: 'remote.a.url a\nremote.b.url b\n' }, 'for-each-ref': { ok: true, out: line() } }))
    const ambiguous = await push('/r', which.run, false)
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.said).toContain('2 remotes (a, b)')
    expect(which.calls.some((args) => args.includes('push'))).toBe(false)
  })

  test('a non-fast-forward rejection is said as "somebody pushed first, pull", not as a fault', async () => {
    const { run } = fakeGit(tracked({ push: { ok: false, code: 1, err: ' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs\nhint: Updates were rejected because the remote contains work that you do not have locally.' } }))
    const done = await push('/r', run, false)
    expect(done.ok).toBe(false)
    expect(done.said).toContain('origin/main has commits that main does not')
    expect(done.said).toContain('not a mistake')
    expect(done.said).toContain('Pull to bring their commits in')
    expect(done.said).toContain('git said:')
  })

  test('git having needed to ask is said with the advice to do it once in a terminal, and git’s words after', async () => {
    const { run } = fakeGit(tracked({ push: { ok: false, code: 128, err: "fatal: could not read Username for 'https://example.invalid': terminal prompts disabled" } }))
    const done = await push('/r', run, false)
    expect(done.ok).toBe(false)
    expect(done.said).toContain('cannot answer')
    expect(done.said).toContain('once in a terminal')
    expect(done.said).toContain('terminal prompts disabled')
  })
})

describe('what git is asked to pull, and how the answer is said', () => {
  const clean = (extra: Record<string, Partial<GitResult>> = {}) =>
    tracked({ status: { ok: true, out: '' }, 'rev-parse HEAD': { ok: true, out: 'a'.repeat(40) }, ...extra })

  test('a pull is --ff-only --no-rebase from exactly the upstream, and nothing else', async () => {
    const { run, calls } = fakeGit(clean())
    const done = await pull('/r', run, false)
    expect(done.ok).toBe(true)
    expect(calls.find((args) => args.includes('pull'))).toEqual(['pull', '--ff-only', '--no-rebase', 'origin', 'refs/heads/main'])
  })

  test('HEAD unchanged after a successful pull is "already up to date"', async () => {
    const { run } = fakeGit(clean())
    const done = await pull('/r', run, false)
    expect(done.ok).toBe(true)
    expect(done.said).toContain('already up to date with origin/main')
  })

  test('uncommitted work is refused before git, naming the files, as a checkout is', async () => {
    const { run, calls } = fakeGit(clean({ status: { ok: true, out: ' M a.txt\0?? b/\0' } }))
    const done = await pull('/r', run, false)
    expect(done.ok).toBe(false)
    expect(done.said).toContain('not committed, so nothing was pulled')
    expect(done.wouldLose).toEqual(['a.txt', 'b/'])
    expect(calls.some((args) => args.includes('pull'))).toBe(false)
  })

  test('no upstream is refused before git, and says push sets one', async () => {
    const { run, calls } = fakeGit(clean({ 'for-each-ref': { ok: true, out: line() } }))
    const done = await pull('/r', run, false)
    expect(done.ok).toBe(false)
    expect(done.said).toContain('no upstream branch')
    expect(done.said).toContain('Push from here first')
    expect(calls.some((args) => args.includes('pull'))).toBe(false)
  })

  test('a pull that cannot fast-forward is said as a merge for a terminal, and that the fetch half happened', async () => {
    const { run } = fakeGit(clean({ pull: { ok: false, code: 128, err: 'fatal: Not possible to fast-forward, aborting.' } }))
    const done = await pull('/r', run, false)
    expect(done.ok).toBe(false)
    expect(done.said).toContain('both moved')
    expect(done.said).toContain('this pane does neither')
    expect(done.said).toContain('Nothing here was changed')
    expect(done.said).toContain('fetch half did happen')
    expect(done.said).toContain('Not possible to fast-forward')
  })
})

/* ------------------------------------------------------------------ *
 * Real git, against a bare repository standing in for the remote
 * ------------------------------------------------------------------ */

describe('against a bare origin in a scratch directory', () => {
  const sh = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString()

  /** A bare origin, and a clone of it with one commit pushed. Returns both, plus a second clone for the other side. */
  function stage() {
    const base = mkdtempSync(join(tmpdir(), 'kehikko-history-remote-'))
    const origin = join(base, 'origin.git')
    const ours = join(base, 'ours')
    const theirs = join(base, 'theirs')
    sh(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin)
    sh(base, 'clone', '--quiet', origin, ours)
    sh(ours, 'config', 'user.name', 'Ours')
    sh(ours, 'config', 'user.email', 'ours@example.invalid')
    writeFileSync(join(ours, 'a.txt'), 'one\n')
    sh(ours, 'add', 'a.txt')
    sh(ours, 'commit', '--quiet', '-m', 'one')
    sh(ours, 'push', '--quiet', '-u', 'origin', 'main')
    sh(base, 'clone', '--quiet', origin, theirs)
    sh(theirs, 'config', 'user.name', 'Theirs')
    sh(theirs, 'config', 'user.email', 'theirs@example.invalid')
    return { base, origin, ours, theirs, done: () => rmSync(base, { recursive: true, force: true }) }
  }

  test('tracking reads a real upstream, and read() carries it', async () => {
    const s = stage()
    writeFileSync(join(s.ours, 'b.txt'), 'two\n')
    sh(s.ours, 'add', 'b.txt')
    sh(s.ours, 'commit', '--quiet', '-m', 'two')
    const facts = await tracking(s.ours, spawnGit)
    expect(facts.remotes).toEqual(['origin'])
    expect(facts.upstream).toBe('origin/main')
    expect(facts.pushTo).toBe('origin/main')
    expect(facts.ahead).toBe(1)
    expect(facts.behind).toBe(0)
    expect(facts.fetchedAt).toBeNull()
    const reading = await read(s.ours, 'project', spawnGit)
    expect(reading.remote?.ahead).toBe(1)
    s.done()
  })

  test('push moves the origin forward, and only forward', async () => {
    const s = stage()
    writeFileSync(join(s.ours, 'b.txt'), 'two\n')
    sh(s.ours, 'add', 'b.txt')
    sh(s.ours, 'commit', '--quiet', '-m', 'two')
    const done = await push(s.ours, spawnGit, true)
    expect(done.ok).toBe(true)
    expect(done.said).toBe('Pushed 1 commit to origin/main.')
    expect(sh(s.origin, 'log', '--format=%s', 'main')).toBe('two\none\n')
    expect((await tracking(s.ours, spawnGit)).ahead).toBe(0)
    s.done()
  })

  test('a push the origin cannot fast-forward is rejected, nothing changes, and the sentence says to pull', async () => {
    const s = stage()
    /* They push first. */
    writeFileSync(join(s.theirs, 'c.txt'), 'theirs\n')
    sh(s.theirs, 'add', 'c.txt')
    sh(s.theirs, 'commit', '--quiet', '-m', 'theirs')
    sh(s.theirs, 'push', '--quiet', 'origin', 'main')
    /* We commit on the old base and push. */
    writeFileSync(join(s.ours, 'b.txt'), 'ours\n')
    sh(s.ours, 'add', 'b.txt')
    sh(s.ours, 'commit', '--quiet', '-m', 'ours')
    const done = await push(s.ours, spawnGit, true)
    expect(done.ok).toBe(false)
    expect(done.said).toContain('origin/main has commits that main does not')
    expect(done.said).toContain('Pull to bring their commits in')
    expect(sh(s.origin, 'log', '--format=%s', 'main')).toBe('theirs\none\n')
    s.done()
  })

  test('pull fast-forwards, counts what came in, and writes FETCH_HEAD so the page knows when', async () => {
    const s = stage()
    writeFileSync(join(s.theirs, 'c.txt'), 'theirs\n')
    sh(s.theirs, 'add', 'c.txt')
    sh(s.theirs, 'commit', '--quiet', '-m', 'theirs')
    sh(s.theirs, 'push', '--quiet', 'origin', 'main')
    const done = await pull(s.ours, spawnGit, true)
    expect(done.ok).toBe(true)
    expect(done.said).toContain('Pulled 1 commit from origin/main')
    expect(sh(s.ours, 'log', '--format=%s')).toBe('theirs\none\n')
    const facts = await tracking(s.ours, spawnGit)
    expect(facts.fetchedAt).not.toBeNull()
    expect(facts.behind).toBe(0)
    const again = await pull(s.ours, spawnGit, true)
    expect(again.ok).toBe(true)
    expect(again.said).toContain('already up to date')
    s.done()
  })

  test('a pull that would need a merge is refused by git, the working tree is untouched, and no conflict marker exists', async () => {
    const s = stage()
    writeFileSync(join(s.theirs, 'a.txt'), 'theirs\n')
    sh(s.theirs, 'commit', '--quiet', '-am', 'theirs')
    sh(s.theirs, 'push', '--quiet', 'origin', 'main')
    writeFileSync(join(s.ours, 'a.txt'), 'ours\n')
    sh(s.ours, 'commit', '--quiet', '-am', 'ours')
    const before = sh(s.ours, 'rev-parse', 'HEAD')
    const done = await pull(s.ours, spawnGit, true)
    expect(done.ok).toBe(false)
    expect(done.said).toContain('both moved')
    expect(done.said).toContain('terminal')
    expect(sh(s.ours, 'rev-parse', 'HEAD')).toBe(before)
    expect(sh(s.ours, 'status', '--porcelain')).toBe('')
    /* The fetch half happened: the page's count is now current. */
    expect((await tracking(s.ours, spawnGit)).behind).toBe(1)
    s.done()
  })

  test('a repository with no remote answers no remote, and push says so without running one', async () => {
    const base = mkdtempSync(join(tmpdir(), 'kehikko-history-remote-'))
    sh(base, 'init', '--quiet', '--initial-branch=main')
    sh(base, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'one')
    const facts = await tracking(base, spawnGit)
    expect(facts.remotes).toEqual([])
    const done = await push(base, spawnGit, true)
    expect(done.ok).toBe(false)
    expect(done.said).toContain('no remote')
    rmSync(base, { recursive: true, force: true })
  })
})
