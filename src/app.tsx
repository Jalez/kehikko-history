import { useCallback, useEffect, useRef, useState } from 'react'

import { ID } from '../manifest.ts'

import * as ask from '@/store/ask.ts'
import type { Both, Said, Standing, Which } from '@/store/ask.ts'
import { useRoadmap, type GotoHandler } from '@/wire/use-roadmap.ts'
import { History, Pick } from '@/view/history.tsx'
import { Nowhere } from '@/view/nowhere.tsx'

/**
 * The page.
 *
 * ## Two histories, one at a time
 *
 * The user asked for full control of both — the project's own repository and the
 * `.kehikot` data folder — and asked for them SEPARATELY. So they are two tabs
 * rather than two columns, and the reason is the pane rather than taste: at 220
 * pixels a two-column arrangement gives each history 100 pixels, which is not
 * enough for an object name and a subject line, and a person who cannot read
 * either column has not been given both.
 *
 * The tabs also make the separateness legible, which is the thing most likely to
 * be misunderstood here. These are not two views of one history. A commit in one
 * is invisible in the other, and somebody who thought otherwise would believe
 * their notes were backed up by their project's last push. The word on the tab
 * and the path under it both say which repository is in front.
 *
 * ## Which one is in front is remembered
 *
 * One word, kept by the host, unkeyed by canvas — see `use-roadmap.ts`. Somebody
 * who works in the data history wants the data history when they come back.
 *
 * ## Switching project repaints, without a reload
 *
 * `projectPath` is a dependency of the read and of the start. A host that moves
 * a person to another project sends one `roadmap.context`, this hook sets one
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

/**
 * How often the pane re-reads both histories.
 *
 * The commits this module makes happen in the SERVER process, on a file watcher
 * the page never sees, so a page that read once would be a page showing a
 * history that stopped growing the moment it loaded — which is the exact failure
 * this module exists to prevent somewhere else. Four seconds is slower than the
 * three-second debounce, so a commit is on screen within a second or two of
 * being made, and it costs one loopback request that usually comes back saying
 * the same thing.
 */
const REREAD_MS = 4000

export function App() {
  const [both, setBoth] = useState<Both | null>(null)
  const [which, setWhich] = useState<Which>('kehikot')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [wouldLose, setWouldLose] = useState<string[]>([])
  const [shown, setShown] = useState<{ sha: string; text: string } | null>(null)
  const [standing, setStanding] = useState<Standing | null>(null)

  const onGoto = useCallback<GotoHandler>((message, answer) => {
    /* A `goto` may name an epic, a step, or a reference. This pane shows two git
       repositories, so the honest answer to all three is that there is nothing
       here to be walked to — saying so quickly is what gets the reader the
       host's fallback link instead of a twelve-second wait. */
    answer(
      false,
      message.ref
        ? 'This pane shows two git histories, so there is nothing here to walk to by reference.'
        : 'This pane shows two git histories, so there is nothing here to walk to by epic or step.',
    )
  }, [])

  const { where, projectPath, project, kept, remember, resize } = useRoadmap(ID, onGoto)

  /* The remembered tab wins whenever there is one, and only ever on arrival —
     after that this page's own state is the answer. Two answers to "which
     history am I looking at" with no way to tell them apart is exactly the fault
     this workspace argues against everywhere else. */
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current || kept === null) return
    applied.current = true
    setWhich(kept)
  }, [kept])

  const pick = useCallback(
    (next: Which) => {
      setWhich(next)
      setShown(null)
      remember(next)
    },
    [remember],
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
   * has been made and does not want re-asking every four seconds.
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

  /* Both histories, re-read on a timer. See `REREAD_MS`. */
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
          /* Loopback to our own origin, so a failure is this app's own server
             being gone. The next tick tries again. */
        })
    look()
    const timer = setInterval(look, REREAD_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [projectPath])

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
        /* Re-read straight away rather than waiting for the timer: a press that
           worked and a pane that still shows the old state for four seconds
           reads as a press that did nothing. */
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

  const reading = both ? (which === 'project' ? both.project : both.kehikot) : null

  /*
   * `nowhere` is drawn only once the greeting has settled.
   *
   * At mount there is no context yet, so the first read goes out with no project
   * and comes back `nowhere: true`, which is true and is not yet worth saying: a
   * page that announced "no project is open" for one frame and was then greeted
   * would teach the reader that this screen is noise. Same argument as the
   * greeting grace in `use-roadmap.ts`, applied to the same 700 milliseconds.
   */
  const screen =
    both?.nowhere && where !== 'listening' ? (
      <Nowhere unhosted={where === 'unhosted'} project={project} />
    ) : both?.trouble ? (
      <p className="rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.7rem] leading-4 text-failed">
        {both.trouble}
      </p>
    ) : reading ? (
      <History
        reading={reading}
        standing={which === 'kehikot' ? standing : null}
        at={which === 'kehikot' ? (both?.at ?? 'waiting') : 'repository'}
        stanceSaid={which === 'kehikot' ? (both?.said ?? null) : null}
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
        onCommit={(message) => void act((path) => ask.commit(path, message.trim() || null))}
        onMove={(target) => void act((path) => ask.move(path, which, target))}
        onRestore={(commitName, file, overwrite) => void act((path) => ask.restore(path, which, commitName, file, overwrite))}
        onStash={() => void act((path) => ask.stash(path, which))}
        onShow={(sha) =>
          void act(async (path) => {
            const answer = await ask.show(path, which, sha)
            if (answer.ok) setShown({ sha, text: answer.said })
            return answer.ok ? { ok: true, said: '' } : answer
          })
        }
        shown={shown}
      />
    ) : (
      <p className="text-[0.7rem] leading-4 text-muted-foreground">
        {where === 'listening' ? 'Waiting to hear which project is open.' : 'Reading both histories.'}
      </p>
    )

  return (
    <div ref={shell} className="flex min-w-0 flex-col gap-2 p-2 text-foreground">
      {framed ? null : (
        <header>
          <h1 className="text-sm font-semibold">History</h1>
          <p className="text-[0.7rem] leading-4 text-muted-foreground">
            Both of a project’s histories. Its own git repository holds the work. The .kehikot folder where the
            Checklist, Notes, Learning and Journeys modules keep their data can have one of its own — when the project
            ignores that folder, or has no repository at all — made only when you press for it and then committed to a
            few seconds after anything in it changes, with a message saying what changed. Where the project’s own
            repository already keeps that folder, this module leaves the history where you put it.
          </p>
        </header>
      )}

      {both && !both.nowhere ? <Pick which={which} onPick={pick} /> : null}

      {reading ? (
        <p className="min-w-0 text-[0.6rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]">{reading.root}</p>
      ) : null}

      {said ? (
        <p className="rounded border border-done/40 bg-done/5 px-2 py-1.5 text-[0.65rem] leading-4 text-done">{said}</p>
      ) : null}

      {trouble ? (
        <div className="rounded border border-failed/40 bg-failed/5 px-2 py-1.5 text-[0.65rem] leading-4 text-failed">
          <p className="min-w-0 [overflow-wrap:anywhere]">{trouble}</p>
          {wouldLose.length ? (
            <ul className="mt-1 flex min-w-0 flex-col gap-0.5">
              {wouldLose.map((path) => (
                <li key={path} className="min-w-0 [overflow-wrap:anywhere]">
                  {path}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {screen}
    </div>
  )
}
