import { FileDown, GitCommitHorizontal, ScrollText } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Explained, Explaining } from '@/components/ui/tooltip.tsx'
import { Arm } from '@/view/arm.tsx'
import { frozenReason } from '@/view/frozen.ts'
import type { Reading } from '@/store/ask.ts'

/**
 * The Commits tab: what is committed, newest first.
 *
 * This is the list the pane has always drawn, moved into a tab of its own when
 * the other tab arrived. A row is the object name, the time and author, the
 * subject that wraps, and three presses — open it, go there, bring a file back
 * from it.
 *
 * ## The three presses are icons, and the words are in tooltips
 *
 * "Open", "Go here" and "Restore a file" were three text buttons that wrapped
 * onto two rows in a narrow pane and were repeated once per commit — forty
 * words of chrome down a column forty commits long, saying the same three
 * things every time. As icons they are one row at every width, and the words
 * are still there for anybody who wants them: a tooltip on hover or focus, and
 * an `aria-label` that is the same string, so nothing is lost to a screen
 * reader or to a test that looks the control up by name.
 *
 * ## Going to a commit is frozen for the same reason as switching branch
 *
 * It is the same command. `Go here` used to stay pressable over a dirty tree
 * and arm into a warning that git was about to refuse it — two presses spent
 * learning what the branch select said by being grey. It is now disabled by
 * the same `frozenReason` the select uses, so the two halves of "you cannot
 * move HEAD right now" cannot drift apart.
 *
 * ## The subject wraps, and everything here is sized to the pane
 *
 * The strings on this screen are the longest and least breakable in the
 * workspace: commit subjects, forty-character object names. One
 * `whitespace-nowrap` on any of them sets a min-content floor wider than the
 * pane and takes the whole layout sideways — measured at 464px on a 220px
 * viewport, against 220px as this ships. So the subject wraps, and the only
 * `nowrap` here is on the eight-character object name, which is bounded by
 * construction. See the essay in `components/ui/badge.tsx`.
 */
export function Commits({
  reading,
  busy,
  onMove,
  onRestore,
  onShow,
  shown,
}: {
  reading: Reading
  busy: boolean
  onMove: (target: { branch?: string; commit?: string; create?: boolean }) => void
  onRestore: (commit: string, path: string, overwrite: boolean) => void
  onShow: (commit: string) => void
  /** The text of a commit somebody opened, keyed by object name. */
  shown: { sha: string; text: string } | null
}) {
  const [restoring, setRestoring] = useState<string | null>(null)
  const [file, setFile] = useState('')
  const data = reading.which === 'kehikot'
  const frozen = reading.dirty.length > 0

  if (reading.commits.length === 0) {
    return (
      <p className="text-[0.7rem] leading-4 text-muted-foreground">
        No commits here yet.{' '}
        {data ? 'The first one lands a few seconds after anything in the data folder changes.' : ''}
      </p>
    )
  }

  return (
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
          <div className="flex min-w-0 flex-wrap items-start gap-1">
            <Explained reason={`Open ${one.short} — the full commit, as git shows it`}>
              <Button
                type="button"
                size="paneIcon"
                variant="ghost"
                aria-label="Open"
                disabled={busy}
                onClick={() => onShow(one.sha)}
              >
                <ScrollText className="size-3.5" />
              </Button>
            </Explained>

            {frozen ? (
              /* Grey, and the reason is the branch select's reason, because it
                 is the same refusal from the same command. */
              <Explaining id={`gohere-${one.sha}`} reason={frozenReason(reading.dirty.length)}>
                <Button type="button" size="paneIcon" variant="ghost" aria-label="Go here" disabled>
                  <GitCommitHorizontal className="size-3.5" />
                </Button>
              </Explaining>
            ) : (
              <Arm
                label="Go here"
                icon={<GitCommitHorizontal className="size-3.5" />}
                reason={`Go here — check out ${one.short}, leaving you on a commit rather than a branch`}
                armed={`Check out ${one.short}`}
                warning="This leaves you looking at one commit rather than at a branch — a detached HEAD. Nothing is lost; the pane will say how to get back."
                disabled={busy}
                onFire={() => onMove({ commit: one.sha })}
              />
            )}

            <Explained reason={`Restore a file — bring one file back as it was at ${one.short}`}>
              <Button
                type="button"
                size="paneIcon"
                variant="ghost"
                aria-label="Restore a file"
                aria-expanded={restoring === one.sha}
                disabled={busy}
                onClick={() => setRestoring(restoring === one.sha ? null : one.sha)}
              >
                <FileDown className="size-3.5" />
              </Button>
            </Explained>
          </div>
          {shown?.sha === one.sha ? (
            <pre className="min-w-0 overflow-x-auto rounded border bg-muted/40 p-1.5 text-[0.6rem] leading-4">{shown.text}</pre>
          ) : null}
          {restoring === one.sha ? (
            <div className="flex min-w-0 flex-col gap-1 rounded border p-1.5">
              <Input
                value={file}
                onChange={(event) => setFile(event.target.value)}
                placeholder="path in this repository, e.g. notes/notes.json"
                aria-label="File to restore"
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
  )
}
