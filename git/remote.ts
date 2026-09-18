import { statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { hooked } from './enclosing.ts'
import type { Moved } from './repo.ts'
import type { GitRunner } from './run.ts'

/**
 * The remote, read and reached: what the current branch tracks, how far apart
 * the two are, and the two presses — push and pull — that move them together.
 *
 * ## What the page knows before anybody presses
 *
 * A push button that says nothing is a coin flip, so `tracking()` reads
 * everything the page needs to decide whether a press is worth anything, and
 * reads it from git rather than working it out: `for-each-ref` answers, per
 * branch, where the upstream is, where a push would GO — which is not always
 * the same place, see below — and how many commits apart each pair is. The
 * page turns that into "push 3", "pull 1", and grey with a reason.
 *
 * ## `@{push}` and `@{upstream}` are two questions, and both are asked
 *
 * In the ordinary setup they have one answer: `main` tracks `origin/main` and
 * pushes to it. In a fork workflow they do not — `main` tracks `upstream/main`
 * and pushes to `origin/main` — and git knows which is which from
 * `branch.<name>.pushRemote` and `remote.pushDefault`. Asking git for both,
 * as `%(upstream:…)` and `%(push:…)`, is the whole of "do not duplicate git's
 * own logic" as it applies here: this file never decides where a push goes,
 * it asks, and then it names that place in the argument list so that what the
 * button said is exactly what git does.
 *
 * So `ahead` is counted against the PUSH destination — it is the number of
 * commits a push would send — and `behind` against the UPSTREAM, because that
 * is what a pull brings in.
 *
 * ## `ahead` is current and `behind` is as old as the last fetch
 *
 * Both numbers are computed against remote-tracking refs, which are this
 * machine's last sight of the remote. That makes them differently trustworthy
 * and the page says so:
 *
 * - `ahead` counts local commits the remote-tracking ref does not have. It is
 *   local knowledge and it is right: a push sends exactly those, and if there
 *   are none a push sends nothing. "Nothing to push" is therefore an honest
 *   reason to grey the button.
 * - `behind` counts commits on the remote-tracking ref that the branch does
 *   not have — and the remote may have moved since that ref was last updated.
 *   "Nothing to pull" would be a claim about a server this machine has not
 *   asked, so the pull button is never greyed for it. Pressing pull is how a
 *   person finds out, and "Already up to date" is git's honest answer when it
 *   was. `fetchedAt` is when the remote was last asked, so the tooltip can say
 *   how old the number is rather than present it as now.
 *
 * ## A first push sets the upstream, and says so
 *
 * A branch with no upstream can still be pushed; `git push` alone would refuse
 * with a paragraph about `--set-upstream`. Doing it without `-u` would leave the
 * pull button grey forever on a branch that has just been published, which is
 * absurd, so the first push from here is `--set-upstream` and the control says
 * "publish" rather than "push". Where it goes is `remote.pushDefault` when set,
 * the only remote when there is one, `origin` when there is one of that name —
 * and nothing otherwise: a repository with several remotes and no rule is a
 * choice this pane will not make on somebody's behalf, and the button is grey
 * with that sentence on it.
 *
 * ## `pull` is `--ff-only`, and the alternative was rejected on purpose
 *
 * A pull is a fetch and a merge, and a merge can stop halfway with conflict
 * markers in the working tree. That is a state this pane has no way to draw
 * and no control that gets out of — no "abort", no editor, no list of the
 * files with markers in them. Shipping a press that can put a person there is
 * shipping a trap, and it is a trap a person hits exactly when they are least
 * equipped for it, which is when they have not yet read what the remote holds.
 *
 * `--ff-only` makes the merge half of a pull an all-or-nothing act: either
 * the branch moves forward cleanly onto what was fetched, or git refuses and
 * nothing in the working tree changes. `--no-rebase` is beside it so that a
 * `pull.rebase=true` in somebody's config does not turn the press into the
 * one thing `run.ts` refuses as a subcommand. The refusal is reported in
 * these terms: both sides moved, a real merge or rebase is needed, that is a
 * terminal's job, and — because the fetch half did happen — the count beside
 * pull is now current.
 *
 * ## What is refused BEFORE git, and why it is not git's refusal rewritten
 *
 * Detached HEAD, no remote, no upstream. All three are things the page can see
 * from the read that drew the controls, so it greys the control rather than
 * offering a press that will be refused. This file refuses them again because
 * it is also reachable from a request that did not look, and it says the same
 * sentence the tooltip says. What it does NOT do is pre-empt anything git
 * would decide — a rejected push, an unreachable host, a bad credential —
 * those come back in git's own words with one line of advice in front.
 *
 * ## Uncommitted work used to be a fourth, and it is git's decision again
 *
 * `pull` refused outright over any uncommitted file, on the argument that a
 * fast-forward rewrites the working tree the way a checkout does. It does not.
 * Git refuses a fast-forward exactly when it would write over a file holding
 * uncommitted changes; it names those files; and it refuses the WHOLE pull, so
 * there is no half-done state — the same all-or-nothing guarantee `--ff-only`
 * already rests on here. Deciding it in advance bought no safety and cost the
 * press: something is uncommitted on a working project nearly all the time, so
 * pull was not occasionally off, it was off, including on the one screen that
 * tells a person to press it — the refusal of a non-fast-forward push, whose
 * advice is "pull to bring their commits in, then push again".
 *
 * So the pre-flight `git status` is gone and git decides. Its refusal comes
 * back as the sentence below, with the files it named in `wouldLose`, drawn
 * the same way `switchTo` in `repo.ts` draws them.
 */

export interface Tracking {
  /** The names of this repository's remotes. Empty when it has none. */
  remotes: string[]
  /** The branch these facts are about. Null when HEAD is detached or there are no commits. */
  branch: string | null
  /** What the branch tracks, as git names it (`origin/main`). Null when it tracks nothing. */
  upstream: string | null
  /** Where `git push` would send the branch, as git names it. Null when git cannot say. */
  pushTo: string | null
  /** Commits on the branch that its push destination does not have. Local knowledge; current. */
  ahead: number
  /** Commits on the upstream that the branch does not have — as of `fetchedAt`. */
  behind: number
  /** The upstream is configured but its remote-tracking ref is gone: git prints `[gone]`. */
  gone: boolean
  /** Where a first push would go, when the branch has no upstream and one remote is the clear answer. */
  publishTo: string | null
  /** When this repository last fetched, ISO 8601, or null when it never has. */
  fetchedAt: string | null
}

const NOTHING: Tracking = {
  remotes: [],
  branch: null,
  upstream: null,
  pushTo: null,
  ahead: 0,
  behind: 0,
  gone: false,
  publishTo: null,
  fetchedAt: null,
}

/** The same separator `repo.ts` uses, for the same reason: it cannot appear in a ref name. */
const FIELD = '\x1f'

/**
 * The private half of `tracking`, which `push` and `pull` need and the page
 * does not: the remote's NAME and the REF on it, separately, so the argument
 * list can say `origin refs/heads/main:refs/heads/main` rather than have this
 * file split `origin/feature/x` on a slash and hope.
 */
interface Where extends Tracking {
  upstreamRemote: string | null
  upstreamRef: string | null
  pushRemote: string | null
  pushRef: string | null
}

const FORMAT = [
  '%(HEAD)',
  '%(refname:short)',
  '%(upstream:short)',
  '%(upstream:remotename)',
  '%(upstream:remoteref)',
  '%(upstream:track,nobracket)',
  '%(push:short)',
  '%(push:remotename)',
  '%(push:remoteref)',
  '%(push:track,nobracket)',
].join(FIELD)

/** `ahead 3, behind 1` → both numbers; `gone` → gone; anything else → zeros. */
function counts(track: string): { ahead: number; behind: number; gone: boolean } {
  if (/\bgone\b/.test(track)) return { ahead: 0, behind: 0, gone: true }
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, gone: false }
}

async function where(cwd: string, git: GitRunner): Promise<Where> {
  const [remotes, refs, pushDefault, fetchHead] = await Promise.all([
    git(['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd }),
    git(['for-each-ref', `--format=${FORMAT}`, 'refs/heads/'], { cwd }),
    git(['config', '--get', 'remote.pushDefault'], { cwd }),
    git(['rev-parse', '--git-path', 'FETCH_HEAD'], { cwd }),
  ])

  /* `remote.origin.url https://…` per line; exit 1 and no lines when there are
     none, which is a fact and not trouble. Names are taken between the first
     dot and the last, because a remote name may itself contain a dot. */
  const names = remotes.ok
    ? [...new Set(remotes.out.split('\n').filter(Boolean).map((line) => (line.split(' ')[0] ?? '').replace(/^remote\./, '').replace(/\.url$/, '')))]
    : []

  const current = refs.ok ? refs.out.split('\n').find((line) => line.startsWith('*')) : undefined
  const [, branch = '', upstream = '', upstreamRemote = '', upstreamRef = '', upstreamTrack = '', pushTo = '', pushRemote = '', pushRef = '', pushTrack = ''] =
    current ? current.split(FIELD) : []

  const up = counts(upstreamTrack)
  const push_ = pushTo ? counts(pushTrack) : up

  /* `%(push:remoteref)` is filled in only when a push refspec is CONFIGURED.
     Under `push.default=simple` — the default, and what nearly everybody has —
     git derives the destination and prints it as `%(push:short)`
     (`origin/main`) with the ref field empty. The ref is that name with the
     remote's own name taken off the front, spelled as a full ref so the push
     argument is unambiguous. Checked against git 2.50 in `test/remote.test.ts`. */
  const derivedPushRef =
    pushRef || (pushTo && pushRemote && pushTo.startsWith(`${pushRemote}/`) ? `refs/heads/${pushTo.slice(pushRemote.length + 1)}` : '')

  let fetchedAt: string | null = null
  if (fetchHead.ok && fetchHead.out.trim()) {
    const path = fetchHead.out.trim()
    try {
      fetchedAt = statSync(isAbsolute(path) ? path : join(cwd, path)).mtime.toISOString()
    } catch {
      fetchedAt = null
    }
  }

  const preferred = pushDefault.ok ? pushDefault.out.trim() : ''
  const publishTo =
    branch && !upstream
      ? preferred && names.includes(preferred)
        ? preferred
        : names.length === 1
          ? (names[0] ?? null)
          : names.includes('origin')
            ? 'origin'
            : null
      : null

  return {
    remotes: names,
    branch: branch || null,
    upstream: upstream || null,
    upstreamRemote: upstreamRemote || null,
    upstreamRef: upstreamRef || null,
    pushTo: pushTo || null,
    pushRemote: pushRemote || null,
    pushRef: derivedPushRef || null,
    ahead: push_.ahead,
    behind: up.behind,
    gone: up.gone,
    publishTo,
    fetchedAt,
  }
}

/** What the current branch tracks and how far apart they are. Never throws; a repository with no remote is an ordinary answer. */
export async function tracking(cwd: string, git: GitRunner): Promise<Tracking> {
  try {
    const { upstreamRemote: _a, upstreamRef: _b, pushRemote: _c, pushRef: _d, ...facts } = await where(cwd, git)
    return facts
  } catch {
    return NOTHING
  }
}

/* ------------------------------------------------------------------ *
 * The two presses
 * ------------------------------------------------------------------ */

const no = (said: string): Moved => ({ ok: false, said, wouldLose: [] })

/** Git stopped to ask, or was refused for want of an answer. The sentence in front of git's own words. */
const ASKED =
  /terminal prompts disabled|could not read Username|could not read Password|Permission denied \(publickey|Host key verification failed|Authentication failed|authentication required/i

const CREDENTIAL =
  'git needed to ask for something — a password, a passphrase, or whether to trust a host — and this pane cannot '
  + 'answer, so it asked for nothing and stopped. Run the same command once in a terminal, where it can ask; after '
  + 'that the credential helper usually remembers, and this button works.'

/** The one line of advice, then what git said, so neither is lost. */
function saidBy(result: { out: string; err: string }, advice: string | null): string {
  const words = (result.err || result.out).trim()
  if (!advice) return words || 'git refused, and said nothing about why.'
  return words ? `${advice}\n\ngit said: ${words}` : advice
}

/**
 * Push the current branch forward, to wherever git says a push of it goes.
 *
 * `own` is whether this is the person's own repository rather than the
 * `.kehikot` one — see `commitPaths` in `repo.ts` for the convention. Here it
 * decides one thing: their `pre-push` hook runs, because a push they pressed
 * for is a push they want their hook on.
 */
export async function push(cwd: string, git: GitRunner, own: boolean): Promise<Moved> {
  const at = await where(cwd, git)
  if (!at.branch) {
    return no(
      'HEAD is not on a branch, so there is nothing to push it as. Pick a branch first — a push sends one branch, '
      + 'and a detached HEAD is a commit rather than a branch.',
    )
  }
  if (!at.remotes.length) {
    return no(
      'This repository has no remote, so there is nowhere to push to. `git remote add origin <url>` in a terminal '
      + 'gives it one; this pane does not edit remotes.',
    )
  }

  const first = !at.upstream
  let args: string[]
  let to: string
  if (at.pushRemote && at.pushRef) {
    to = at.pushTo ?? `${at.pushRemote}/${at.branch}`
    args = ['push', ...(first ? ['--set-upstream'] : []), at.pushRemote, `refs/heads/${at.branch}:${at.pushRef}`]
    if (!first && at.ahead === 0 && !at.gone) {
      return { ok: true, said: `Nothing to push: ${to} already has every commit on ${at.branch}.`, wouldLose: [] }
    }
  } else if (at.publishTo) {
    to = `${at.publishTo}/${at.branch}`
    args = ['push', '--set-upstream', at.publishTo, `refs/heads/${at.branch}:refs/heads/${at.branch}`]
  } else {
    return no(
      `${at.branch} has no upstream and this repository has ${at.remotes.length} remotes (${at.remotes.join(', ')}), `
      + 'none of them called origin and none set as remote.pushDefault. Which one a first push goes to is your '
      + 'choice, so make it once in a terminal — `git push -u <remote> ' + at.branch + '` — and this button works '
      + 'from then on.',
    )
  }

  const done = await git([...(own ? hooked : []), ...args], { cwd })
  if (!done.ok) {
    const words = `${done.err}\n${done.out}`
    if (/non-fast-forward|fetch first|\[rejected\]/i.test(words)) {
      return no(
        `${to} has commits that ${at.branch} does not, so the push was refused and nothing changed on either side. `
        + 'That is not a mistake — somebody pushed there first. Pull to bring their commits in, then push again.'
        + `\n\ngit said: ${(done.err || done.out).trim()}`,
      )
    }
    return no(saidBy(done, ASKED.test(words) ? CREDENTIAL : null))
  }

  const sent = first ? null : at.ahead
  return {
    ok: true,
    said:
      (sent === null
        ? `Published ${at.branch} to ${to}.`
        : `Pushed ${sent === 1 ? '1 commit' : `${sent} commits`} to ${to}.`)
      + (first ? ` ${at.branch} now tracks ${to}, so pull knows where to look.` : ''),
    wouldLose: [],
  }
}

/**
 * Bring the upstream in, and only if the branch can move onto it cleanly.
 *
 * See the essay at the top for `--ff-only`. `wouldLose` names the uncommitted
 * files when that is what stopped it, the same shape `switchTo` uses, so the
 * page draws it the same way.
 */
export async function pull(cwd: string, git: GitRunner, own: boolean): Promise<Moved> {
  const at = await where(cwd, git)
  if (!at.branch) {
    return no(
      'HEAD is not on a branch, so there is no branch to pull into. Pick a branch first; a pull moves a branch '
      + 'forward, and a detached HEAD is not one.',
    )
  }
  if (!at.remotes.length) {
    return no('This repository has no remote, so there is nowhere to pull from. `git remote add origin <url>` in a terminal gives it one.')
  }
  if (!at.upstream || !at.upstreamRemote || !at.upstreamRef) {
    return no(
      `${at.branch} has no upstream branch, so there is nothing for a pull to bring in. Push from here first: a `
      + 'first push publishes the branch and sets its upstream, and pull works from then on.',
    )
  }

  const before = await git(['rev-parse', 'HEAD'], { cwd })
  const done = await git(
    [...(own ? hooked : []), 'pull', '--ff-only', '--no-rebase', at.upstreamRemote, at.upstreamRef],
    { cwd },
  )
  if (!done.ok) {
    const words = `${done.err}\n${done.out}`
    if (/would be overwritten by|Please commit your changes or stash/i.test(words)) {
      /* Git names the files under its own message, one per line, tab-indented.
         Taken as written rather than re-read from `status`: these are the ones
         git stopped for, which is a shorter and more useful list than
         everything that happens to be uncommitted. */
      return {
        ok: false,
        said:
          `Bringing ${at.upstream} in would have written over work here that is not committed, so git refused the `
          + 'whole pull and nothing changed — not the branch, and not those files. The fetch half did happen, so the '
          + 'count beside pull is now current. Commit the files below, or discard them in the Uncommitted tab, and '
          + 'pull again.'
          + `\n\ngit said: ${(done.err || done.out).trim()}`,
        wouldLose: [...new Set(words.split('\n').flatMap((line) => (/^\t(.+)$/.exec(line.replace(/\r$/, '')) ?? []).slice(1)))].slice(0, 50),
      }
    }
    if (/not possible to fast-forward|diverg|specify how to reconcile/i.test(words)) {
      return no(
        `${at.branch} and ${at.upstream} have both moved since they last agreed, so bringing ${at.upstream} in would `
        + 'need a merge or a rebase, and this pane does neither — a merge can stop halfway with conflicts it has no '
        + 'way to show and no way to resolve. Nothing here was changed. The fetch half did happen, so the count '
        + 'beside pull is now current. Do the merge in a terminal, where git can ask you how.'
        + `\n\ngit said: ${(done.err || done.out).trim()}`,
      )
    }
    return no(saidBy(done, ASKED.test(words) ? CREDENTIAL : null))
  }

  const after = await git(['rev-parse', 'HEAD'], { cwd })
  const was = before.ok ? before.out.trim() : ''
  const now = after.ok ? after.out.trim() : ''
  if (was && now && was === now) {
    return { ok: true, said: `${at.branch} is already up to date with ${at.upstream}; there was nothing new to bring in.`, wouldLose: [] }
  }
  const counted = was && now ? await git(['rev-list', '--count', `${was}..${now}`], { cwd }) : null
  const count = counted?.ok ? Number(counted.out.trim()) || 0 : 0
  return {
    ok: true,
    said:
      `Pulled ${count === 1 ? '1 commit' : count ? `${count} commits` : 'what was new'} from ${at.upstream}; `
      + `${at.branch} is now at ${now.slice(0, 7) || '?'}.`,
    wouldLose: [],
  }
}
