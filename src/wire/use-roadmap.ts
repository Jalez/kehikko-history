import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { connect, type Host, type HostEvents } from './host.ts'

/**
 * The bridge, as one React value.
 *
 * `host.ts` is the wire and knows no React; this is the only file that turns
 * messages into state, and it is deliberately the only one. Two places driving
 * "what can this page see" would eventually disagree.
 *
 * ## What this module reads off a context, which is one field
 *
 * `projectPath`, and the theme. That is nearly the whole of it, and the sparsity
 * is the point rather than an omission — see the `scope: 'global'` argument in
 * `manifest.ts`. This module's subject is two repositories that belong to a
 * project; it does not move when the reader picks a different epic, does not
 * care what is selected on the canvas, and has no reason to know which kehikko
 * this pane is standing on.
 *
 * `kehikko` is therefore not read, and the kept state is not keyed by it. What
 * IS kept is one word — which of the two repositories was in front — and that is
 * a fact about the person rather than about the canvas: somebody who works in
 * the data history wants the data history when they come back, on whichever
 * canvas they come back to.
 *
 * ## The grace
 *
 * A page cannot know at load whether it is framed. It has to wait to find out,
 * because the greeting arrives when the host is ready rather than when we are,
 * and a page that concluded "nobody is there" in the first frame would say so
 * and then be greeted a moment later — the reader would see the standalone
 * paragraph flash past and be replaced, which teaches them that paragraph is
 * noise. So there is a `listening` state with its own words, it lasts under a
 * second, and only then does the page say the harder thing.
 */
const GREETING_GRACE_MS = 700

export type Where = 'listening' | 'unhosted' | 'hosted'

/** Which of the two histories was last in front. The whole of what this module keeps. */
export type Kept = 'project' | 'kehikot'

/**
 * The kept string, read and written.
 *
 * One word, and the parser is deliberately strict: anything that is not one of
 * the two known words is `null` rather than a default. A host handing back a
 * string this module does not recognise — an older version's, a corrupted one —
 * should produce the page's own first-run behaviour, not a pane silently pointed
 * at a repository nobody chose.
 */
export function reading(state: string | null): Kept | null {
  if (state === 'project' || state === 'kehikot') return state
  return null
}

export interface Roadmap {
  where: Where
  /**
   * Where the open project is on this machine, or null.
   *
   * The single most load-bearing field this hook reads. Both repositories are
   * found from it, and without it there is nothing to find: no history to show,
   * no folder to make a repository of, nothing to commit. Null is a REAL state
   * and not a missing one, twice over — nothing is framing this page, or a host
   * knows the project's NAME and has no folder to point at. Both get a screen
   * saying so rather than a guess, because a guess here means running `git init`
   * in a repository nobody named. See `src/view/nowhere.tsx`.
   */
  projectPath: string | null
  /** What the open project is CALLED, or null. Read only to put in a sentence; a name is not a path. */
  project: string | null
  /** Which history was in front last time, as the host kept it for us. */
  kept: Kept | null
  /** Remember which history is in front. Silent when nothing is framing this page. */
  remember: (which: Kept) => void
  /** Say how tall this page would like its frame to be. Silent when nothing is framing it. */
  resize: (height: number) => void
}

export type GotoHandler = NonNullable<HostEvents['onGoto']>

interface Context {
  project: string | null
  projectPath: string | null
  theme: 'light' | 'dark'
}

export function useRoadmap(id: string, onGoto: GotoHandler): Roadmap {
  const [where, setWhere] = useState<Where>('listening')
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [kept, setKept] = useState<Kept | null>(null)
  const host = useRef<Host | null>(null)

  /**
   * The handler, held in a ref and read at the moment a `goto` arrives.
   *
   * The view rebuilds this function whenever what is on screen changes, and
   * connecting to the window again on every render would mean a torn-down
   * listener during the one millisecond a host chose to greet in. So the
   * listener is established once and always calls the newest handler.
   */
  const goto = useRef(onGoto)
  goto.current = onGoto

  useEffect(() => {
    /**
     * What the greeting and every later context both do.
     *
     * The theme is applied here rather than in a component, because it is a fact
     * about the document rather than about any part of it: the host says light
     * or dark and the root element carries it. `light` is set explicitly as well
     * as `dark`, so that a host asking for light over a machine set to dark
     * actually gets it — see the media query in `index.css`.
     */
    const arrived = (context: Context) => {
      const root = document.documentElement
      root.classList.toggle('dark', context.theme === 'dark')
      root.classList.toggle('light', context.theme === 'light')

      setWhere('hosted')
      /* Normalised to null the moment it arrives, rather than at each call site.
         A host that sends `projectPath: ""` — or omits it, against an older
         protocol — means "there is no project", and so does `null`. Two
         spellings of one state would eventually be compared two ways in two
         effects, and the effect that got it wrong would fetch with an empty
         project and paint a pane that looked like a project with no history. */
      setProjectPath(typeof context.projectPath === 'string' && context.projectPath ? context.projectPath : null)
      setProjectName(typeof context.project === 'string' && context.project ? context.project : null)
    }

    /**
     * The connection is stored BEFORE the greeting is acted on, and the order is
     * the whole of a bug that made a sibling module hang forever.
     *
     * `connect` subscribes to the mailbox, and the mailbox replays what has
     * already arrived SYNCHRONOUSLY, inside that call. The greeting almost
     * always arrives before React mounts — that is the entire reason the mailbox
     * exists — so `onHello` fires on this line, before `host.current` has been
     * assigned. Anything reading `host.current` then finds null and quietly does
     * nothing. Worse, it works often enough to look fine: a race whose good
     * outcome is the common one is the kind that ships.
     */
    type Arrival = [context: Context, state: string | null | undefined]
    let ready = false
    const early: { arrival: Arrival | null } = { arrival: null }
    const deliver = (context: Context, state: string | null | undefined) => {
      /* The kept string arrives ONLY in the greeting, and is read before the
         context is applied so the first render already has the remembered
         choice. A page that drew one history and then replaced it with the other
         would be teaching the reader that what it drew first is noise. */
      if (state !== undefined) setKept(reading(state))
      arrived(context)
    }
    const heldEarly = (...arrival: Arrival) => {
      if (ready) deliver(...arrival)
      else early.arrival = arrival
    }

    host.current = connect(id, {
      onHello: (context, state) => heldEarly(context as unknown as Context, state),
      onContext: (context) => heldEarly(context as unknown as Context, undefined),
      onGoto: (message, answer) => goto.current(message, answer),
    })
    ready = true
    if (early.arrival) deliver(...early.arrival)

    const grace = setTimeout(() => {
      setWhere((was) => (was === 'listening' ? 'unhosted' : was))
    }, GREETING_GRACE_MS)

    return () => {
      clearTimeout(grace)
      host.current?.stop()
      host.current = null
    }
  }, [id])

  /**
   * Remember which history is in front.
   *
   * Fire and forget, deliberately. A host may refuse `state.set` — it is a
   * declared capability and a declaration is not a request — and the correct
   * response to a refusal is that the choice holds for this session and is asked
   * for again next time. Blocking a tab switch on a round trip, or drawing a
   * failure beside it, would make this page's most ordinary action wait on
   * somebody else's storage.
   */
  const remember = useCallback((next: Kept) => {
    setKept(next)
    void host.current?.request('state.set', { state: next }).catch(() => {
      /* Reported nowhere on purpose. See above. */
    })
  }, [])

  const resize = useCallback((height: number) => host.current?.resize(height), [])

  return useMemo(
    () => ({ where, projectPath, project: projectName, kept, remember, resize }),
    [where, projectPath, projectName, kept, remember, resize],
  )
}
