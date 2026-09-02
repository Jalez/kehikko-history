import { useState } from 'react'

import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Arm } from '@/view/arm.tsx'
import type { At, Reading, Standing, Which } from '@/store/ask.ts'

/**
 * One repository, drawn.
 *
 * ## Everything here is sized to the pane and nothing is `nowrap`
 *
 * The strings on this screen are the longest and least breakable in the
 * workspace: commit subjects, absolute paths, forty-character object names. One
 * `whitespace-nowrap` on any of them sets a min-content floor wider than the
 * pane and takes the whole layout sideways — measured at 464px on a 220px
 * viewport, against 220px as this ships. So the subject wraps, the paths wrap,
 * and the only `nowrap` on this screen is on the eight-character object name and
 * the status letters, which are bounded by construction. See the essay in
 * `components/ui/badge.tsx`.
 *
 * The layout is a column at every width, with a `@sm/pane` variant that only
 * ever adds breathing room. There is no two-column arrangement waiting at a
 * width the pane will never reach: this pane is 220 to 400 pixels wide in the
 * normal case, and designing for the wide case first is how the normal case ends
 * up broken.
 */
export function History({
  reading,
  standing,
  at,
  stanceSaid,
  kehikot,
  busy,
  onStart,
  onCommit,
  onMove,
  onRestore,
  onStash,
  onShow,
  shown,
}: {
  reading: Reading
  /** How the committer stands, for the data repository. Null for the project's, which nothing commits to on its own. */
  standing: Standing | null
  /** Where `.kehikot` stands as a repository of its own. Always `'repository'` for the project's own history. */
  at: At
  /** The sentence for that, composed on the server so this pane and the MCP door say the same thing. */
  stanceSaid: string | null
  /** `<project>/.kehikot`, so every sentence about it can name it. */
  kehikot: string | null
  busy: boolean
  onStart: () => void
  onCommit: (message: string) => void
  onMove: (target: { branch?: string; commit?: string; create?: boolean }) => void
  onRestore: (commit: string, path: string, overwrite: boolean) => void
  onStash: () => void
  onShow: (commit: string) => void
  /** The text of a commit somebody opened, keyed by object name. */
  shown: { sha: string; text: string } | null
}) {
  const [message, setMessage] = useState('')
  const [branch, setBranch] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)
  const [file, setFile] = useState('')

  const data = reading.which === 'kehikot'

  /*
   * There is no repository in `.kehikot`, and the four reasons draw differently.
   *
   * This used to be one sentence and one button, which is what let a person
   * press Start on a folder their own repository was already keeping. The
   * sentence comes from the server (`saying()` in `git/enclosing.ts`), naming
   * the folder in full, and the BUTTON is what changes: offered when a history
   * of its own is the only one available, replaced by a commit box when the
   * project's own repository is the one holding it, and absent when something is
   * actually wrong.
   */
  if (!reading.present) {
    if (!data) {
      return (
        <section className="flex min-w-0 flex-col gap-2">
          <p className="text-[0.7rem] leading-4 text-muted-foreground">{reading.absent}</p>
        </section>
      )
    }
    return (
      <section className="flex min-w-0 flex-col gap-2">
        <p
          className={
            at === 'refused'
              ? 'min-w-0 rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.65rem] leading-4 text-failed [overflow-wrap:anywhere]'
              : 'min-w-0 text-[0.7rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]'
          }
          data-at={at}
        >
          {stanceSaid ?? reading.absent}
        </p>

        {at === 'waiting' ? (
          <>
            <Button type="button" size="pane" disabled={busy} onClick={onStart} className="self-start">
              Start a history here
            </Button>
            <p className="min-w-0 text-[0.6rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
              That makes a git repository inside {kehikot ?? 'that folder'} and nothing outside it, and this module
              then commits to it a few seconds after anything in it changes. It does not touch your project’s own
              repository, and it does not edit your .gitignore.
            </p>
          </>
        ) : null}

        {/* The project's own repository is the one keeping this folder, so a
            commit is offered INTO it — by hand, one press at a time, never on
            the debounce. `git/enclosing.ts` says why the automatic case stops at
            the boundary of a repository this module did not make. */}
        {at === 'elsewhere' ? (
          <div className="flex min-w-0 flex-col gap-1">
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="what this was, in your words"
              aria-label="Commit message"
              className="min-w-0 rounded border bg-transparent px-1.5 py-1 text-[0.7rem] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="button"
              size="pane"
              disabled={busy}
              onClick={() => {
                onCommit(message)
                setMessage('')
              }}
              className="self-start"
            >
              Commit this folder there
            </Button>
            <p className="min-w-0 text-[0.6rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
              One commit, carrying {kehikot ?? 'that folder'} and nothing else — anything you have staged elsewhere is
              left staged and uncommitted. Nothing here commits on its own into a repository this module did not make.
            </p>
          </div>
        ) : null}
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      {/* Where HEAD is. Detached gets its own colour and its own sentence,
          because it is the one state on this screen a person can be in without
          understanding it. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {reading.head.detached ? (
          <Badge variant="loud" data-detached="yes">
            not on a branch
          </Badge>
        ) : reading.head.branch ? (
          <Badge variant="here">{reading.head.branch}</Badge>
        ) : (
          <Badge variant="tag">no commits yet</Badge>
        )}
        {reading.head.sha ? <Badge variant="tag">{reading.head.sha.slice(0, 8)}</Badge> : null}
        {standing?.pending ? <Badge variant="tag" className="text-pending">committing shortly</Badge> : null}
      </div>

      {reading.head.detached ? (
        <p className="rounded border border-detached/40 bg-detached/5 px-2 py-1.5 text-[0.65rem] leading-4 text-detached">
          You are looking at one commit rather than at a branch — git calls this a detached HEAD. Nothing is lost and
          nothing is broken; what it means is that a commit made from here would belong to no branch and be hard to
          find again. Press a branch below to get back onto one.
        </p>
      ) : null}

      {standing && !standing.committing && standing.why ? (
        <p className="rounded border border-pending/40 bg-pending/5 px-2 py-1.5 text-[0.65rem] leading-4 text-pending">
          {standing.why}
        </p>
      ) : null}

      {standing?.trouble ? (
        <p className="rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.65rem] leading-4 text-failed">
          {standing.trouble}
        </p>
      ) : null}

      {/* Uncommitted work, by name.
          This is the list that has to exist before anything destructive is
          offered — every refusal on this screen points at it, so it is never a
          number a person has to go and look up. */}
      <details open={reading.dirty.length > 0} className="min-w-0">
        <summary className="cursor-pointer text-[0.7rem] font-medium">
          {reading.dirty.length ? `${reading.dirty.length} not committed` : 'Nothing uncommitted'}
        </summary>
        {reading.dirty.length ? (
          <ul className="mt-1 flex min-w-0 flex-col gap-0.5">
            {reading.dirty.slice(0, 30).map((entry) => (
              <li key={entry.path} className="flex min-w-0 items-start gap-1 text-[0.65rem] leading-4">
                <Badge variant="tag">{entry.code.trim() || '~'}</Badge>
                <span className="min-w-0 [overflow-wrap:anywhere]">{entry.path}</span>
              </li>
            ))}
            {reading.dirty.length > 30 ? (
              <li className="text-[0.65rem] leading-4 text-muted-foreground">…and {reading.dirty.length - 30} more</li>
            ) : null}
          </ul>
        ) : null}
      </details>

      {/* Committing.
          Offered for the data repository only. Committing somebody's PROJECT
          from a pane is a thing they did not ask this module to do — the project
          has its own history and its own habits around it, and a button here
          that quietly committed a half-finished feature would be this module
          reaching into work that is none of its business. What it does for the
          project is show it. */}
      {data ? (
        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-[0.7rem] font-medium" htmlFor="history-message">
            Commit the data now
          </label>
          <input
            id="history-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What you did — or leave it blank"
            className="min-w-0 rounded border bg-transparent px-1.5 py-1 text-[0.7rem] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex min-w-0 flex-wrap gap-1">
            <Button
              type="button"
              size="pane"
              disabled={busy}
              onClick={() => {
                onCommit(message)
                setMessage('')
              }}
            >
              Commit
            </Button>
            {reading.dirty.length ? (
              <Button type="button" size="pane" variant="outline" disabled={busy} onClick={onStash}>
                Set aside
              </Button>
            ) : null}
          </div>
          <p className="text-[0.65rem] leading-4 text-muted-foreground">
            A blank message gets one describing what actually changed. Commits happen by themselves a few seconds
            after any change, so this is for saying what a piece of work WAS rather than for making it safe.
          </p>
        </div>
      ) : null}

      {/* Branches. */}
      <details className="min-w-0">
        <summary className="cursor-pointer text-[0.7rem] font-medium">{reading.branches.length} branches</summary>
        <ul className="mt-1 flex min-w-0 flex-col gap-1">
          {reading.branches.map((one) => (
            <li key={one.name} className="flex min-w-0 items-center gap-1">
              {one.current ? (
                <Badge variant="here">here</Badge>
              ) : (
                <Arm
                  label={one.name}
                  armed={`Switch to ${one.name}`}
                  warning={
                    reading.dirty.length
                      ? `There are ${reading.dirty.length} uncommitted changes here, so this will be refused rather than done. Commit them or set them aside first.`
                      : 'Every file in this repository becomes what that branch says it is. Nothing is uncommitted, so nothing can be lost.'
                  }
                  disabled={busy}
                  onFire={() => onMove({ branch: one.name })}
                />
              )}
              {one.current ? <span className="min-w-0 text-[0.7rem] leading-4">{one.name}</span> : null}
            </li>
          ))}
        </ul>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="new branch"
            aria-label="New branch name"
            className="min-w-0 flex-1 rounded border bg-transparent px-1.5 py-1 text-[0.7rem] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            size="pane"
            variant="outline"
            disabled={busy || !branch.trim()}
            onClick={() => {
              onMove({ branch: branch.trim(), create: true })
              setBranch('')
            }}
          >
            Branch
          </Button>
        </div>
      </details>

      {/* The commits. */}
      <ol className="flex min-w-0 flex-col gap-1.5">
        {reading.commits.map((one) => (
          <li key={one.sha} className="flex min-w-0 flex-col gap-1 border-t pt-1.5 first:border-t-0 first:pt-0">
            <div className="flex min-w-0 flex-wrap items-baseline gap-1">
              <Badge variant="tag">{one.short}</Badge>
              <span className="text-[0.6rem] leading-4 text-muted-foreground">
                {one.at.slice(0, 16).replace('T', ' ')} · {one.who}
              </span>
            </div>
            {/* The subject, and the one string on this screen most likely to be
                long. It wraps. It has always wrapped. See the badge essay. */}
            <p className="min-w-0 text-[0.7rem] leading-4 [overflow-wrap:anywhere]">{one.subject}</p>
            <div className="flex min-w-0 flex-wrap gap-1">
              <Button type="button" size="pane" variant="ghost" disabled={busy} onClick={() => onShow(one.sha)}>
                Open
              </Button>
              <Arm
                label="Go here"
                armed={`Check out ${one.short}`}
                warning={
                  reading.dirty.length
                    ? `There are ${reading.dirty.length} uncommitted changes here, so this will be refused rather than done. Commit them or set them aside first.`
                    : 'This leaves you looking at one commit rather than at a branch — a detached HEAD. Nothing is lost; the pane will say how to get back.'
                }
                disabled={busy}
                onFire={() => onMove({ commit: one.sha })}
              />
              <Button
                type="button"
                size="pane"
                variant="ghost"
                disabled={busy}
                onClick={() => setRestoring(restoring === one.sha ? null : one.sha)}
              >
                Restore a file
              </Button>
            </div>
            {shown?.sha === one.sha ? (
              <pre className="min-w-0 overflow-x-auto rounded border bg-muted/40 p-1.5 text-[0.6rem] leading-4">
                {shown.text}
              </pre>
            ) : null}
            {restoring === one.sha ? (
              <div className="flex min-w-0 flex-col gap-1 rounded border p-1.5">
                <input
                  value={file}
                  onChange={(event) => setFile(event.target.value)}
                  placeholder="path in this repository, e.g. notes/notes.json"
                  aria-label="File to restore"
                  className="min-w-0 rounded border bg-transparent px-1.5 py-1 text-[0.7rem] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Arm
                  label="Restore it"
                  armed={`Overwrite ${file.trim() || 'that file'}`}
                  warning={
                    `${file.trim() || 'That file'} becomes what it was at ${one.short}. It lands as an uncommitted `
                    + 'change, so nothing is decided yet — but if it has uncommitted changes right now, those are '
                    + 'destroyed and git has no copy of them.'
                  }
                  disabled={busy || !file.trim()}
                  onFire={() => onRestore(one.sha, file.trim(), true)}
                />
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {reading.commits.length === 0 ? (
        <p className="text-[0.7rem] leading-4 text-muted-foreground">
          No commits here yet.{' '}
          {data ? 'The first one lands a few seconds after anything in the data folder changes.' : ''}
        </p>
      ) : null}

      {reading.trouble ? (
        <p className="rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.65rem] leading-4 text-failed">
          git said: {reading.trouble}
        </p>
      ) : null}
    </section>
  )
}

/** The two-tab row. Two things, so a row rather than a select. */
export function Pick({ which, onPick }: { which: Which; onPick: (next: Which) => void }) {
  return (
    <div role="tablist" className="flex min-w-0 gap-1">
      {(['project', 'kehikot'] as const).map((one) => (
        <Button
          key={one}
          type="button"
          role="tab"
          aria-selected={which === one}
          size="pane"
          variant={which === one ? 'default' : 'outline'}
          className="min-w-0 flex-1"
          onClick={() => onPick(one)}
        >
          {one === 'project' ? 'Project' : 'Data'}
        </Button>
      ))}
    </div>
  )
}
