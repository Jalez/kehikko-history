import { FileDown, GitCommitHorizontal, ScrollText } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Explained, Explaining } from '@/components/ui/tooltip.tsx'
import { Arm } from '@/view/arm.tsx'
import { frozenReason } from '@/view/frozen.ts'
import { absolute, age, initials } from '@/view/terse.ts'
import type { Reading } from '@/store/ask.ts'

/**
 * The Commits tab: what is committed, newest first.
 *
 * This is the list the pane has always drawn, moved into a tab of its own when
 * the other tab arrived. A row is two lines: the object name, the time and
 * author and the three presses — open it, go there, bring a file back from it
 * — on the first, and the subject, which wraps, on the second.
 *
 * ## The presses share the first line, and what gives way when it is narrow
 *
 * They were a third line under the subject. In a pane 340 pixels tall the
 * scarce thing is height per row, and a line that holds three 24-pixel icons
 * and nothing else is the most expensive line in the row. So they sit at the
 * right end of the line the badge is on, and the row is one line shorter.
 *
 * At 220 pixels that line does not hold everything: a badge, `2026-08-31
 * 09:00 · Jaakko` and three icons come to about 255. Something has to give,
 * and it is the meta text, which WRAPS INSIDE ITS OWN BOX rather than pushing
 * the presses off the line or the pane sideways. The mechanism is the one flex
 * trick that does that: `flex-1 basis-0 min-w-0`. A flex-wrap row decides its
 * line breaks from each item's hypothetical size, and an item whose basis is
 * zero has a hypothetical size of zero — it never causes a wrap, and once the
 * line is decided it grows into whatever is left. So the presses always fit on
 * line one, and the badge, date and author take the remainder, on one line
 * when there is room and two when there is not. Neither the year nor the
 * author is dropped at any width: a list that quietly loses its year across a
 * boundary is a list that lies at exactly the row somebody is scrolling for.
 *
 * The badge is inside that box, in the text flow, and not a flex item beside
 * it. Measured at 220 in Chrome: as a flex item the badge (58px) and the
 * presses (80px) left the meta 58px, and `2026-09-02 16:50 · Jaakko` broke
 * into three lines — 48px, which is exactly what the two lines it replaced
 * had cost, so nothing was saved at the one width this ships at. In the flow
 * the badge shares its line with the date and the whole thing is two lines
 * of the small text. A short name in a `tag` badge is bounded by construction
 * and `nowrap` on it is still the only `nowrap` in the box.
 *
 * ## Under 320 pixels the line says the same things in fewer letters
 *
 * Even with the badge in the flow, at 220 the meta had 66 pixels beside the
 * badge and `2026-08-31 09:00 · Jaakko` does not fit in them. Measured in
 * Chrome, line one cost 36 pixels under a short name, 52 under a long one and
 * 68 under an email-shaped one — two to four lines of 16 — in a pane 340
 * pixels tall. So below 320 the time is a relative age (`3d`) and the author
 * is initials (`JR`), which come to about 50 pixels and put the whole line
 * back on one row of 24. The rules for both, and what they do with the odd
 * names git hands over, are in `terse.ts`. The full time is the `title` on
 * the `<time>` and the full name the `title` on the author, so both are a
 * hover away.
 *
 * Both forms are in the DOM at every width, and only one is drawn. The terse
 * one is `aria-hidden`, the full one is `sr-only` where the terse one shows,
 * so a screen reader hears `2026-08-31 09:00 · Jaakko` in a 220-pixel pane
 * exactly as in a 400-pixel one — a class that hides a word visually must not
 * be the thing that decides what a person who cannot see it is told. The
 * tests read the two forms apart by `data-terse` and `data-wide` for the same
 * reason: what is shown small is asserted, not the class that shows it.
 *
 * The two boundaries are different, and measured. The time goes long at 320
 * (`@xs/pane`): there, with 224 pixels for the meta, `2026-08-31 09:00 · JR`
 * fits on one line and a full name does not reliably. The author goes long
 * at 384 (`@sm/pane`): with 296 pixels, `2026-08-31 09:00 · Jaakko Rajala`
 * fits and only a name of six words wraps. Terse always would be the worse
 * answer — at 400 pixels there is room for words, and words are clearer.
 *
 * ## An armed "Go here" is words, and it takes a line of its own
 *
 * `Arm` goes back to words once pressed — `Check out bbbbbbb`, with a red
 * sentence under it — and that is deliberate (see `arm.tsx`). On this line it
 * is wider than the icon it replaces and carries a sentence that is not
 * bounded by anything. The presses group is therefore NOT `shrink-0`: its
 * hypothetical size becomes that sentence's full width, the flex-wrap row
 * moves the group to a line under the badge, and `min-w-0` lets it shrink to
 * the pane there so the sentence wraps. A `shrink-0` on the group would have
 * been the 464px failure in a new costume, reachable by one press.
 *
 * ## They are always visible, not revealed on hover
 *
 * Three ghost icons per row down a list forty rows long is a lot of furniture,
 * and revealing them on hover was considered. It was not done: a control that
 * is invisible until pointed at is invisible to somebody who has not learned
 * it exists, and this list is the ONLY place the module offers to open a
 * commit, go to one, or bring a file back from one. Ghost buttons are already
 * the quietest press shadcn draws; the words are gone to tooltips; that is as
 * far as hiding goes here.
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
  /* Once per render, not once per row: forty rows reading the clock forty
     times is forty chances for the top of the list and the bottom to
     disagree about what "now" is across a minute boundary. */
  const now = Date.now()

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
          {/* Line one. `flex-wrap` so that an ARMED Go here — words plus a
              sentence — can drop to a line of its own; nothing else on it ever
              wraps as an item, because the meta's basis is zero. See the essay. */}
          <div data-line="one" className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
            {/* Zero basis: never the reason the presses wrap, and grows into the
                room left beside them. The badge is INSIDE this box, in the text
                flow, rather than a flex item of its own — see the essay for the
                measurement that decided it. The text wraps, because an author's
                name is not bounded by anything. */}
            <span
              data-meta
              className="min-w-0 flex-1 basis-0 text-[0.6rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]"
            >
              <Badge variant="tag" className="mr-0.5">
                {one.short}
              </Badge>
              {/* A real space after the badge, not only a margin: to a screen
                  reader a margin is nothing, and `bbbbbbb2026-08-31` is one
                  word. */}
              {' '}
              <time dateTime={one.at} title={one.at}>
                <span data-terse aria-hidden="true" className="@xs/pane:hidden">
                  {age(one.at, now)}
                </span>
                <span data-wide className="@max-xs/pane:sr-only">
                  {absolute(one.at)}
                </span>
              </time>
              {' · '}
              <span title={one.who}>
                <span data-terse aria-hidden="true" className="@sm/pane:hidden">
                  {initials(one.who)}
                </span>
                <span data-wide className="@max-sm/pane:sr-only">
                  {one.who}
                </span>
              </span>
            </span>
            {/* `min-w-0` and no `shrink-0` on the group, and both are
                load-bearing — see the essay on the armed state. The two icon
                presses inside it ARE `shrink-0`: they are 24 pixels by
                construction, and without it the armed sentence's width was
                shared out and squeezed them to 14. */}
            <div data-presses className="ml-auto flex min-w-0 items-center gap-0.5">
              <Explained reason={`Open ${one.short} — the full commit, as git shows it`}>
                <Button
                  type="button"
                  size="paneIcon"
                  variant="ghost"
                  aria-label="Open"
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => onShow(one.sha)}
                >
                  <ScrollText className="size-3.5" />
                </Button>
              </Explained>

              {frozen ? (
                /* Grey, and the reason is the branch select's reason, because it
                   is the same refusal from the same command. */
                <Explaining
                  id={`gohere-${one.sha}`}
                  reason={frozenReason(reading.dirty.length)}
                  className="shrink-0"
                >
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
                  className="shrink-0"
                  disabled={busy}
                  onClick={() => setRestoring(restoring === one.sha ? null : one.sha)}
                >
                  <FileDown className="size-3.5" />
                </Button>
              </Explained>
            </div>
          </div>
          {/* Line two: the subject, and the one string on this screen most
              likely to be long. It wraps. It has always wrapped. See the badge
              essay. */}
          <p className="min-w-0 text-[0.7rem] leading-4 [overflow-wrap:anywhere]">{one.subject}</p>
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
