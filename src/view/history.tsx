import { FileDiff, History as HistoryIcon } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx'
import { Commits } from '@/view/commits.tsx'
import { Head } from '@/view/head.tsx'
import { Uncommitted } from '@/view/uncommitted.tsx'
import type { At, Dirty, Reading, Standing, Which } from '@/store/ask.ts'

/**
 * One repository, drawn: the branch row, then two tabs that are two halves of
 * it.
 *
 * ## The tabs are not two repositories any more
 *
 * They were. "Project" and "Data" were two repositories — the project's own and
 * the `.kehikot` folder's — and that split earned its keep only when there
 * really were two. On a project that keeps `.kehikot` in its own repository
 * there is exactly one, and the Data tab had become a near-empty pane whose
 * only content was a paragraph explaining that it had nothing to do. Somebody
 * opened it and asked, reasonably, what it was for.
 *
 * So the tabs here are **Commits** and **Uncommitted (n)**: what is in the
 * history, and what is not yet. Both are about the one repository this
 * component was given. Which repository that is — when there are two — is the
 * chooser in `app.tsx`, drawn above this and drawn only when the question has
 * two answers.
 *
 * ## Everything here is sized to the pane and nothing is `nowrap`
 *
 * The strings on this screen are the longest and least breakable in the
 * workspace: commit subjects, absolute paths, forty-character object names. One
 * `whitespace-nowrap` on any of them sets a min-content floor wider than the
 * pane and takes the whole layout sideways — measured at 464px on a 220px
 * viewport, against 220px as this ships. So the subject wraps, the paths wrap,
 * and the only `nowrap` on this screen is on the eight-character object name,
 * the kind words and the tab labels, which are bounded by construction. See
 * the essay in `components/ui/badge.tsx`.
 */
export function History({
  reading,
  standing,
  at,
  stanceSaid,
  kehikot,
  busy,
  onStart,
  onCommitPaths,
  onDiscard,
  onMove,
  onPush,
  onPull,
  onRestore,
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
  onCommitPaths: (entries: Dirty[], message: string) => void
  onDiscard: (entries: Dirty[]) => void
  onMove: (target: { branch?: string; commit?: string; create?: boolean }) => void
  /** The two network presses. Whether either is offered is decided in `Head` from `reading.remote`; see `git/remote.ts`. */
  onPush: () => void
  onPull: () => void
  onRestore: (commit: string, path: string, overwrite: boolean) => void
  onShow: (commit: string) => void
  /** The text of a commit somebody opened, keyed by object name. */
  shown: { sha: string; text: string } | null
}) {
  const [tab, setTab] = useState<'commits' | 'uncommitted'>('commits')

  const data = reading.which === 'kehikot'

  /*
   * There is no repository here, and the reasons draw differently.
   *
   * For the project's own: the sentence from the server, and nothing to press —
   * a project's repository is the project's decision. For `.kehikot`: the
   * sentence (`saying()` in `git/enclosing.ts`), naming the folder in full, and
   * a Start button only in the `waiting` case, where a history of its own is the
   * only history there will be. `elsewhere` does not reach here any more — when
   * the project's repository keeps the folder there is one repository and
   * `app.tsx` shows that one — but the sentence is still drawn if it ever does,
   * with nothing to press under it.
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
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <Head reading={reading} busy={busy} onMove={onMove} onPush={onPush} onPull={onPull} />

      {reading.head.detached ? (
        <p className="rounded border border-detached/40 bg-detached/5 px-2 py-1.5 text-[0.65rem] leading-4 text-detached">
          You are looking at one commit rather than at a branch — git calls this a detached HEAD. Nothing is lost and
          nothing is broken; what it means is that a commit made from here would belong to no branch and be hard to
          find again. Pick a branch above to get back onto one.
        </p>
      ) : null}

      {standing?.pending ? (
        <Badge variant="tag" className="self-start text-pending">
          committing shortly
        </Badge>
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

      <Tabs value={tab} onValueChange={(next) => setTab(next === 'uncommitted' ? 'uncommitted' : 'commits')}>
        {/* Under 320 pixels the tabs are icons, and the count stays.
            `Uncommitted (4)` at the tab's 12-pixel font is 104 pixels wide,
            which is exactly what a trigger gets at 220 — `(12)` was already
            past it, and a nowrap label past its trigger draws over its
            neighbour. The accessible name is an explicit `aria-label` that
            is the same words at every width, so a tab is `Uncommitted (4)`
            to a screen reader and to a test whether it is drawn as the words
            or as an icon and a number; `title` gives the words on hover.
            (The name was first left to the content, with the words `sr-only`
            when small — and a name assembled from three inline pieces came
            out with spaces in it in the harness. An explicit name is one
            string in one place.) The icons are hidden outright from 320 up. */}
        <TabsList aria-label="Committed and uncommitted">
          <TabsTrigger value="commits" aria-label="Commits" title="Commits">
            <HistoryIcon aria-hidden="true" className="size-3.5 @xs/pane:hidden" />
            <span className="hidden @xs/pane:inline">Commits</span>
          </TabsTrigger>
          <TabsTrigger
            value="uncommitted"
            data-count={reading.dirty.length}
            aria-label={`Uncommitted (${reading.dirty.length})`}
            title={`Uncommitted (${reading.dirty.length})`}
          >
            <FileDiff aria-hidden="true" className="size-3.5 @xs/pane:hidden" />
            <span className="hidden @xs/pane:inline">Uncommitted ({reading.dirty.length})</span>
            <span className="@xs/pane:hidden">{reading.dirty.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="commits">
          <Commits reading={reading} busy={busy} onMove={onMove} onRestore={onRestore} onShow={onShow} shown={shown} />
        </TabsContent>
        <TabsContent value="uncommitted">
          <Uncommitted entries={reading.dirty} busy={busy} onCommit={onCommitPaths} onDiscard={onDiscard} />
        </TabsContent>
      </Tabs>

      {reading.trouble ? (
        <p className="rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.65rem] leading-4 text-failed">
          git said: {reading.trouble}
        </p>
      ) : null}
    </section>
  )
}

/**
 * The repository chooser, for the case where there are two.
 *
 * Drawn only when `.kehikot` is — or could be — a repository of its own, and
 * deliberately not drawn like the tabs under it: a captioned pair of outline
 * buttons rather than a tab strip, so that it reads as "which history" while
 * the tabs read as "which half of it". Two rows of tabs that look the same
 * would be the confusion this replaced, one row further up.
 */
export function Pick({ which, onPick }: { which: Which; onPick: (next: Which) => void }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="shrink-0 text-[0.6rem] leading-4 text-muted-foreground">Repository</span>
      <div role="radiogroup" aria-label="Which repository" className="flex min-w-0 flex-1 gap-0.5">
        {(['project', 'kehikot'] as const).map((one) => (
          <Button
            key={one}
            type="button"
            role="radio"
            aria-checked={which === one}
            size="pane"
            variant={which === one ? 'default' : 'outline'}
            className="min-w-0 flex-1"
            onClick={() => onPick(one)}
          >
            {one === 'project' ? 'Project' : '.kehikot'}
          </Button>
        ))}
      </div>
    </div>
  )
}
