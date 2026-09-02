import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TICKET, answer } from '../doors.ts'
import type { GitResult, GitRunner } from '../git/run.ts'
import { locate } from '../git/repo.ts'

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
      'status --porcelain': { ok: true, out: ' M notes/notes.json\n?? notes/draft.json\n' },
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
      'status --porcelain': { ok: true, out: '' },
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
