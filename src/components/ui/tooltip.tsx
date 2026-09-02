import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { useEffect, useState, type ReactNode } from 'react'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's tooltip, sized for a pane rather than a page.
 *
 * ## Why a tooltip and not a line of prose
 *
 * Because the pane is 220 pixels wide and every permanent sentence is a
 * permanent cost. The reason a control is disabled is worth saying and is not
 * worth a paragraph that sits there whether or not anybody is asking: somebody
 * who can see that the branch select is grey does not need three lines telling
 * them so every time they look at the pane. It is asked for by pointing at the
 * thing, and answered there.
 *
 * ## A disabled control does not emit pointer events, so it cannot be hovered
 *
 * This is the trap in the whole idea, and it is silent: `disabled` on a button
 * or a Radix trigger stops `pointerenter` from firing at all, so a tooltip
 * attached directly to a disabled control never opens and nothing anywhere
 * says why. `Explaining` below is the answer — it wraps the control in a span
 * that is not disabled and hangs the tooltip off that. The span is
 * `tabIndex={0}` so the explanation is reachable by keyboard as well as by
 * mouse, because a person who cannot use a mouse has the same question.
 *
 * ## Each of these carries its own provider, and that is deliberate
 *
 * Radix requires a `TooltipProvider` above every tooltip and THROWS when there
 * is not one — not a warning, not a tooltip that fails to open: the render
 * fails. Hanging one provider at the root of the page satisfies that for the
 * page and not for anybody rendering a piece of it, which is how sixteen tests
 * that render `History` on its own went red the moment a tooltip appeared four
 * components down. A component that only works when a distant ancestor
 * remembered something is a component with an invisible prerequisite.
 *
 * So the two helpers below bring their own. Nested providers are allowed and
 * the cost is a context per tooltip in a pane with a handful of them.
 *
 * ## It opens ABOVE the control, because below is what the control is about
 *
 * shadcn's default side is `bottom`, and on this page bottom is the commit
 * subject. The three presses sit at the right end of a commit row's first
 * line, and the subject is the line under it — the one sentence a person
 * reads to decide whether to press. Measured at 220, 320 and 400: a tooltip
 * under any of the three covered the whole of that subject, 46 pixels tall
 * over a subject 16 to 64 tall, at every width. A tooltip is meant to float
 * over something; what it must not float over is the thing the pointer is
 * deciding about.
 *
 * Above the control is the previous row's subject, or the tab strip for the
 * first row — content already read, on the way down. So `top` is the default
 * for every tooltip here, and the row presses rely on it. Radix still flips
 * it to the bottom when there is no room above, which happens for a row
 * whose first line is at the very top of a scrolled frame; that is the one
 * case this cannot help and the collision handling is right to take.
 *
 * Replacing these tooltips with the native `title` on the narrow rung was
 * weighed and not done. A `title` cannot be conditional on the container, so
 * it would have meant both a tooltip and a title on one control — two
 * sentences opening at different delays — or a page-measuring script for
 * what one CSS side achieves.
 *
 * ## The reason is also in the DOM when nothing is hovering
 *
 * A tooltip that exists only while hovered is a sentence that a screen reader
 * may never reach and a test can only find by simulating a hover. So
 * `Explaining` also renders the reason in an `sr-only` node and points the
 * control at it with `aria-describedby`. That is not belt-and-braces: it is
 * what makes the disabled control self-describing to somebody who is not
 * looking at it with a cursor.
 */
function TooltipProvider({ delayDuration = 250, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        /* `max-w` in rem and in `vw`, never a container unit: this content is
           portalled to the document body, so it is not inside the element it
           is explaining. `vw` is honest here because the page IS the pane —
           the host frames it, and the viewport is the frame. 15rem was said
           to be "narrower than the narrowest pane this ships into" and was
           not: at 220 pixels the tooltip measured 240 wide, from x=0 to
           x=240 on a frame 220 across. So it is capped at the frame less a
           margin as well, whichever is smaller. */
        collisionPadding={4}
        /* `bg-background`/`text-foreground`, and NOT shadcn's `bg-popover`.
           This app's theme has no `--popover` colour — see `index.css`, which
           defines background, card, muted, accent, primary and four states,
           and no popover. So `bg-popover` compiled to
           `background-color: var(--popover)` with nothing behind it, which is
           not an error anywhere: Tailwind emits it, the browser discards the
           declaration, and the element keeps a TRANSPARENT background. The
           tooltip's words were drawn straight over the commit subject
           underneath, unreadable and looking like a rendering fault rather
           than a missing token.

           The fix is this app's own convention rather than a new token,
           because the two other floating layers here — `dialog.tsx` and
           `select.tsx` — already say `bg-background text-foreground`. Adding
           `--popover` would have made one component right and left the
           question of which of two surfaces a floating layer uses open. */
        className={cn(
          'z-50 max-w-[min(15rem,calc(100vw-0.5rem))] rounded-md border bg-background px-2 py-1.5 text-[0.65rem] leading-4 text-foreground shadow-md [overflow-wrap:anywhere]',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/**
 * Shut a tooltip when the pointer leaves the page, rather than waiting for a
 * `pointerleave` that will never arrive.
 *
 * ## The failure this prevents
 *
 * A module's page is a document inside an IFRAME. Radix closes a tooltip when
 * the pointer leaves its trigger, which it learns from pointer events on that
 * element. Move the pointer from the trigger to somewhere else in this page and
 * the event fires. Move it straight OUT of the frame — onto another container,
 * onto the host's chrome, off the window entirely — and the browser stops
 * delivering pointer events to this document at all. No `pointerleave` is sent
 * for the element the pointer was over, because from this document's point of
 * view the pointer simply stopped existing.
 *
 * So the tooltip stays open. It is a floating box of text left standing over a
 * pane the person is no longer pointing at, and nothing in the page will ever
 * take it down, because everything that would has already been skipped.
 *
 * ## What is listened to, and why each one
 *
 * - `mouseleave` on the document element: the pointer left this document's box.
 *   This is the ordinary case and the one that fires when moving to another
 *   container in the same window.
 * - `blur` on the window: the whole window lost focus — another application
 *   came forward. `mouseleave` is not guaranteed for that.
 * - `visibilitychange`: the tab or window went away entirely.
 *
 * All three are cheap, and all three mean the same thing to a tooltip: nobody
 * is pointing at this any more.
 */
function useShutWhenPointerLeaves(shut: () => void): void {
  useEffect(() => {
    const root = document.documentElement
    const gone = () => shut()
    const hidden = () => {
      if (document.visibilityState === 'hidden') shut()
    }
    root.addEventListener('mouseleave', gone)
    window.addEventListener('blur', gone)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      root.removeEventListener('mouseleave', gone)
      window.removeEventListener('blur', gone)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [shut])
}

/**
 * A reason attached to a control that WORKS.
 *
 * The tooltip hangs off the control itself, so it opens on hover and on
 * keyboard focus and costs no extra tab stop. This is the one to reach for
 * unless the control is disabled — see `Explaining` for that case, and the
 * essay above for why the two cannot be the same component.
 *
 * The child must forward a ref and spread its props; every `Button` in this
 * app does.
 */
function Explained({
  reason,
  children,
  side = 'top',
}: {
  reason: string
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const [open, setOpen] = useState(false)
  useShutWhenPointerLeaves(() => setOpen(false))
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * A reason attached to a control that is DISABLED.
 *
 * `id` is required rather than generated because the `aria-describedby` has to
 * name it and the caller is the one holding the control.
 */
function Explaining({
  id,
  reason,
  children,
  className,
  side = 'top',
}: {
  id: string
  reason: string
  children: ReactNode
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const [open, setOpen] = useState(false)
  useShutWhenPointerLeaves(() => setOpen(false))
  return (
    <TooltipProvider>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          {/* Not a button: this wrapper exists so that a DISABLED child can
              still be pointed at, and a button around a button is invalid and
              would swallow the child's own presses when it is not disabled. */}
          <span tabIndex={0} aria-describedby={id} className={cn('inline-flex min-w-0', className)}>
            {children}
          </span>
        </TooltipTrigger>
        <span id={id} className="sr-only">
          {reason}
        </span>
        <TooltipContent side={side}>{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, Explained, Explaining }
