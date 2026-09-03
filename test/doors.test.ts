import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TICKET, answer } from '../doors.ts'
import type { GitResult, GitRunner } from '../git/run.ts'
import { locate, parseStatus } from '../git/repo.ts'

/**
 * Every door, with git injected and no `git` binary run.
 *
 * The runner records what it was ASKED, which is the thing worth asserting: this
 * whole module is one long argument that request text never reaches a command
 * line, and the way to check that is to look at the array.
 */

function fakeGit(answers: Record<string, Partial<GitResult>> = {}) {
  const calls: string[][] = []
  const run: GitRunner = async (args) => {
    calls.push(args)
    const key = args.find((arg) => !arg.startsWith('-')) ?? ''
    const said = answers[args.join(' ')] ?? answers[key] ?? { ok: true, out: '' }
    return { ok: said.ok ?? true, code: said.code ?? 0, out: said.out ?? '', err: said.err ?? '' }
  }
  return { run, calls }
}

const rpc = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
})

const textOf = (reply: unknown): string => {
  const body = reply as { body?: { result?: { content?: { text?: string }[] } } }
  return body.body?.result?.content?.[0]?.text ?? ''
}

const isError = (reply: unknown): boolean => {
  const body = reply as { body?: { result?: { isError?: boolean } } }
  return body.body?.result?.isError === true
}

const scratch = () => {
  const project = mkdtempSync(join(tmpdir(), 'kehikko-history-doors-'))
  mkdirSync(join(project, '.kehikot', 'notes'), { recursive: true })
  writeFileSync(join(project, '.kehikot', 'notes', 'notes.json'), '{"notes":[]}')
  return project
}

const post = (path: string, body: Record<string, unknown>, git: GitRunner, ticket: string | null = TICKET) =>
  answer('POST', path, new URLSearchParams(), body, ticket, git)

describe('the manifest and the health check', () => {
  test('health answers about the program and counts nothing', async () => {
    const { run } = fakeGit()
    const reply = await answer('GET', '/healthz', new URLSearchParams(), null, null, run)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { id: string }).id).toBe('roadmap.history')
  })

  test('a path this module does not own is handed back to Vite', async () => {
    const { run } = fakeGit()
    expect(await answer('GET', '/src/main.tsx', new URLSearchParams(), null, null, run)).toBe(null)
  })
})

describe('every write carries the ticket', () => {
  test('a POST without it is refused, and the sentence says to reload', async () => {
    const { run, calls } = fakeGit()
    const reply = await post('/api/commit', { project: '/tmp' }, run, null)
    expect(reply?.status).toBe(403)
    expect((reply?.body as { error: string }).error).toContain('reload the pane')
    /* And nothing was run. A refusal that had already shelled out would be no
       refusal at all. */
    expect(calls).toHaveLength(0)
  })

  test('a POST with somebody else’s ticket is refused the same way', async () => {
    const { run } = fakeGit()
    const reply = await post('/api/watch', { project: '/tmp' }, run, 'not-the-ticket')
    expect(reply?.status).toBe(403)
  })
})

describe('no project is refused rather than defaulted', () => {
  test('the MCP door says what to pass and why it will not guess', async () => {
    const { run, calls } = fakeGit()
    const reply = await answer('POST', '/mcp', new URLSearchParams(), rpc('history', { which: 'project' }), null, run)
    expect(isError(reply)).toBe(true)
    expect(textOf(reply)).toContain('this needs project')
    expect(textOf(reply)).toContain('will not guess')
    expect(calls).toHaveLength(0)
  })

  test('a write door says the same thing', async () => {
    const { run } = fakeGit()
    const reply = await post('/api/commit', {}, run)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('this needs project')
  })

  test('a read with no project is an ordinary state, not a refusal', async () => {
    const { run } = fakeGit()
    const reply = await answer('GET', '/api/histories', new URLSearchParams(), null, null, run)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { nowhere: boolean }).nowhere).toBe(true)
  })
})

describe('the MCP door has the shape the other modules have', () => {
  test('initialize names this module and says what the two histories are', async () => {
    const { run } = fakeGit()
    const reply = await answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'initialize' }, null, run)
    const result = (reply?.body as { result: { serverInfo: { name: string }; instructions: string } }).result
    expect(result.serverInfo.name).toBe('roadmap.history')
    expect(result.instructions).toContain('.kehikot')
  })

  test('a notification is answered with nothing', async () => {
    const { run } = fakeGit()
    const reply = await answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', method: 'notifications/initialized' }, null, run)
    expect(reply?.status).toBe(202)
    expect(reply?.body).toBe(null)
  })

  test('tools/list offers exactly the four, and nothing that moves HEAD', async () => {
    const { run } = fakeGit()
    const reply = await answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null, run)
    const names = (reply?.body as { result: { tools: { name: string }[] } }).result.tools.map((one) => one.name)
    expect(names).toEqual(['history', 'record', 'show_commit', 'restore_file'])
    expect(names).not.toContain('checkout')
    expect(names).not.toContain('branch')
  })

  test('an unknown tool is answered with a sentence naming what is here', async () => {
    const { run } = fakeGit()
    const reply = await answer('POST', '/mcp', new URLSearchParams(), rpc('checkout', { project: '/tmp' }), null, run)
    expect(isError(reply)).toBe(true)
    expect(textOf(reply)).toContain('nothing that moves HEAD')
  })

  test('the door takes POST and says so on anything else', async () => {
    const { run } = fakeGit()
    const reply = await answer('GET', '/mcp', new URLSearchParams(), null, null, run)
    expect(reply?.status).toBe(405)
  })

  test('a body that is not a request is a -32600 rather than a crash', async () => {
    const { run } = fakeGit()
    const reply = await answer('POST', '/mcp', new URLSearchParams(), { hello: 'there' }, null, run)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: { code: number } }).error.code).toBe(-32600)
  })
})

describe('nothing a request supplies reaches git unchecked', () => {
  test('a branch name that is an option is refused, and git is never asked', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit({ 'rev-parse --show-toplevel': { ok: true, out: project } })
    const reply = await post('/api/switch', { project, which: 'kehikot', branch: '--upload-pack=/tmp/x' }, run)
    /* 200 with `ok: false`, like every other answer from a git operation: a
       refusal here is a sentence the page draws, not an HTTP error. What is
       asserted is the sentence and the absence of the call. */
    const body = reply?.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('option')
    /* `status --porcelain` is the only thing that ran: the refusal happens after
       the dirty check and before anything is moved. */
    expect(calls.every((args) => args[0] !== 'checkout')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('a path that climbs out of the repository never reaches a restore', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit()
    const reply = await post(
      '/api/restore',
      { project, which: 'kehikot', commit: 'HEAD', path: '../../etc/passwd', overwrite: true },
      run,
    )
    expect((reply?.body as { ok: boolean }).ok).toBe(false)
    expect(calls.every((args) => args[0] !== 'restore')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('a commit named by a revision expression is refused before a show', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit()
    const reply = await post('/api/show', { project, which: 'kehikot', commit: 'HEAD~3' }, run)
    expect((reply?.body as { ok: boolean }).ok).toBe(false)
    expect(calls.every((args) => args[0] !== 'show')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('push and pull are doors, carry the ticket, and hand git exactly one forward refspec', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const US = '\x1f'
    const current = ['*', 'main', 'origin/main', 'origin', 'refs/heads/main', 'ahead 1', 'origin/main', 'origin', 'refs/heads/main', 'ahead 1'].join(US)
    const { run, calls } = fakeGit({
      config: { ok: true, out: 'remote.origin.url /tmp/origin.git\n' },
      'for-each-ref': { ok: true, out: current },
      'rev-parse HEAD': { ok: true, out: 'a'.repeat(40) },
    })

    const refused = await post('/api/push', { project, which: 'kehikot' }, run, null)
    expect(refused?.status).toBe(403)

    const pushed = await post('/api/push', { project, which: 'kehikot' }, run)
    expect((pushed?.body as { ok: boolean; said: string }).ok).toBe(true)
    expect((pushed?.body as { said: string }).said).toBe('Pushed 1 commit to origin/main.')
    expect(calls.find((args) => args.includes('push'))).toEqual(['push', 'origin', 'refs/heads/main:refs/heads/main'])

    const pulled = await post('/api/pull', { project, which: 'kehikot' }, run)
    expect((pulled?.body as { ok: boolean }).ok).toBe(true)
    expect(calls.find((args) => args.includes('pull'))).toEqual(['pull', '--ff-only', '--no-rebase', 'origin', 'refs/heads/main'])
    /* Nothing that ran carried a flag the allowlist refuses; the fake runner
       does not vet, so this is asserted on the arrays themselves. */
    for (const args of calls) {
      expect(args.some((arg) => /^--force|^-f$|^--delete|^--mirror|^--rebase|^--receive-pack|^--upload-pack/.test(arg))).toBe(false)
    }
    rmSync(project, { recursive: true, force: true })
  })

  test('there is no MCP tool that pushes or pulls', async () => {
    const { run, calls } = fakeGit()
    const reply = await answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null, run)
    const names = ((reply?.body as { result: { tools: { name: string }[] } }).result.tools).map((tool) => tool.name)
    expect(names).not.toContain('push')
    expect(names).not.toContain('pull')
    const tried = await answer('POST', '/mcp', new URLSearchParams(), rpc('push', { project: '/tmp' }), null, run)
    expect(isError(tried)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  test('a project path that is not absolute is refused with the reason', async () => {
    const { run } = fakeGit()
    const reply = await answer('GET', '/api/histories', new URLSearchParams([['project', 'relative/thing']]), null, null, run)
    expect((reply?.body as { trouble: string }).trouble).toContain('not an absolute path')
  })
})

describe('a checkout is refused over uncommitted work, and names it', () => {
  test('the refusal lists the files and offers the two ways forward', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit({
      'status --porcelain -z': { ok: true, out: ' M notes/notes.json\0?? notes/draft.json\0' },
    })
    const reply = await post('/api/switch', { project, which: 'kehikot', branch: 'main' }, run)
    const body = reply?.body as { ok: boolean; error: string; wouldLose: string[] }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('Commit it, or stash it')
    expect(body.error).toContain('out from under it mid-write')
    expect(body.wouldLose).toEqual(['notes/notes.json', 'notes/draft.json'])
    /* And nothing moved. */
    expect(calls.every((args) => args[0] !== 'checkout')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('a clean tree checks out, and the answer says where you have landed', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit({
      'status --porcelain -z': { ok: true, out: '' },
      'symbolic-ref --quiet --short HEAD': { ok: true, out: 'main\n' },
    })
    const reply = await post('/api/switch', { project, which: 'kehikot', commit: 'a1b2c3d' }, run)
    const body = reply?.body as { ok: boolean; said: string }
    expect(body.ok).toBe(true)
    expect(body.said).toContain('detached HEAD')
    expect(body.said).toContain('Press main to go back')
    expect(calls.some((args) => args[0] === 'checkout' && args[1] === 'a1b2c3d')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })
})

describe('a restore names what it would overwrite before it does it', () => {
  test('a file with uncommitted changes is refused the first time', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit({ status: { ok: true, out: ' M notes/notes.json\n' } })
    const reply = await post(
      '/api/restore',
      { project, which: 'kehikot', commit: 'a1b2c3d', path: 'notes/notes.json' },
      run,
    )
    const body = reply?.body as { ok: boolean; error: string; wouldLose: string[] }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('git keeps no copy of what was never committed')
    expect(body.wouldLose).toEqual(['notes/notes.json'])
    expect(calls.every((args) => args[0] !== 'restore')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('said again, it goes ahead — and never with a --force anywhere', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit()
    const reply = await post(
      '/api/restore',
      { project, which: 'kehikot', commit: 'a1b2c3d', path: 'notes/notes.json', overwrite: true },
      run,
    )
    expect((reply?.body as { ok: boolean }).ok).toBe(true)
    const restore = calls.find((args) => args[0] === 'restore')
    expect(restore).toEqual(['restore', '--source=a1b2c3d', '--worktree', '--', 'notes/notes.json'])
    rmSync(project, { recursive: true, force: true })
  })
})

/**
 * The incident, at the door.
 *
 * The page used to POST `/api/watch` on mount and `/api/watch` used to be the
 * thing that ran `git init`. Between them, opening a pane against somebody's
 * project left a repository in it nobody asked for. Both halves are asserted
 * here — one that a read acts on nothing, and one that a write without `asked`
 * acts on nothing either.
 */
describe('nothing initialises without somebody asking', () => {
  test('reading both histories runs no init and makes no directory', async () => {
    const project = scratch()
    rmSync(join(project, '.kehikot'), { recursive: true, force: true })
    const { run, calls } = fakeGit()
    await answer('GET', '/api/histories', new URLSearchParams({ project }), null, null, run)
    expect(calls.some((args) => args[0] === 'init')).toBe(false)
    expect(existsSync(join(project, '.kehikot'))).toBe(false)
    rmSync(project, { recursive: true, force: true })
  })

  test('a watch with no `asked` in the body runs no init', async () => {
    const project = scratch()
    const { run, calls } = fakeGit()
    const reply = await post('/api/watch', { project }, run)
    expect(calls.some((args) => args[0] === 'init')).toBe(false)
    expect((reply?.body as { at: string }).at).toBe('waiting')
    rmSync(project, { recursive: true, force: true })
  })

  /* `asked` is compared to `true` rather than read as truthy, so a body that
     carried a string, or a 1, is a body that does not initialise anything. */
  test('`asked` has to be the boolean true, not merely truthy', async () => {
    const project = scratch()
    const { run, calls } = fakeGit()
    await post('/api/watch', { project, asked: 'yes' }, run)
    expect(calls.some((args) => args[0] === 'init')).toBe(false)
    rmSync(project, { recursive: true, force: true })
  })

  /* And the sentence a person is shown names the folder, in full. The one it
     replaced said "this project's data folder" and was read as being about a
     folder called `data/`, which this module has never touched. */
  test('the sentence about the folder names the folder', async () => {
    const project = scratch()
    const { run } = fakeGit()
    const reply = await answer('GET', '/api/histories', new URLSearchParams({ project }), null, null, run)
    const said = (reply?.body as { said: string | null }).said ?? ''
    expect(said).toContain(locate(project).ok === true ? join(project, '.kehikot') : '.kehikot')
    expect(said).not.toContain('this project’s data folder')
    rmSync(project, { recursive: true, force: true })
  })
})

describe('the data repository is never the project repository', () => {
  test('a .kehikot that is not yet a repository refuses rather than acting on the project’s', async () => {
    /* The failure this closes: `git` inside a `.kehikot` that is not a
       repository walks upward and finds the PROJECT's, so a "commit to the data"
       would land in somebody's thesis. */
    const project = scratch()
    const { run, calls } = fakeGit()
    const reply = await post('/api/show', { project, which: 'kehikot', commit: 'HEAD' }, run)
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('not a repository of its own')
    /* The refusal now carries WHY it is not one, which takes three reads to find
       out — see `look()`. What must still be true is that none of them acts:
       nothing here shows, commits, initialises or moves anything. */
    expect(calls.every((args) => ['rev-parse', 'ls-files', 'check-ignore'].includes(args[0] ?? ''))).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('a .kehikot symlinked out of the project is refused by name', async () => {
    const project = scratch()
    const elsewhere = mkdtempSync(join(tmpdir(), 'kehikko-history-elsewhere-'))
    rmSync(join(project, '.kehikot'), { recursive: true, force: true })
    /* A symlink is exactly the case a string comparison misses. */
    require('node:fs').symlinkSync(elsewhere, join(project, '.kehikot'))
    const found = locate(project)
    expect(found.ok).toBe(false)
    expect(found.ok === false && found.why).toContain('outside')
    rmSync(project, { recursive: true, force: true })
    rmSync(elsewhere, { recursive: true, force: true })
  })
})

/**
 * The Uncommitted tab's two doors.
 *
 * Both take a list of paths the page read out of `git status`, and the thing
 * worth asserting is the argument array: every path is checked, spelled into a
 * literal pathspec, and placed after a `--`; nothing is `add -A`ed; nothing is
 * `restore`d or `clean`ed; and the identity and hook rules follow which
 * repository it is.
 */
describe('committing some of what is uncommitted, by name', () => {
  /** A project whose .kehikot is a repository of its own, so `which: 'kehikot'` resolves. */
  const withRepo = () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    return project
  }

  test('a path that climbs out, or is an option, is refused before git is asked', async () => {
    const project = withRepo()
    const { run, calls } = fakeGit()
    for (const path of ['../../etc/passwd', '--output=/tmp/x', '/etc/passwd']) {
      const reply = await post('/api/commit-paths', { project, which: 'kehikot', paths: [path], message: 'x' }, run)
      expect((reply?.body as { ok: boolean }).ok).toBe(false)
    }
    expect(calls.every((args) => args[0] !== 'commit' && args[0] !== 'add')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('an empty message is refused with the sentence from names.ts, and nothing runs', async () => {
    const project = withRepo()
    const { run, calls } = fakeGit()
    const reply = await post('/api/commit-paths', { project, which: 'kehikot', paths: ['a.json'], message: '  ' }, run)
    const body = reply?.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('A commit needs a message')
    expect(calls.every((args) => args[0] !== 'commit')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('only the untracked paths are added; the commit is --only, after a --, with literal pathspecs', async () => {
    const project = withRepo()
    const { run, calls } = fakeGit({
      /* The page ticked a modified file, a new folder and a rename; git says which is untracked. */
      status: { ok: true, out: ' M notes/notes.json\0?? questions/\0R  b.json\0a.json\0' },
      'config --get user.name': { ok: true, out: 'Jaakko\n' },
      'config --get user.email': { ok: true, out: 'j@example.com\n' },
      'rev-parse HEAD': { ok: true, out: 'f'.repeat(40) },
    })
    const reply = await post(
      '/api/commit-paths',
      { project, which: 'kehikot', paths: ['notes/notes.json', 'questions/', 'b.json', 'a.json'], message: 'three things' },
      run,
    )
    const body = reply?.body as { ok: boolean; said: string; sha: string }
    expect(body.ok).toBe(true)
    expect(body.said).toBe('Committed: three things')
    expect(body.sha).toBe('f'.repeat(40))

    const add = calls.find((args) => args.includes('add'))
    expect(add).toEqual(['add', '--', ':(literal,top)questions'])
    const commit = calls.find((args) => args.includes('commit'))
    expect(commit).toEqual([
      'commit',
      '--only',
      '--cleanup=whitespace',
      '-m',
      'three things',
      '--',
      ':(literal,top)notes/notes.json',
      ':(literal,top)questions',
      ':(literal,top)b.json',
      ':(literal,top)a.json',
    ])
    /* Never the whole repository. */
    expect(calls.some((args) => args.includes('-A') || args.includes('.'))).toBe(false)
    rmSync(project, { recursive: true, force: true })
  })

  test('into the project’s own repository: hooks are on, and no identity is a refusal rather than a fallback', async () => {
    const project = scratch()
    const { run, calls } = fakeGit({
      'rev-parse --show-toplevel': { ok: true, out: project },
      'symbolic-ref --quiet HEAD': { ok: true, out: 'refs/heads/main' },
      'config --get user.name': { ok: true, out: '' },
    })
    const reply = await post('/api/commit-paths', { project, which: 'project', paths: ['a.tex'], message: 'draft' }, run)
    const body = reply?.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('has no user.name')
    expect(calls.every((args) => !args.includes('commit'))).toBe(true)

    /* With an identity, the commit runs with the repository's own hooks. */
    const identified = fakeGit({
      'rev-parse --show-toplevel': { ok: true, out: project },
      'symbolic-ref --quiet HEAD': { ok: true, out: 'refs/heads/main' },
      'config --get user.name': { ok: true, out: 'Jaakko' },
      'config --get user.email': { ok: true, out: 'j@example.com' },
      status: { ok: true, out: ' M a.tex\0' },
    })
    const made = await post('/api/commit-paths', { project, which: 'project', paths: ['a.tex'], message: 'draft' }, identified.run)
    expect((made?.body as { ok: boolean }).ok).toBe(true)
    const commit = identified.calls.find((args) => args.includes('commit'))
    expect(commit?.slice(0, 3)).toEqual(['-c', 'core.hooksPath=.git/hooks', 'commit'])
    expect(commit).not.toContain('user.name=kehikot')
    rmSync(project, { recursive: true, force: true })
  })

  test('git’s own refusal comes back verbatim', async () => {
    const project = withRepo()
    const { run } = fakeGit({
      'config --get user.name': { ok: true, out: 'a' },
      'config --get user.email': { ok: true, out: 'a@b' },
      commit: { ok: false, err: 'error: cannot commit during a merge, or whatever git actually said\n' },
    })
    const reply = await post('/api/commit-paths', { project, which: 'kehikot', paths: ['a.json'], message: 'x' }, run)
    const body = reply?.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('error: cannot commit during a merge, or whatever git actually said')
    rmSync(project, { recursive: true, force: true })
  })
})

describe('discarding some of what is uncommitted, by name', () => {
  test('it is a scoped stash — never a restore, never a clean, never a -f', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit({ stash: { ok: true, out: 'Saved working directory and index state\n' } })
    const reply = await post('/api/discard', { project, which: 'kehikot', paths: ['notes/notes.json', 'questions/'] }, run)
    const body = reply?.body as { ok: boolean; said: string }
    expect(body.ok).toBe(true)
    expect(body.said).toContain('Discarded the changes to 2 files')
    expect(body.said).toContain('git stash pop')
    const stash = calls.find((args) => args[0] === 'stash')
    expect(stash).toEqual([
      'stash',
      'push',
      '--include-untracked',
      '-m',
      'discarded from the History pane',
      '--',
      ':(literal,top)notes/notes.json',
      ':(literal,top)questions',
    ])
    expect(calls.every((args) => args[0] !== 'restore' && args[0] !== 'clean' && !args.includes('-f'))).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })

  test('nothing left to discard is said as nothing, not as success', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run } = fakeGit({ stash: { ok: true, out: 'No local changes to save\n' } })
    const reply = await post('/api/discard', { project, which: 'kehikot', paths: ['a.json'] }, run)
    const body = reply?.body as { ok: boolean; said: string }
    expect(body.ok).toBe(true)
    expect(body.said).toContain('nothing was discarded')
    rmSync(project, { recursive: true, force: true })
  })

  test('an empty list, or a bad path, never reaches a stash', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run, calls } = fakeGit()
    const none = await post('/api/discard', { project, which: 'kehikot', paths: [] }, run)
    expect((none?.body as { ok: boolean; error: string }).error).toContain('Name at least one file')
    const bad = await post('/api/discard', { project, which: 'kehikot', paths: ['-r'] }, run)
    expect((bad?.body as { ok: boolean }).ok).toBe(false)
    expect(calls.every((args) => args[0] !== 'stash')).toBe(true)
    rmSync(project, { recursive: true, force: true })
  })
})

describe('what git status says is folded into a word, and a rename keeps both names', () => {
  test('the porcelain pair becomes a kind, and the pair is kept beside it', () => {
    const out = ' M a\0M  b\0MM c\0A \0d\0 D e\0D  f\0R  new\0old\0C  copy\0orig\0?? g/\0UU h\0AA i\0DD j\0'
    /* `A \0d` above is a typo on purpose: a record shorter than four bytes is skipped, not crashed on. */
    const parsed = parseStatus(out)
    const kinds = Object.fromEntries(parsed.map((one) => [one.path, one.kind]))
    expect(kinds).toEqual({
      a: 'modified',
      b: 'modified',
      c: 'modified',
      e: 'deleted',
      f: 'deleted',
      new: 'renamed',
      copy: 'new',
      'g/': 'untracked',
      h: 'conflicted',
      i: 'conflicted',
      j: 'conflicted',
    })
    expect(parsed.find((one) => one.path === 'new')?.from).toBe('old')
    expect(parsed.find((one) => one.path === 'copy')?.from).toBe('orig')
    expect(parsed.find((one) => one.path === 'a')?.from).toBe(null)
    expect(parsed.find((one) => one.path === 'a')?.code).toBe(' M')
  })

  test('the reading a page gets carries the kind, through the door', async () => {
    const project = scratch()
    mkdirSync(join(project, '.kehikot', '.git'), { recursive: true })
    const { run } = fakeGit({
      'rev-parse --show-toplevel': { ok: true, out: join(project, '.kehikot') },
      'status --porcelain -z': { ok: true, out: '?? notes/\0 M checklist/items.json\0' },
    })
    const reply = await answer('GET', '/api/histories', new URLSearchParams({ project }), null, null, run)
    const data = (reply?.body as { kehikot: { dirty: { kind: string; path: string }[] } }).kehikot
    expect(data.dirty.map((one) => `${one.kind} ${one.path}`)).toEqual(['untracked notes/', 'modified checklist/items.json'])
    rmSync(project, { recursive: true, force: true })
  })
})
