import * as TooltipPrimitive from '@radix-ui/react-tooltip'
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
        /* `max-w` in pixels rather than a fraction of anything: this content is
           portalled to the document body, so it is not inside the container it
           is explaining and container units would measure the wrong box. 15rem
           is narrower than the narrowest pane this ships into. */
        className={cn(
          'z-50 max-w-[15rem] rounded-md border bg-popover px-2 py-1.5 text-[0.65rem] leading-4 text-popover-foreground shadow-md [overflow-wrap:anywhere]',
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
  side = 'bottom',
}: {
  reason: string
  children: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipProvider>
      <Tooltip>
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
  side = 'bottom',
}: {
  id: string
  reason: string
  children: React.ReactNode
  className?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <TooltipProvider>
      <Tooltip>
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
