import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import type { HostEvents } from 'kehikot-module-protocol/client'
import { Cover, coverFor, useHost, useKept, useServerStanding, type CoverState, type KeptCodec } from 'kehikot-module-protocol/client/react'

import { ID } from '../manifest.ts'

import { Button } from '@/components/ui/button.tsx'
import * as ask from '@/store/ask.ts'
import type { Both, Said, Standing, Which } from '@/store/ask.ts'
import { fallbackShows, HeaderFallback, headerDrawn, rememberHeaderDrawn } from '@/view/header-fallback.tsx'
import { FOOT, footerItems, troubleFooter } from '@/view/footer.ts'
import { headerOf, type Tab } from '@/view/header.ts'
import { pullControl, pushControl } from '@/view/upstream.ts'
import { History } from '@/view/history.tsx'

/**
 * The page.
 *
 * ## One repository, or two — and the pane says which by what it draws
 *
 * A project has a repository of its own, and its `.kehikot` folder MAY have one
 * too. Whether it does is a question `git/enclosing.ts` answers in five words,
 * and the page used to draw two tabs whatever the answer was: "Project" and
 * "Data". On a project whose own repository keeps `.kehikot` — the honest and
 * common case, once somebody has switched the host's "keep .kehikot in git"
 * setting — the Data tab was a pane with nothing in it but a paragraph
 * explaining that there was nothing in it.
 *
 * So the split is drawn only when it is real:
 *
 * - **`at: 'elsewhere'`** — the repository around the project tracks the
 *   folder (`kept`) or is about to (`offered`; git already lists it as
 *   untracked there). One repository. The page shows that one, and every
 *   `.kehikot/…` change appears in its Uncommitted tab beside everything else,
 *   which is where a person committing their thesis expects to find it.
 * - **Anything else** — `.kehikot` is a repository of its own (`repository`),
 *   could become one (`waiting`), or something is wrong with it (`refused`).
 *   Two histories, or one and the offer of a second. A chooser above the
 *   branch row says which the tabs are about, and it is drawn to look unlike
 *   the tabs, because it answers a different question.
 *
 * Nothing about the second repository's machinery went anywhere. It was drawn
 * in the wrong place, in the wrong situation, with too many words.
 *
 * ## Which one is in front is remembered
 *
 * With the tab in front, kept by the host for this container — this module on
 * this kehikko — so the same History on two kehikot keeps two views, and each is
 * back after the app restarts. It is read on every render, never copied once: the
 * same page serves every kehikko, and moving to another one brings its value. A
 * remembered `kehikot` on a project that turns out to have one repository is
 * simply overridden: there is no second repository to remember.
 *
 * ## Switching project repaints, without a reload
 *
 * `projectPath` is a dependency of the read and of the start. A host that moves
 * a person to another project sends one `kehikot.context`, this hook sets one
 * piece of state, and both run again against the other project. Nothing is
 * cached across the change.
 *
 * ## Identity is printed only when nothing is framing this page
 *
 * A host prints the module's name in the pane header and hangs the manifest's
 * `summary` off it as a tooltip. A page that also printed "History" at the top
 * of itself would be saying the name twice and spending a fixed strip of a
 * 340-pixel-tall pane on the repetition. The test is `window.parent !== window`,
 * which is answerable before first paint and therefore does not blink.
 */
const framed = typeof window !== 'undefined' && window.parent !== window

/** What this module keeps with the host: which of the two histories was in front, and which tab. */
export interface Kept {
  repo?: Which
  tab?: Tab
}

const isWhich = (value: unknown): value is Which => value === 'project' || value === 'kehikot'
const isTab = (value: unknown): value is Tab => value === 'commits' || value === 'uncommitted'

/**
 * The kept string: a JSON object, one key per field. Strict — a field that is not one of its
 * options is dropped, so an older version's string gives first-run behaviour rather than a pane
 * silently pointed at a repository nobody chose. The one bare word an earlier version kept
 * (`project` or `kehikot`) still reads, as the repository.
 */
export const KEPT: KeptCodec<Kept> = {
  read: (state) => {
    if (isWhich(state)) return { repo: state }
    if (!state) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(state)
    } catch {
      return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const { repo, tab } = parsed as Record<string, unknown>
    return { ...(isWhich(repo) ? { repo } : {}), ...(isTab(tab) ? { tab } : {}) }
  },
  write: (kept) => JSON.stringify(kept),
}

/**
 * What a press answered, and the press that takes it off the screen.
 *
 * ## An answer that cannot be dismissed outlives its question
 *
 * These boxes were written once and cleared once: `act` blanks them at the
 * start of the NEXT press. That is fine for a pane somebody is working through
 * and wrong for the pane as it is actually used. A push refused by the remote
 * leaves four lines of red pinned above the branch row of a 340-pixel pane,
 * and the only way to be rid of it was to press something else. On the refusal
 * whose own advice is "pull to bring their commits in, then push again" —
 * and pull was, until this commit, grey over any uncommitted file — there was
 * no something else to press. The reader was told to do a thing they could not
 * do, by a box they could not close.
 *
 * The dismiss is a press and not a timer. These sentences are long on purpose
 * and most of them end in an instruction; a box that took itself away after
 * five seconds is one a person is still reading when it goes.
 *
 * ## The blank line in a refusal is a blank line
 *
 * `saidBy` in `git/remote.ts` puts one line of advice, a blank line, and then
 * git's own words. Drawn in a plain `<p>` that collapses to a single space,
 * so `…then push again. git said: To github.com:…` ran together as one
 * paragraph and the seam between this pane talking and git talking — the whole
 * point of composing it that way — was invisible. `whitespace-pre-line` keeps
 * the newlines and still wraps the long lines, which is what these are: prose
 * with deliberate breaks, not preformatted text.
 */
export function Banner({ kind, children, onClose }: { kind: 'done' | 'failed'; children: ReactNode; onClose: () => void }) {
  const tone =
    kind === 'done' ? 'border-done/40 bg-done/5 text-done' : 'border-failed/40 bg-failed/5 text-failed'
  return (
    <div
      data-banner={kind}
      className={`flex min-w-0 items-start gap-1 rounded border px-2 py-1.5 text-[0.65rem] leading-4 ${tone}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <Button
        type="button"
        size="paneIcon"
        variant="ghost"
        aria-label="Dismiss"
        title="Dismiss"
        data-dismiss={kind}
        className="-mr-1 -mt-0.5 size-4 shrink-0 text-current opacity-70 hover:bg-transparent hover:opacity-100"
        onClick={onClose}
      >
        <X aria-hidden="true" className="size-3" />
      </Button>
    </div>
  )
}

export function App() {
  const [both, setBoth] = useState<Both | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [wouldLose, setWouldLose] = useState<string[]>([])
  const [shown, setShown] = useState<{ sha: string; text: string } | null>(null)
  const [standing, setStanding] = useState<Standing | null>(null)
  /* Counts the presses a host sent: a host that sends one draws the header, and this page need not. */
  const [pressed, setPressed] = useState(headerDrawn)
  const press = useRef<(press: { item: string; value?: string | boolean }) => string | void>(() => 'Nothing is open here.')

  const onGoto = useCallback<NonNullable<HostEvents['onGoto']>>((message, answer) => {
    /* A `goto` may name an epic, a step, or a reference. This pane shows git
       repositories, so the honest answer to all three is that there is nothing
       here to be walked to — saying so quickly is what gets the reader the
       host's fallback link instead of a twelve-second wait. */
    answer(
      false,
      message.ref
        ? 'This pane shows a git history, so there is nothing here to walk to by reference.'
        : 'This pane shows a git history, so there is nothing here to walk to by epic or step.',
    )
  }, [])

  const host = useHost<Kept>(
    ID,
    {
      onGoto,
      onPress: (pressing) => {
        rememberHeaderDrawn()
        setPressed(true)
        return press.current(pressing)
      },
    },
    /* The tab and the repository are this module's own kept state (`useKept`, below), so the
       protocol's kept view keeps only the scroll: one mechanism for each thing kept (2.70.0). */
    { kept: KEPT, keepView: { header: false } },
  )
  const { where, projectPath, project, resize, header, drawsHeader, footer, drawsFooter } = host
  /* Which history and which tab, kept per container and read on every render. See the essay at the top. */
  const [which, keepWhich] = useKept<Which>(host, 'repo', 'kehikot', isWhich)
  const [tab, setTab] = useKept<Tab>(host, 'tab', 'commits', isTab)
  /* How this page's own server last answered: `down` when nothing did, `stale` when it has restarted under this page. */
  const server = useServerStanding()
  const [again, setAgain] = useState(0)

  const pick = useCallback(
    (next: Which) => {
      keepWhich(next)
      setShown(null)
    },
    [keepWhich],
  )

  /**
   * Resume committing to a `.kehikot` repository that ALREADY EXISTS — and
   * nothing else.
   *
   * `asked: false`. This effect runs on every project change, which is exactly
   * why it must not be able to create anything: a page load is not consent, and
   * this effect used to be what ran `git init` in two of the user's projects
   * without anybody asking for it. What it does now is start the watcher for a
   * folder somebody has already pressed Start on once, which is a decision that
   * has been made and does not want re-asking on every load.
   *
   * A refusal is not painted from here either. The read below carries the same
   * situation in `at` and `said`, and `History` draws it in place, next to the
   * button that would act on it — rather than as a red box at the top of a pane
   * about something the reader has not been told the shape of yet.
   */
  useEffect(() => {
    if (!projectPath) return
    let alive = true
    void ask
      .start(projectPath, false)
      .then((started) => {
        if (!alive) return
        setStanding(started.standing)
      })
      .catch(() => {
        /* The read below will say what it can see. A failed start is not a
           reason to blank the pane — the project's own history is still
           readable, and is the more useful half of the two when this one is
           broken. */
      })
    return () => {
      alive = false
    }
  }, [projectPath])

  /*
   * Both histories, read again whenever the server says they changed.
   *
   * The commits this module makes happen in the SERVER process, on a file watcher the page never
   * sees, and a terminal's checkout or an edit in the working tree happens outside both. A page that
   * read once would show a history that stopped growing the moment it loaded, so the server tells it:
   * one held stream (`ask.changes`), whose first event is also the first read, and which is closed
   * while the page is hidden. Nothing here asks on a clock.
   */
  useEffect(() => {
    let alive = true
    const look = () =>
      void ask
        .histories(projectPath)
        .then((answer) => {
          if (!alive) return
          setBoth(answer)
          setStanding(answer.standing)
        })
        .catch(() => {
          /* Loopback to our own origin, so a failure is this app's own server being gone. `ask`
             has already said so to `useServerStanding`, which is what draws the cover below; the
             stream reopening — or Try again — asks again. */
        })
    const stop = ask.changes(projectPath, look)
    return () => {
      alive = false
      stop()
    }
  }, [projectPath, again])

  /** Every press, through one place, so the answer is reported the same way each time. */
  const act = useCallback(
    async (run: (path: string) => Promise<Said>) => {
      if (!projectPath) return
      setBusy(true)
      setSaid(null)
      setTrouble(null)
      setWouldLose([])
      try {
        const answer = await run(projectPath)
        if (answer.ok) {
          setSaid(answer.said)
        } else {
          setTrouble(answer.error)
          setWouldLose(answer.wouldLose ?? [])
        }
        /* Re-read straight away rather than waiting for the stream's news: a
           press that worked and a pane that still shows the old state for a
           moment reads as a press that did nothing. */
        const again = await ask.histories(projectPath)
        setBoth(again)
        setStanding(again.standing)
      } finally {
        setBusy(false)
      }
    },
    [projectPath],
  )

  /** Say how tall we would like to be, whenever what is drawn changes size. */
  const shell = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = shell.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => resize(Math.ceil(node.getBoundingClientRect().height) + 16))
    watch.observe(node)
    return () => watch.disconnect()
  })

  /* One repository or two. See the essay at the top. */
  const one = both?.at === 'elsewhere'
  const facing: Which = one ? 'project' : which
  const reading = both ? (facing === 'project' ? both.project : both.kehikot) : null

  /*
   * Every not-ready moment is the protocol's one cover, and the order is what makes it true: a
   * page that has not been greeted is `waiting`, never "no project" — the first read goes out with
   * no project and comes back `nowhere`, which is not worth saying for 700 milliseconds.
   */
  const cover: CoverState | null =
    coverFor({ where, projectPath, server }) ?? (both?.nowhere ? 'no-project' : null)

  /*
   * The host's cover is held until this page says it is drawn (protocol 2.70.0), so the first read
   * draws no "Loading…" of its own: nothing is drawn until both histories are in, and then the page
   * says so, once. A cover that is an answer (no project, the server down, nothing framing it) is
   * drawn too. Never gated on being visible: the host keeps a covered page hidden, and waiting for
   * it to be shown would hold the cover for the whole timeout.
   */
  const drawn = cover ? cover !== 'waiting' && cover !== 'loading' && cover !== 'stale' : both !== null
  const saidDrawn = useRef(false)
  const { ready } = host
  useEffect(() => {
    if (!drawn || saidDrawn.current) return
    saidDrawn.current = true
    ready()
  }, [drawn, ready])

  /*
   * The footer the host draws, when it draws one (2.38.0): the branch and commit, what is
   * uncommitted, Push and Pull beside the counts they act on, and what the last press said. The
   * page's branch row then keeps only the branch picker, and no banner is drawn. An older host draws
   * no footer, and the page is as it was.
   */
  const footed = where === 'hosted' && drawsFooter === true
  const footerSaid = footed
    ? JSON.stringify(
        !cover && reading?.present && !both?.trouble
          ? footerItems({ reading, busy, said: trouble ? { kind: 'failed', text: trouble } : said ? { kind: 'done', text: said } : null })
          : !cover && both?.trouble
            ? troubleFooter(both.trouble)
            : [],
      )
    : null
  useEffect(() => {
    if (footerSaid) footer(JSON.parse(footerSaid))
  }, [footer, footerSaid])

  const screen =
    both?.trouble ? (
      <p className="rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4 text-failed">
        {both.trouble}
      </p>
    ) : reading ? (
      <History
        reading={reading}
        standing={facing === 'kehikot' ? standing : null}
        at={facing === 'kehikot' ? (both?.at ?? 'waiting') : 'repository'}
        stanceSaid={facing === 'kehikot' ? (both?.said ?? null) : null}
        kehikot={both?.path ?? null}
        busy={busy}
        onStart={() => void act(async (path) => {
          const started = await ask.start(path, true)
          return started.ok
            ? {
                ok: true,
                /*
                 * The sentence, and it names the folder.
                 *
                 * What it replaced said "this project's data folder", and the
                 * person who read it owned a folder called `data/` — which this
                 * module has never touched — and reasonably concluded that a
                 * program had started a repository in it. So: the path, in full,
                 * and what the folder is, and the bound on what is in the
                 * repository.
                 */
                said:
                  `Started a git history in ${both?.path ?? 'that folder'} — the folder your modules keep this `
                  + 'project’s material in. The repository is inside that folder and holds nothing outside it; your '
                  + 'project’s own repository is untouched.',
              }
            : { ok: false, error: started.why ?? 'It could not be started, and said nothing about why.' }
        })}
        onCommitPaths={(entries, message) => void act((path) => ask.commitPaths(path, facing, entries, message))}
        onDiscard={(entries) => void act((path) => ask.discard(path, facing, entries))}
        onMove={(target) => void act((path) => ask.move(path, facing, target))}
        onPush={() => void act((path) => ask.push(path, facing))}
        onPull={() => void act((path) => ask.pull(path, facing))}
        onRestore={(commitName, file, overwrite) => void act((path) => ask.restore(path, facing, commitName, file, overwrite))}
        onShow={(sha) =>
          void act(async (path) => {
            const answer = await ask.show(path, facing, sha)
            if (answer.ok) setShown({ sha, text: answer.said })
            return answer.ok ? { ok: true, said: '' } : answer
          })
        }
        shown={shown}
        tab={tab}
        footed={footed}
      />
    ) : null

  /* ---- The header: what the host draws in the container's own row ------- */
  const two = !cover && Boolean(both) && !both?.nowhere && !one
  const items = headerOf({
    tab: !cover && reading?.present ? tab : null,
    uncommitted: reading?.dirty.length ?? 0,
    repository: two ? which : null,
    footed,
  })
  /* Declared again when the list is a different list, and never otherwise: a commit message being typed changes none of it. */
  const itemsKey = JSON.stringify(items)
  useEffect(() => {
    header(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header, itemsKey])
  useEffect(() => () => header([]), [header])

  press.current = ({ item, value }) => {
    if (item === 'tab') {
      if (value !== 'commits' && value !== 'uncommitted') return 'Show is Commits or Uncommitted.'
      setTab(value)
      return
    }
    if (item === FOOT.PUSH) {
      if (!reading) return 'There is no repository here.'
      const control = pushControl(reading)
      if (!control.on) return control.reason
      void act((path) => ask.push(path, facing))
      return
    }
    if (item === FOOT.PULL) {
      if (!reading) return 'There is no repository here.'
      const control = pullControl(reading)
      if (!control.on) return control.reason
      void act((path) => ask.pull(path, facing))
      return
    }
    if (item === 'repo') {
      if (!two) return 'There is one repository here, so there is nothing to choose between.'
      if (value !== 'project' && value !== 'kehikot') return 'Repository is Project or .kehikot.'
      pick(value)
      return
    }
    return `Nothing here is called ${item}.`
  }
  /* Drawn by the page itself where nobody frames it or the host says it draws no header; with an older host (no word), until a press has arrived. */
  const fallback = fallbackShows(where, drawsHeader, pressed)

  return (
    <div ref={shell} className="relative flex min-w-0 flex-col gap-2 p-2 text-foreground">
      {fallback ? <HeaderFallback items={items} onPress={(p) => void press.current(p)} className="absolute top-0 right-0" /> : null}
      {framed ? null : (
        <header>
          <h1 className="text-sm font-semibold">History</h1>
          <p className="text-[0.7rem] leading-4 text-muted-foreground">
            A project’s git history, as two tabs: what is committed, and what is not yet. The .kehikot folder where
            the Checklist, Notes, Learning and Journeys modules keep their data is part of that history when the
            project’s own repository keeps it, and can have a repository of its own — made only when you press for it
            — when the project ignores it or has no repository at all. Where there are two, a chooser above the
            branch says which one the tabs are about.
          </p>
        </header>
      )}

      {/*
        Where the repository is, and ONLY when that is a question.

        It used to be printed on every load. On a project with one repository
        it is the project folder — the folder the host is already showing, that
        the person opened, whose name is in the pane header — restated as an
        absolute path across three wrapped lines of a 220-pixel column. It said
        nothing that was not already on the screen.

        Where there are two repositories it is a different line entirely: the
        chooser above says "Project" or ".kehikot" and this says which folder
        that is on disk. So it is drawn exactly when the chooser is.
      */}
      {!cover && reading && both && !both.nowhere && !one ? (
        <p className="min-w-0 text-[0.6rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{reading.root}</p>
      ) : null}

      {said && !footed ? (
        <Banner kind="done" onClose={() => setSaid(null)}>
          <p className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{said}</p>
        </Banner>
      ) : null}

      {trouble && (!footed || wouldLose.length) ? (
        <Banner
          kind="failed"
          onClose={() => {
            setTrouble(null)
            setWouldLose([])
          }}
        >
          <p className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{trouble}</p>
          {wouldLose.length ? (
            <ul className="mt-1 flex min-w-0 flex-col gap-0.5">
              {wouldLose.map((path) => (
                <li key={path} className="min-w-0 [overflow-wrap:anywhere]">
                  {path}
                </li>
              ))}
            </ul>
          ) : null}
        </Banner>
      ) : null}

      {cover ? (
        <Cover
          state={cover}
          name="History"
          onRetry={() => setAgain((n) => n + 1)}
          /* A name is not a path, and this pane will not guess: a guess here is `git init` in a folder nobody chose. */
          detail={cover === 'no-project' && project ? `Kehikot named “${project}” but not where it is on this machine.` : null}
        />
      ) : null}
      {/* Kept mounted under a cover, so a half-written commit message survives the server coming back. */}
      <div hidden={cover !== null}>{screen}</div>
    </div>
  )
}
