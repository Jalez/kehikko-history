import { useState } from 'react'

import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Arm } from '@/view/arm.tsx'
import type { Reading } from '@/store/ask.ts'

/**
 * The Commits tab: what is committed, newest first.
 *
 * This is the list the pane has always drawn, moved into a tab of its own when
 * the other tab arrived. Nothing about a row changed: the object name, the
 * time and author, the subject that wraps, and the three presses — open it,
 * go there, bring a file back from it.
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
          <div className="flex min-w-0 flex-wrap gap-1">
            <Button type="button" size="pane" variant="ghost" disabled={busy} onClick={() => onShow(one.sha)}>
              Open
            </Button>
            <Arm
              label="Go here"
              armed={`Check out ${one.short}`}
              warning={
                reading.dirty.length
                  ? `There are ${reading.dirty.length} uncommitted changes here, so git will refuse this rather than do it. Commit them or discard them first.`
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
