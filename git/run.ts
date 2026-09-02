import { spawn } from 'node:child_process'

/**
 * How `git` is actually run, and the two rules that make that safe.
 *
 * ## The seam
 *
 * The same shape the host uses in `server/launch.ts` and `server/register.ts`:
 * deciding WHAT to run is a pure function over validated input, and the running
 * is one small thing behind a parameter. Every test in this repository passes
 * its own runner and asserts the argument array, so the refusals, the message
 * composition and the debounce are all exercised with no `git` binary anywhere
 * near them. That matters more here than it did for a start button, because the
 * thing being exercised writes to somebody's repository.
 *
 * ## Rule one: an array, and `shell: false`
 *
 * Never a command string. Nothing in this module is interpolated into a shell,
 * so a branch name containing a semicolon is a branch name that does not exist
 * rather than a second command. That is the whole of it, and it is not
 * negotiable: a module shelling out with text that arrived on a request is the
 * worst bug available in this codebase.
 *
 * ## Rule two: an allowlist of subcommands, and it is short
 *
 * `shell: false` stops a string becoming two commands. It does NOT stop `git`
 * being asked to do something destructive with perfectly well-formed arguments,
 * and `git` has plenty of those. So the subcommand is checked against a list,
 * and the list is what this module is willing to be.
 *
 * What is deliberately absent, and named in the refusal so the absence is
 * readable rather than mysterious:
 *
 * - **`push`.** This module has no network path at all. There is nothing here
 *   that can rewrite published history because there is nothing here that can
 *   reach a remote — which is a stronger guarantee than a careful `push` would
 *   be, and needs no care to keep.
 * - **`reset`.** `--hard` destroys uncommitted work with no record of what it
 *   was. The honest replacement is `restore` on one named file from one named
 *   commit, which is reversible because the thing it overwrites was committed.
 * - **`clean`.** It deletes files git has never seen, which is the one class of
 *   loss no history can undo.
 * - **`rebase`, `filter-branch`, `commit --amend`, `gc --prune`.** All of them
 *   rewrite or discard commits that already exist. Recovery is what this module
 *   is for; a tool that edits the past is the opposite of it.
 * - **`remote`, `fetch`, `pull`, `clone`, `submodule`.** Same reason as `push`:
 *   no network.
 *
 * `--amend` is refused as a flag as well as `reset` being refused as a
 * subcommand, because `commit` is on the list and `commit --amend` is not the
 * same act as `commit`.
 *
 * ## `-c core.hooksPath=` on every call, and why
 *
 * A repository can carry hooks, and a hook is a program that runs when you
 * commit. This module commits automatically, in the background, in a folder
 * inside somebody else's project — a combination where inheriting whatever
 * `core.hooksPath` points at would mean this module quietly running arbitrary
 * code on a timer. The `.kehikot` repository is one this module created and
 * nobody has configured, so there is nothing to lose by turning hooks off there,
 * and a great deal to lose by leaving them on.
 *
 * It is set for the PROJECT repository too, and that is a real trade worth
 * stating: somebody with a `pre-commit` hook will not see it run on a commit
 * made from this pane. That is the right way round. A hook that formats code is
 * a hook whose absence a person notices; a hook that runs on a commit somebody
 * did not know was being made is one they do not.
 */

/** What running `git` produced. Shown to a person, so it is kept small and verbatim. */
export interface GitResult {
  ok: boolean
  code: number
  out: string
  err: string
}

/** The seam. Everything in this module takes one of these rather than reaching for `spawn`. */
export type GitRunner = (args: string[], options: { cwd: string }) => Promise<GitResult>

/**
 * The subcommands this module will run. See the essay above for what is missing
 * and why each absence is deliberate.
 */
export const ALLOWED = new Set([
  'init',
  'status',
  'add',
  'commit',
  'log',
  'show',
  'diff',
  'rev-parse',
  'rev-list',
  'symbolic-ref',
  'branch',
  'checkout',
  'switch',
  'restore',
  'stash',
  'ls-files',
  'for-each-ref',
  'check-ignore',
  'config',
  'cat-file',
])

/** Flags that turn an allowed subcommand into a disallowed act. */
const REFUSED_FLAGS = new Set(['--amend', '--hard', '--force', '-f', '--force-with-lease', '--exec', '--upload-pack', '--receive-pack'])

/**
 * `-f` is refused above, and two allowed subcommands use it for something
 * harmless. Listed rather than special-cased inside the check, so that adding a
 * third is a line here rather than a hole.
 *
 * `git branch -f` would be a move of a branch pointer and is NOT in this set;
 * `git checkout -f` would discard the working tree and is not either. Neither
 * subcommand appears here, so both stay refused.
 */
const SOFT_F: Record<string, true> = { stash: true }

/**
 * The only `git -c key=value` settings this module will pass, and why there is a
 * list rather than a rule.
 *
 * `-c` takes its value as the NEXT argument, which is a fact about git's command
 * line that a check reading arguments one at a time cannot see. Before this list
 * existed, `vetted` found the first argument not beginning with a dash and
 * called it the subcommand — so `git -c user.name=kehikot commit …` was read as
 * `git user.name=kehikot`, refused as an unknown subcommand, and the identity
 * fallback in `repo.ts` had been dead the whole time without anything saying so.
 * That is the shape of bug this file exists to prevent, arriving through the
 * file itself.
 *
 * So the pair is understood: `-c` consumes its value, the value is checked
 * against this list, and the search for the subcommand skips both. The list is
 * short because `git -c` can set ANYTHING — `core.pager`, `core.sshCommand`,
 * `alias.*`, `credential.helper` — and "a config key" is not a category this
 * module has any business accepting from a caller.
 *
 * - `user.name` / `user.email`: the identity fallback for a `.kehikot`
 *   repository on a machine where git has none. Never used for somebody's own
 *   repository — see `refusal()` in `enclosing.ts`.
 * - `core.hooksPath`: set EMPTY by `PREFIX` on every call, and pointed back at
 *   the repository's own hooks by `enclosing.ts` for the one commit a person
 *   presses for. Both directions go through here.
 */
const SETTABLE = [/^user\.name=/, /^user\.email=/, /^core\.hooksPath=/]

export type Vetted = { ok: true } | { ok: false; why: string }

/**
 * Is this argument array one this module will run?
 *
 * Exported and tested on its own, because it is the guard rather than a
 * formality. It runs inside `spawnGit` too, so there is no way to reach the
 * spawn without passing it — a check the caller has to remember is a check that
 * gets forgotten.
 */
export function vetted(args: string[]): Vetted {
  /* `-c` and its value, understood as the pair they are. See `SETTABLE`. */
  let subcommand: string | null = null
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg === '-c') {
      const value = args[index + 1]
      if (value === undefined || !SETTABLE.some((allowed) => allowed.test(value))) {
        return {
          ok: false,
          why:
            `\`-c ${value ?? ''}\` is not a setting this module passes to git. It passes three — user.name, `
            + 'user.email and core.hooksPath — because `git -c` can set anything at all, including which program git '
            + 'runs for a pager, a hook or a credential, and a config key is not a category this module accepts from '
            + 'a caller.',
        }
      }
      index += 1
      continue
    }
    if (!arg.startsWith('-')) {
      subcommand = arg
      break
    }
  }
  if (!subcommand) {
    return { ok: false, why: 'That was a call to git with no subcommand in it, which is not something this module runs.' }
  }
  if (!ALLOWED.has(subcommand)) {
    return {
      ok: false,
      why:
        `This module does not run \`git ${subcommand}\`. It runs a short list on purpose: no push, no reset, no `
        + 'clean, no rebase and nothing that reaches a remote. Recovery is what it is for, so it will not rewrite or '
        + 'discard what is already committed, and it will not delete files git has never seen.',
    }
  }
  for (const arg of args) {
    if (!REFUSED_FLAGS.has(arg)) continue
    if (arg === '-f' && SOFT_F[subcommand]) continue
    return {
      ok: false,
      why:
        `\`${arg}\` is not a flag this module passes to git. It is on the short list of things that rewrite history `
        + 'or throw away work without saying what was in it, and there is no press on this page that needs one.',
    }
  }
  /*
   * A NUL cannot survive being passed to a process, and an argument containing
   * one is a sign that something upstream stopped validating. It is refused here
   * rather than truncated, because a truncated path is a different path.
   */
  for (const arg of args) {
    if (arg.includes('\0')) return { ok: false, why: 'An argument to git contained a NUL byte, so nothing was run.' }
  }
  return { ok: true }
}

/**
 * The arguments every call is prefixed with.
 *
 * `--no-pager` because a pager attached to a pipe is a hang waiting for a
 * terminal that is not there. `-c core.hooksPath=` for the reason in the essay
 * above. `-c` pairs are given as two arguments rather than one string so there
 * is nothing to quote.
 */
export const PREFIX = ['--no-pager', '-c', 'core.hooksPath=']

/**
 * How long one git call may take before it is given up on.
 *
 * A number rather than forever, because forever is a pane that says "reading"
 * until somebody reloads it. Ten seconds is longer than any call this module
 * makes on a repository of this size and short enough that a person does not sit
 * through it twice. What it protects against is not a slow disk — it is
 * `index.lock` held by something else, which is precisely the state this module
 * is arranged to avoid causing and cannot stop somebody else causing.
 */
const WITHIN_MS = 10_000

/** How much of git's output is kept. Bounded, because `git log` on a large repository is not. */
const MAX_OUTPUT = 4_000_000

export const spawnGit: GitRunner = (args, options) =>
  new Promise((settle) => {
    const check = vetted(args)
    if (!check.ok) {
      settle({ ok: false, code: -1, out: '', err: check.why })
      return
    }
    let out = ''
    let err = ''
    let done = false
    const finish = (result: GitResult) => {
      if (done) return
      done = true
      settle(result)
    }
    try {
      const child = spawn('git', [...PREFIX, ...args], {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        /*
         * A deliberately narrow environment.
         *
         * `GIT_CONFIG_NOSYSTEM` and an empty `HOME` would go too far — this
         * module WANTS the person's `user.name` and `user.email`, so that a
         * commit it makes is theirs rather than anonymous. What is stripped is
         * the set of variables that make git do something other than what the
         * arguments say: an editor it would open and wait on, a pager, a
         * credential helper, and the `GIT_DIR`/`GIT_WORK_TREE` pair that would
         * silently redirect every call in this module at a different repository.
         */
        env: strippedEnv(),
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish({
          ok: false,
          code: -1,
          out,
          err: `\`git ${args[0]}\` did not finish within ${Math.round(WITHIN_MS / 1000)} seconds and was stopped. The commonest cause is another program holding this repository’s index.lock.`,
        })
      }, WITHIN_MS)
      child.stdout.on('data', (chunk: Buffer) => {
        if (out.length < MAX_OUTPUT) out += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (err.length < MAX_OUTPUT) err += chunk.toString()
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        finish({ ok: false, code: -1, out, err: `git could not be run: ${error.message}` })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        finish({ ok: code === 0, code: code ?? -1, out, err })
      })
    } catch (error) {
      finish({ ok: false, code: -1, out: '', err: (error as Error).message })
    }
  })

/** The variables that would make git do something other than what the arguments say. */
const STRIP = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
  'GIT_PAGER',
  'GIT_EXTERNAL_DIFF',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_ASKPASS',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_ALLOW_PROTOCOL',
]

export function strippedEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...from }
  for (const name of STRIP) delete env[name]
  /* Nothing here ever wants an interactive prompt: a git call that stopped to
     ask for a passphrase would hang until the timeout above killed it, and the
     person would see ten seconds of nothing rather than a refusal. */
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  return env
}
