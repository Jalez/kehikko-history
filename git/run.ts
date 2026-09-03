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
 * - **`reset`.** `--hard` destroys uncommitted work with no record of what it
 *   was. The honest replacement is `restore` on one named file from one named
 *   commit, which is reversible because the thing it overwrites was committed.
 * - **`clean`.** It deletes files git has never seen, which is the one class of
 *   loss no history can undo.
 * - **`rebase`, `filter-branch`, `commit --amend`, `gc --prune`.** All of them
 *   rewrite or discard commits that already exist. Recovery is what this module
 *   is for; a tool that edits the past is the opposite of it.
 * - **`remote`, `clone`, `submodule`.** `remote` adds, removes and re-points
 *   remotes, which is configuration a person writes once in a terminal and
 *   should not find changed by a pane; the other two make repositories, which
 *   this module does in exactly one place (`ensure()` in `repo.ts`) and
 *   nowhere else.
 *
 * `--amend` is refused as a flag as well as `reset` being refused as a
 * subcommand, because `commit` is on the list and `commit --amend` is not the
 * same act as `commit`.
 *
 * ## The network, and the guarantee that was traded for it
 *
 * This list used to say, of `push`: *this module has no network path at all —
 * there is nothing here that can rewrite published history because there is
 * nothing here that can reach a remote, which is a stronger guarantee than a
 * careful push would be, and needs no care to keep.* That was true, it was
 * argued for on purpose, and it is no longer the case: `pull` and `push` are
 * on the list, because a person asked for a push button and a pull button
 * beside the branch, and a history pane that can see a remote and never touch
 * it is a pane that sends them to a terminal for the two commands they run
 * most. `fetch` on its own is not on the list — nothing presses for it, and
 * `pull` is the fetch this pane offers — but it is in `NETWORK` below, so that
 * adding it later gets the timeout, the session and the refspec rule for free
 * rather than by remembering.
 *
 * What replaces the guarantee is narrower and it DOES need care to keep, so
 * here is exactly what it is:
 *
 * - **A push from here can only fast-forward a remote branch.** `--force`,
 *   `--force-with-lease`, `--mirror`, `--delete`, `-d` and `--prune` are
 *   refused as flags, and a refspec beginning with `+` (which is `--force` for
 *   one ref) or with `:` (which is a delete) is refused as an argument. Git
 *   itself refuses the rest: a push that is not a fast-forward is rejected by
 *   the far end, and the sentence it comes back with says to fetch first. So
 *   the published-history argument still holds, one step further down — nothing
 *   here can rewrite a commit that has left this machine, because nothing here
 *   can send anything but new commits on top of what is there.
 * - **A pull from here can only fast-forward the local branch.** `remote.ts`
 *   passes `--ff-only` and `--no-rebase` and nothing else; `--rebase` is refused
 *   as a flag for the same reason `rebase` is refused as a subcommand. A pull
 *   that would need a merge is refused by git and changes nothing, which is the
 *   only outcome this pane can draw — it has no view of a conflict and no
 *   control that resolves one.
 * - **Nothing here chooses the program that runs on either end.** `--exec`,
 *   `--upload-pack` and `--receive-pack` — in both their two-argument and their
 *   `--flag=value` spellings — are how a fetch or a push names an arbitrary
 *   program for git to run, and they are refused. `-c` is still limited to the
 *   three keys in `SETTABLE`, so `core.sshCommand`, `credential.helper` and
 *   `remote.<name>.uploadpack` cannot be smuggled in beside a `push` either.
 * - **Nothing here can wait on a prompt.** A network call is the one kind of
 *   git call that stops and asks — for a password, a passphrase, a host key —
 *   and there is no terminal to ask on, only an HTTP request that would hold
 *   the pane until the timeout. `strippedEnv` turns every prompt off so that
 *   git fails in under a second with a sentence instead; see the essay there.
 *
 * The care this needs, stated so it is not forgotten: a flag added to
 * `REFUSED_FLAGS` protects `push` only while the check reads `--flag=value` as
 * `--flag`, and a refspec is an argument rather than a flag, so the `+`/`:`
 * rule below is a second check and not a restatement of the first. Both are
 * tested directly in `test/names.test.ts`, and a change here that makes one of
 * those tests go green for a new reason is a change to read twice.
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
  'pull',
  'push',
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

/**
 * Flags that turn an allowed subcommand into a disallowed act.
 *
 * Matched on the part before any `=`, so `--receive-pack=evil` is the same flag
 * as `--receive-pack evil`. Git accepts both spellings for every long option,
 * which means an exact-match set would have been a set with a hole beside every
 * entry — invisible while nothing here could reach a remote, and the first thing
 * to check once something could.
 */
const REFUSED_FLAGS = new Set([
  '--amend',
  '--hard',
  '--force',
  '-f',
  '--force-with-lease',
  '--force-if-includes',
  '--mirror',
  '--delete',
  '-d',
  '--prune',
  '--rebase',
  '--exec',
  '--upload-pack',
  '--receive-pack',
])

/** The subcommands that talk to a remote, which decides their timeout, their session and their refspec rule. */
export const NETWORK = new Set(['fetch', 'pull', 'push'])

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
        `This module does not run \`git ${subcommand}\`. It runs a short list on purpose: no reset, no clean, no `
        + 'rebase, nothing that edits remotes and nothing that makes a repository. Recovery is what it is for, so it '
        + 'will not rewrite or discard what is already committed, and it will not delete files git has never seen. '
        + 'It fetches, pulls and pushes, and only ever forward.',
    }
  }
  for (const arg of args) {
    const flag = arg.startsWith('--') ? (arg.split('=')[0] ?? arg) : arg
    if (!REFUSED_FLAGS.has(flag)) continue
    if (flag === '-f' && SOFT_F[subcommand]) continue
    return {
      ok: false,
      why:
        `\`${flag}\` is not a flag this module passes to git. It is on the short list of things that rewrite history, `
        + 'throw away work without saying what was in it, or name a program for git to run, and there is no press on '
        + 'this page that needs one.',
    }
  }
  /*
   * A refspec is an argument, not a flag, and two characters at the front of one
   * do what two refused flags do: `+refs/heads/x` is a forced update of that one
   * ref, and `:refs/heads/x` — nothing before the colon — deletes it on the far
   * end. Neither is anything this module composes, so both are refused outright
   * on the three subcommands that take a refspec at all.
   */
  if (NETWORK.has(subcommand)) {
    for (const arg of args) {
      if (arg.startsWith('+') || arg.startsWith(':')) {
        return {
          ok: false,
          why:
            `\`${arg}\` is a refspec that ${arg.startsWith('+') ? 'forces an update' : 'deletes a branch'} on the remote, `
            + 'which is what this module refuses --force and --delete for. It pushes one branch forward and nothing else.',
        }
      }
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

/**
 * How long a call that talks to a remote may take.
 *
 * Longer than the local one, because a push of a few megabytes over a slow
 * link is not a fault, and shorter than forever for the reason a local call
 * has one: a `push` that has stopped to wait — on a remote that accepted the
 * connection and went quiet, on a proxy, on a prompt that `strippedEnv` did
 * not manage to turn off — is a pane that says "pushing" until somebody
 * reloads it. Sixty seconds is long enough for any push a project this size
 * makes and short enough that a person still remembers what they pressed.
 *
 * When it fires the whole process group is killed, not just git: a push runs
 * `ssh` or `git-remote-https` as a child of its own, and killing git alone
 * would leave that child holding the connection open with nobody reading it.
 */
const NETWORK_WITHIN_MS = 60_000

/** The subcommand in an argument array, skipping `-c key=value` pairs the way `vetted` does. */
function subcommandOf(args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    if (arg === '-c') {
      index += 1
      continue
    }
    if (!arg.startsWith('-')) return arg
  }
  return ''
}

/** How long one call may take: sixty seconds when it reaches a remote, ten when it does not. */
export function within(args: string[]): number {
  return NETWORK.has(subcommandOf(args)) ? NETWORK_WITHIN_MS : WITHIN_MS
}

/** How much of git's output is kept. Bounded, because `git log` on a large repository is not. */
const MAX_OUTPUT = 4_000_000

/**
 * A runner, with the timeout as a parameter.
 *
 * `spawnGit` below is the one everything uses, with the two timeouts above.
 * The parameter exists so that `test/run.test.ts` can prove the timeout is a
 * real one — a git call stopped mid-wait, its child killed, a sentence back —
 * against a loopback server that never answers, in a few hundred milliseconds
 * rather than sixty seconds.
 */
export function gitRunner(options: { within?: (args: string[]) => number } = {}): GitRunner {
  const limit = options.within ?? within
  return (args, where) =>
    new Promise((settle) => {
      const check = vetted(args)
      if (!check.ok) {
        settle({ ok: false, code: -1, out: '', err: check.why })
        return
      }
      const subcommand = subcommandOf(args)
      const network = NETWORK.has(subcommand)
      const allowed = limit(args)
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
          cwd: where.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
          /*
           * A network call gets a session of its own, and that is a third
           * defence against a prompt rather than tidiness. `ssh` does not read
           * a passphrase from stdin — it opens `/dev/tty` directly, which is
           * the controlling terminal of the process's SESSION. A dev server
           * started from a terminal has one, and an `ssh` two processes below
           * it would find it and ask there, in a window nobody is looking at,
           * while the pane waits. `detached: true` starts git in a new session
           * with no controlling terminal, so there is nothing to open.
           *
           * It also makes git the leader of a process group, which is what
           * lets the timeout kill git AND the `ssh` or `git-remote-https` it
           * started, by signalling the group rather than the one pid.
           */
          detached: network,
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
        const stop = () => {
          try {
            if (network && child.pid) process.kill(-child.pid, 'SIGKILL')
            else child.kill('SIGKILL')
          } catch {
            /* Already gone, which is the outcome wanted. */
          }
        }
        const timer = setTimeout(() => {
          stop()
          finish({
            ok: false,
            code: -1,
            out,
            err: network
              ? `\`git ${subcommand}\` did not finish within ${Math.round(allowed / 1000)} seconds and was stopped. `
                + 'Either the remote did not answer, or something on the way to it was waiting for an answer this pane '
                + 'cannot type — a password, a passphrase, a yes to a new host key. Nothing was changed here. Try the '
                + 'same command in a terminal, where it can ask.'
              : `\`git ${subcommand}\` did not finish within ${Math.round(allowed / 1000)} seconds and was stopped. The commonest cause is another program holding this repository’s index.lock.`,
          })
        }, allowed)
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
}

export const spawnGit: GitRunner = gitRunner()

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
  'SSH_ASKPASS',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_ALLOW_PROTOCOL',
  /*
   * The three below are `-c` spelled as an environment variable, and they were
   * missing from this list while every other way of setting config was on it.
   *
   * `git -c key=value` is limited to three keys by `VETTED_C`, because config
   * is where the dangerous settings live: `core.sshCommand` and
   * `credential.helper` name a program to run, `core.hooksPath` names a
   * directory of them, `protocol.ext.allow` opens a transport that executes a
   * command out of a URL. That allowlist was doing its job on the command line
   * and nothing was doing it here — git reads `GIT_CONFIG_PARAMETERS`, and the
   * `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` trio,
   * with exactly the force of `-c`, and neither was stripped.
   *
   * It is a smaller hole than the argument checks guard, and worth saying why
   * rather than overstating it: nothing on the wire reaches this environment,
   * so setting one of these means already being inside the process that spawns
   * git. But this list exists precisely because a module should not inherit
   * whatever it happens to be launched with, and it named `GIT_CONFIG_GLOBAL`
   * on that reasoning already. Leaving the equivalent unstripped made the
   * allowlist above true of one spelling and not the other.
   *
   * The numbered form is a family rather than a name — `GIT_CONFIG_KEY_0`,
   * `_1`, and so on — so `strippedEnv` drops it by PREFIX. A fixed list would
   * have covered as many as somebody remembered to write down.
   */
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
]

/** Stripped by prefix, because these are numbered without limit. See `STRIP`. */
const STRIP_PREFIXES = ['GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_']

/**
 * The environment git runs in, and the four things in it that stop a prompt.
 *
 * ## A prompt is the worst failure available to a network call
 *
 * `git push` over HTTPS with no cached credential asks for a username on the
 * terminal. Over SSH with a passphrase-protected key, `ssh` asks for the
 * passphrase. On a host it has not seen, `ssh` asks whether to trust it. Every
 * one of those is a process stopped, waiting for a keypress, on a terminal that
 * this module does not have — and behind it an HTTP request from the page that
 * will not be answered until the timeout kills the wait. Sixty seconds of a
 * pane saying "pushing", and then a sentence about a timeout, is exactly the
 * wrong report for "you have not told git your password".
 *
 * So every way git and ssh have of asking is turned off, and the call FAILS,
 * at once, with git's own sentence — `could not read Username: terminal prompts
 * disabled`, `Permission denied (publickey)`, `Host key verification failed` —
 * which `remote.ts` then puts one line of advice in front of: do it once in a
 * terminal, where it can ask, and the credential helper will remember.
 *
 * - `GIT_TERMINAL_PROMPT=0`: git's own prompts, for HTTP credentials.
 * - `GIT_ASKPASS` and `SSH_ASKPASS` stripped, `SSH_ASKPASS_REQUIRE=never`: the
 *   graphical fallbacks. A dialog would not hang the terminal, but it would
 *   appear somewhere on the screen with no connection to the pane that caused
 *   it, and the pane would wait on it just the same. `core.askPass` in
 *   somebody's config is the one route left, and it is theirs to have set.
 * - `GIT_SSH_COMMAND=ssh -o BatchMode=yes`: ssh's prompts. `BatchMode` makes
 *   every question a refusal — no passphrase, no host-key yes/no — and leaves
 *   `~/.ssh/config`, which is where a person's keys and hosts actually live,
 *   fully in force. A `core.sshCommand` in git config is overridden by this,
 *   and that is a real trade stated plainly: a wrapper somebody configured
 *   there does not run from this pane, because this pane cannot know whether
 *   the wrapper asks.
 *
 * The credential helper itself is untouched. `osxkeychain`, `manager`, `store`
 * — whatever answers without asking, still answers, which is why a push from
 * here works at all on a machine where a push from a terminal has worked once.
 * `test/run.test.ts` proves the HTTP half against a loopback server that asks
 * for a password: git gives up in well under a second and says why.
 */
export function strippedEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...from }
  for (const name of STRIP) delete env[name]
  for (const name of Object.keys(env)) {
    if (STRIP_PREFIXES.some((prefix) => name.startsWith(prefix))) delete env[name]
  }
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.SSH_ASKPASS_REQUIRE = 'never'
  env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
  return env
}
