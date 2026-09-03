import { age } from '@/view/terse.ts'
import type { Reading } from '@/store/ask.ts'

/**
 * What the push and pull controls say, decided in one place from one read.
 *
 * ## Every grey has a sentence, and every sentence is decided here
 *
 * A control that is always enabled and always fails is worse than one that is
 * grey; a control that is grey with no reason is a control somebody hovers,
 * clicks, and then goes to a terminal to find out about. So each of these two
 * answers three questions at once — is it on, what does it say on itself, and
 * what does the tooltip say — and it answers them as a pure function of the
 * `Reading`, so the table of cases is a table of tests rather than a set of
 * screens somebody has to reproduce.
 *
 * The reasons mirror the refusals in `git/remote.ts` on purpose. The page
 * greys the control BEFORE the press because the answer is already known from
 * the read that drew it; the server refuses the same thing again because it is
 * reachable by a request that did not look. Both say the same sentence, so
 * there are not two explanations of one fact.
 *
 * ## `push` greys on "nothing to push" and `pull` never greys on "nothing to pull"
 *
 * `ahead` is a count of local commits that the remote-tracking ref lacks, and
 * that ref is this machine's own record of what it last sent or received.
 * Nothing on the remote can make that number wrong about what a push would
 * send, so "nothing to push" is an honest reason for grey.
 *
 * `behind` is a count against the same record — and the remote may have moved
 * since. Greying pull on `behind === 0` would be the pane claiming to know a
 * server it has not asked, so it does not: pull is on whenever a pull could
 * happen, its count is shown WITH how old it is, and "already up to date" is
 * git's honest answer when a press finds nothing. The staleness is said in the
 * tooltip in the same relative units the commit rows use, from `terse.ts`.
 */

export type Why =
  | 'none'
  | 'no-commits'
  | 'detached'
  | 'no-remote'
  | 'no-upstream'
  | 'ambiguous'
  | 'nothing'
  | 'dirty'

export interface Control {
  /** Whether the press is offered. */
  on: boolean
  /** The word on the control at widths that have room. */
  word: string
  /** The number beside it, or null when there is none worth showing. */
  count: number | null
  /** What the tooltip says: why it is off, or what a press would do. */
  reason: string
  /** Which case this is, for tests and drivers. `none` means nothing is stopping it. */
  why: Why
}

/** `as of the last fetch, 3h ago` — or the honest absence of one. */
export function freshness(fetchedAt: string | null, now: number): string {
  if (!fetchedAt) return 'this repository has never fetched from here, so how far behind it is is not known'
  const since = age(fetchedAt, now)
  return since === 'now' ? 'as of a fetch a moment ago' : `as of the last fetch, ${since} ago`
}

const NO_REMOTE =
  'This repository has no remote, so there is nowhere to push to or pull from. `git remote add origin <url>` in a '
  + 'terminal gives it one; this pane does not edit remotes.'

export function pushControl(reading: Reading): Control {
  const { head, remote } = reading
  const off = (why: Why, reason: string, count: number | null = null): Control => ({ on: false, word: 'push', count, reason, why })

  if (!head.sha) return off('no-commits', 'Nothing to push yet: there are no commits.')
  if (head.detached) {
    return off('detached', 'Push is off while HEAD is detached — a push sends a branch, and you are on a commit rather than a branch. Pick a branch to get back onto one.')
  }
  if (!remote || !remote.remotes.length) return off('no-remote', NO_REMOTE)

  const branch = remote.branch ?? head.branch ?? 'this branch'
  if (remote.upstream || remote.pushTo) {
    const to = remote.pushTo ?? remote.upstream ?? ''
    if (!remote.upstream) {
      /* git knows where a push goes (a `remote.pushDefault`) without the branch
         tracking anything yet. The first push sets the upstream as well. */
      return {
        on: true,
        word: 'publish',
        count: remote.ahead > 0 ? remote.ahead : null,
        reason: `Publish ${branch} to ${to} — a first push, which also sets ${to} as its upstream so pull knows where to look.`,
        why: 'none',
      }
    }
    if (remote.ahead === 0 && !remote.gone) {
      return off('nothing', `Nothing to push: ${to} already has every commit on ${branch}.`)
    }
    return {
      on: true,
      word: 'push',
      count: remote.ahead > 0 ? remote.ahead : null,
      reason: remote.gone
        ? `Push ${branch} to ${to}. The upstream branch is gone from the remote — this push puts it back.`
        : `Push ${remote.ahead === 1 ? '1 commit' : `${remote.ahead} commits`} on ${branch} to ${to}. Only a fast-forward: if ${to} has moved, the push is refused and nothing changes.`,
      why: 'none',
    }
  }
  if (remote.publishTo) {
    return {
      on: true,
      word: 'publish',
      count: null,
      reason: `Publish ${branch} to ${remote.publishTo} — a first push, which also sets ${remote.publishTo}/${branch} as its upstream so pull knows where to look.`,
      why: 'none',
    }
  }
  return off(
    'ambiguous',
    `${branch} has no upstream and this repository has ${remote.remotes.length} remotes (${remote.remotes.join(', ')}), none `
      + `of them called origin. Which one a first push goes to is your choice: \`git push -u <remote> ${branch}\` once in `
      + 'a terminal, and this button works from then on.',
  )
}

export function pullControl(reading: Reading, now: number = Date.now()): Control {
  const { head, remote, dirty } = reading
  const off = (why: Why, reason: string, count: number | null = null): Control => ({ on: false, word: 'pull', count, reason, why })

  if (head.detached) {
    return off('detached', 'Pull is off while HEAD is detached — a pull moves a branch forward, and you are on a commit rather than a branch. Pick a branch to get back onto one.')
  }
  if (!remote || !remote.remotes.length) return off('no-remote', NO_REMOTE)
  const branch = remote.branch ?? head.branch ?? 'this branch'
  if (!remote.upstream) {
    return off('no-upstream', `${branch} has no upstream branch yet, so there is nothing to pull from. Pushing publishes it and sets one.`)
  }
  const count = remote.behind > 0 ? remote.behind : null
  if (dirty.length) {
    const changes = dirty.length === 1 ? '1 change is' : `${dirty.length} changes are`
    return off(
      'dirty',
      `Pull is off while ${changes} uncommitted — a pull rewrites the working tree the way a checkout does. Commit or `
        + 'discard them in the Uncommitted tab first.',
      count,
    )
  }
  return {
    on: true,
    word: 'pull',
    count,
    reason:
      `Pull ${remote.upstream} into ${branch} — fast-forward only: if both sides have moved it refuses and changes `
      + `nothing. ${count === null ? 'Nothing new' : count === 1 ? '1 commit' : `${count} commits`} to bring in `
      + `${freshness(remote.fetchedAt, now)}.`,
    why: 'none',
  }
}
