import { GitCommitHorizontalIcon, Undo2Icon } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Checkbox } from '@/components/ui/checkbox.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx'
import { Textarea } from '@/components/ui/textarea.tsx'
import { Arm } from '@/view/arm.tsx'
import type { Dirty, Kind } from '@/store/ask.ts'

/**
 * The Uncommitted tab: everything git would list under `git status`, as rows
 * that can be ticked, committed, and discarded.
 *
 * ## What a row says
 *
 * A word, not a porcelain code. ` M` and `??` and `R ` are what git prints and
 * what the old pane printed after it, and they mean nothing to somebody who has
 * not read the manual page. The word is decided once, on the server, where the
 * code is parsed (`kindOf` in `git/repo.ts`); here it is drawn with a colour
 * that agrees with it — a deletion in the same red an armed press uses,
 * because both are the pane saying "this takes something away".
 *
 * A folder git has not looked inside — `?? checklist/` — is one row with a
 * slash on the end, exactly as git lists it. Committing it commits everything
 * in it, and the dialog says so.
 *
 * ## Selection is the checkboxes, and nothing else
 *
 * The tick-all box at the top has three states and shows all three. The rows
 * are ticked one at a time. The two buttons act on what is ticked, and the two
 * icon buttons on a row act on that row alone — which is the "one at a time"
 * case, and it goes through the same dialog as the many-at-once case so there
 * is one commit dialog on this page rather than two.
 *
 * What is ticked is a set of paths kept in this component and pruned against
 * the list on every render: the list is re-read every four seconds and a
 * file that was committed elsewhere in between must not stay ticked as a
 * ghost that the next press acts on.
 *
 * ## Committing goes through a dialog; discarding goes through a dialog AND an arm
 *
 * A commit needs a message, and a message needs a field, and a field in the
 * row would be a row per file. So the dialog: it names the files it is about
 * to commit, takes the message, and the commit button is disabled while the
 * message is blank — a convenience, not a rule; the rule is `message()` in
 * `git/names.ts`, whose sentence comes back if this is ever bypassed.
 *
 * Discarding is the destructive one, and it is what `arm.tsx` was written
 * for. The dialog names the files and says where they go — the stash, not
 * nowhere; see `discard` in `git/repo.ts` — and the button inside it is an
 * `Arm`: the first press turns it red and says this is the last press, the
 * second press does it. A dialog that opened on one click and fired on the
 * next would be the two-press pattern in shape only, because the second click
 * lands where the first one was aimed.
 */
type Act = { what: 'commit' | 'discard'; entries: Dirty[] }

/** How many rows are listed before the list says "and N more". A bound on the pane, not on the commit. */
const LISTED = 200

/** The word and the colour for each kind. The words are the ones a person would use; the colours agree with them. */
const KINDS: Record<Kind, { word: string; variant: 'tag' | 'here' | 'loud' }> = {
  modified: { word: 'modified', variant: 'tag' },
  new: { word: 'new', variant: 'here' },
  untracked: { word: 'untracked', variant: 'here' },
  deleted: { word: 'deleted', variant: 'loud' },
  renamed: { word: 'renamed', variant: 'tag' },
  conflicted: { word: 'conflict', variant: 'loud' },
}

export function Uncommitted({
  entries,
  busy,
  onCommit,
  onDiscard,
}: {
  entries: Dirty[]
  busy: boolean
  onCommit: (entries: Dirty[], message: string) => void
  onDiscard: (entries: Dirty[]) => void
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [act, setAct] = useState<Act | null>(null)
  const [message, setMessage] = useState('')

  /* Pruned on every render rather than in an effect, so a row that left the
     list between reads is never ticked for one frame. */
  const present = new Set(entries.map((entry) => entry.path))
  const chosen = entries.filter((entry) => ticked.has(entry.path))
  const all = entries.length > 0 && chosen.length === entries.length
  const some = chosen.length > 0 && !all

  const tick = (path: string, on: boolean) => {
    const next = new Set([...ticked].filter((one) => present.has(one)))
    if (on) next.add(path)
    else next.delete(path)
    setTicked(next)
  }

  const close = () => {
    setAct(null)
    setMessage('')
  }

  if (entries.length === 0) {
    return (
      <p data-uncommitted="none" className="text-[0.7rem] leading-4 text-muted-foreground">
        Nothing is uncommitted. Every file here is as the last commit has it.
      </p>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {/* The toolbar: tick all, the count, and the two presses over what is ticked. */}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <label className="flex shrink-0 items-center gap-1 text-[0.65rem] leading-4">
          <Checkbox
            aria-label="Select every file"
            checked={all ? true : some ? 'indeterminate' : false}
            disabled={busy}
            onCheckedChange={(on) => setTicked(on === true ? new Set(entries.map((entry) => entry.path)) : new Set())}
          />
          <span data-selected-count className="text-muted-foreground">
            {chosen.length ? `${chosen.length} of ${entries.length}` : `${entries.length} file${entries.length === 1 ? '' : 's'}`}
          </span>
        </label>
        <span className="flex-1" />
        <Button
          type="button"
          size="pane"
          disabled={busy || chosen.length === 0}
          onClick={() => setAct({ what: 'commit', entries: chosen })}
        >
          Commit
        </Button>
        <Button
          type="button"
          size="pane"
          variant="outline"
          disabled={busy || chosen.length === 0}
          onClick={() => setAct({ what: 'discard', entries: chosen })}
        >
          Discard
        </Button>
      </div>

      <ul className="flex min-w-0 flex-col gap-0.5">
        {entries.slice(0, LISTED).map((entry) => (
          <li key={entry.path} className="flex min-w-0 items-start gap-1 text-[0.65rem] leading-4">
            <Checkbox
              aria-label={`Select ${entry.path}`}
              className="mt-px"
              checked={ticked.has(entry.path)}
              disabled={busy}
              onCheckedChange={(on) => tick(entry.path, on === true)}
            />
            <Row entry={entry} />
            <span className="flex shrink-0 items-center">
              <Button
                type="button"
                size="pane"
                variant="ghost"
                className="size-5 px-0"
                aria-label={`Commit ${entry.path}`}
                title="Commit this file"
                disabled={busy}
                onClick={() => setAct({ what: 'commit', entries: [entry] })}
              >
                <GitCommitHorizontalIcon className="size-3" />
              </Button>
              <Button
                type="button"
                size="pane"
                variant="ghost"
                className="size-5 px-0"
                aria-label={`Discard ${entry.path}`}
                title="Discard this change"
                disabled={busy}
                onClick={() => setAct({ what: 'discard', entries: [entry] })}
              >
                <Undo2Icon className="size-3" />
              </Button>
            </span>
          </li>
        ))}
        {entries.length > LISTED ? (
          <li className="text-[0.65rem] leading-4 text-muted-foreground">…and {entries.length - LISTED} more</li>
        ) : null}
      </ul>

      <Dialog open={act !== null} onOpenChange={(open) => (open ? null : close())}>
        <DialogContent>
          {act?.what === 'commit' ? (
            <>
              <DialogHeader>
                <DialogTitle>{title('Commit', act.entries)}</DialogTitle>
                <DialogDescription>
                  {act.entries.some((entry) => entry.kind === 'untracked' && entry.path.endsWith('/'))
                    ? 'A folder git has not looked inside commits with everything in it. '
                    : ''}
                  What is not ticked stays as it is — uncommitted, and still here afterwards.
                </DialogDescription>
              </DialogHeader>
              <Named entries={act.entries} />
              <Textarea
                autoFocus
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="What this was, in your words"
                aria-label="Commit message"
              />
              <DialogFooter>
                <Button
                  type="button"
                  size="pane"
                  disabled={busy || !message.trim()}
                  onClick={() => {
                    onCommit(act.entries, message)
                    setTicked(new Set())
                    close()
                  }}
                >
                  {act.entries.length === 1 ? 'Commit this file' : `Commit ${act.entries.length} files`}
                </Button>
                <DialogClose asChild>
                  <Button type="button" size="pane" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : act?.what === 'discard' ? (
            <>
              <DialogHeader>
                <DialogTitle>{title('Discard changes to', act.entries)}?</DialogTitle>
                <DialogDescription>
                  {describeDiscard(act.entries)} Git keeps what is discarded on its stash rather than nowhere, so{' '}
                  <code>git stash pop</code> in this repository brings it back.
                </DialogDescription>
              </DialogHeader>
              <Named entries={act.entries} />
              <DialogFooter>
                <Arm
                  label={act.entries.length === 1 ? 'Discard this change' : `Discard ${act.entries.length} files`}
                  armed="Yes, discard"
                  warning="This is the last press. The changes leave the working tree the moment you make it."
                  disabled={busy}
                  onFire={() => {
                    onDiscard(act.entries)
                    setTicked(new Set())
                    close()
                  }}
                />
                <DialogClose asChild>
                  <Button type="button" size="pane" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** One row's word and path. A rename shows where it came from, because "renamed" without a from is a riddle. */
function Row({ entry }: { entry: Dirty }) {
  const kind = KINDS[entry.kind]
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-1">
      <Badge variant={kind.variant} data-kind={entry.kind}>
        {kind.word}
      </Badge>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {entry.from ? (
          <>
            <span className="text-muted-foreground">{entry.from} → </span>
            {entry.path}
          </>
        ) : (
          entry.path
        )}
      </span>
    </span>
  )
}

/** The files a dialog is about, by name, so the press is never over an unnamed "N files". */
function Named({ entries }: { entries: Dirty[] }) {
  return (
    <ul data-named className="flex max-h-40 min-w-0 flex-col gap-0.5 overflow-y-auto rounded border p-1.5 text-[0.65rem] leading-4">
      {entries.slice(0, LISTED).map((entry) => (
        <li key={entry.path} className="flex min-w-0 items-start gap-1">
          <Row entry={entry} />
        </li>
      ))}
      {entries.length > LISTED ? <li className="text-muted-foreground">…and {entries.length - LISTED} more</li> : null}
    </ul>
  )
}

function title(verb: string, entries: Dirty[]): string {
  if (entries.length === 1) return `${verb} ${entries[0]?.path ?? 'this file'}`
  return `${verb} ${entries.length} files`
}

/** What a discard does to THESE files, in terms of the kinds that are in the list. */
function describeDiscard(entries: Dirty[]): string {
  const kinds = new Set(entries.map((entry) => entry.kind))
  const parts: string[] = []
  if (kinds.has('modified') || kinds.has('renamed') || kinds.has('conflicted')) {
    parts.push('Changed files go back to how the last commit has them.')
  }
  if (kinds.has('deleted')) parts.push('Deleted files come back.')
  if (kinds.has('new') || kinds.has('untracked')) parts.push('New files leave the working tree.')
  return parts.join(' ')
}
