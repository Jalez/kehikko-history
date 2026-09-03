import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { gitRunner, spawnGit, strippedEnv, within } from '../git/run.ts'

/**
 * The runner against a REAL git and a loopback server that behaves badly.
 *
 * These two are the hazards that arrived with `push`: git stopping to ask for a
 * credential, and git waiting on a remote that never answers. Both are
 * properties of a process, not of an argument array, so they cannot be proved
 * with the fake runner every other test uses. What stands in for the network is
 * `http.createServer` on 127.0.0.1 — nothing leaves the machine, nothing here
 * has a real remote, and the server is closed when the file is done.
 */

/** A git repository with a remote pointing at `url`, in a directory named for this test. */
function repoTowards(url: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kehikko-history-run-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  git('init', '--quiet', '--initial-branch=main')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'one')
  git('remote', 'add', 'origin', url)
  return dir
}

describe('a credential prompt fails fast instead of hanging the pane', () => {
  let server: Server
  let url = ''
  let asked = 0

  beforeAll(async () => {
    /* A server that wants a password for everything. Git's HTTP transport
       answers a 401 by asking the terminal for a username — unless it has been
       told there is no terminal. */
    server = createServer((_request, response) => {
      asked += 1
      response.statusCode = 401
      response.setHeader('WWW-Authenticate', 'Basic realm="kehikko-history-test"')
      response.end('who are you?')
    })
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
    const address = server.address()
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/origin.git`
  })

  afterAll(() => {
    server.close()
  })

  test('push over HTTP with no credential comes back at once, with git saying prompts are disabled', async () => {
    const dir = repoTowards(url)
    const started = Date.now()
    const result = await spawnGit(['push', 'origin', 'refs/heads/main:refs/heads/main'], { cwd: dir })
    const took = Date.now() - started
    rmSync(dir, { recursive: true, force: true })

    expect(result.ok).toBe(false)
    /* Git's own words for "I would have asked, and was told not to". This is
       the sentence `remote.ts` recognises and puts one line of advice before. */
    expect(result.err).toMatch(/terminal prompts disabled|could not read Username/i)
    /* Fast: well under the ten-second local timeout, let alone the sixty-second
       network one. A hang would have been either of those, followed by a
       sentence about a timeout — the wrong report for a missing password. */
    expect(took).toBeLessThan(5000)
    expect(asked).toBeGreaterThan(0)
  })

  test('the environment turns off every way of asking', () => {
    const env = strippedEnv({ GIT_ASKPASS: '/usr/bin/ask', SSH_ASKPASS: '/usr/bin/ask', GIT_SSH_COMMAND: 'ssh -i secret', PATH: '/bin' })
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
    expect(env.GIT_ASKPASS).toBeUndefined()
    expect(env.SSH_ASKPASS).toBeUndefined()
    expect(env.SSH_ASKPASS_REQUIRE).toBe('never')
    expect(env.GIT_SSH_COMMAND).toContain('BatchMode=yes')
    /* And what is wanted stays. */
    expect(env.PATH).toBe('/bin')
  })
})

describe('a remote that never answers is given up on, and the child is killed', () => {
  let server: Server
  let url = ''
  let held = 0

  beforeAll(async () => {
    /* A server that accepts the connection and then says nothing, ever. Git
       will wait on it for as long as it is allowed to. */
    server = createServer(() => {
      held += 1
    })
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
    const address = server.address()
    url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/origin.git`
  })

  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })

  test('the timeout fires, git is stopped, and the sentence says what may have been waited on', async () => {
    const dir = repoTowards(url)
    /* Three hundred milliseconds rather than sixty seconds, through the one
       parameter the runner takes for exactly this test. */
    const run = gitRunner({ within: () => 300 })
    const started = Date.now()
    const result = await run(['push', 'origin', 'refs/heads/main:refs/heads/main'], { cwd: dir })
    const took = Date.now() - started
    rmSync(dir, { recursive: true, force: true })

    expect(result.ok).toBe(false)
    expect(result.err).toContain('did not finish within 0 seconds and was stopped')
    expect(result.err).toContain('cannot type')
    expect(took).toBeLessThan(3000)
    expect(held).toBeGreaterThan(0)
  })

  test('the network timeout is the long one and the local timeout is the short one', () => {
    expect(within(['push', 'origin', 'main'])).toBe(60_000)
    expect(within(['pull', '--ff-only'])).toBe(60_000)
    expect(within(['-c', 'core.hooksPath=.git/hooks', 'push', 'origin', 'main'])).toBe(60_000)
    expect(within(['status', '--porcelain'])).toBe(10_000)
    expect(within(['log'])).toBe(10_000)
  })
})

/*
 * Config given as an environment variable is `-c` by another spelling, and the
 * allowlist that vets `-c` only ever read the command line. One test per
 * family, and the numbered pair is checked at two different indices, because
 * those are stripped by PREFIX — a test written against a fixed list would
 * pass against the same fixed list and prove nothing about the seventh key.
 */
test('strippedEnv drops config passed as an environment variable', () => {
  const env = strippedEnv({
    PATH: '/usr/bin',
    GIT_CONFIG_PARAMETERS: "'core.sshCommand=touch /tmp/pwned'",
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'credential.helper',
    GIT_CONFIG_VALUE_0: '!sh -c "echo pwned"',
    GIT_CONFIG_KEY_7: 'core.hooksPath',
    GIT_CONFIG_VALUE_7: '/tmp/hooks',
  })
  expect(env.GIT_CONFIG_PARAMETERS).toBeUndefined()
  expect(env.GIT_CONFIG_COUNT).toBeUndefined()
  expect(env.GIT_CONFIG_KEY_0).toBeUndefined()
  expect(env.GIT_CONFIG_VALUE_0).toBeUndefined()
  expect(env.GIT_CONFIG_KEY_7).toBeUndefined()
  expect(env.GIT_CONFIG_VALUE_7).toBeUndefined()
  /* Everything else the process was launched with still reaches git. */
  expect(env.PATH).toBe('/usr/bin')
})
