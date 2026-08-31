import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's badge, with the one class removed that made it unusable here.
 *
 * ## The trap, measured
 *
 * shadcn ships `whitespace-nowrap` on this component, and in most modules that
 * is right: a badge holds one short word — `read`, `you`, `agent` — and one that
 * wrapped to two lines would read as two badges.
 *
 * This module's badges hold **commit subjects**, and a commit subject is exactly
 * the long unbreakable string that pattern cannot survive. A `nowrap` element
 * has a min-content width equal to its whole text, and every ancestor takes its
 * own min-content from that, so the whole pane is pushed wider than its frame.
 *
 * It has been measured twice in this workspace, and both numbers are worth
 * keeping because they say the same thing at two magnitudes. Checklist put a
 * 407-character authored string in a shipped `Badge` and set an **1187px**
 * min-content floor under a 220px pane. Here, in the headless shell on this
 * module's own page at a 220px viewport, with the 83-character subject
 * `learning: a question about mode scope, written while reading the background
 * chapter`:
 *
 *     wrapping, as this ships:    document.scrollWidth = 220px
 *     nowrap, shadcn's default:   document.scrollWidth = 464px
 *                                 the subject's own min-content = 456px
 *
 * Eighty-three characters is a perfectly ordinary commit subject — this one was
 * written by an agent through the MCP door in the course of testing — and it is
 * already twice the pane. The symptom is not the badge. It is the entire pane
 * scrolling sideways with every other row cut off at the frame, while the badge
 * itself looks perfectly normal, which is why this is asserted in a test rather
 * than remembered.
 *
 * So the default variant wraps, and `min-w-0` is on it as well, because a flex
 * child's default `min-width: auto` is the other half of the same failure.
 *
 * `tag` is the original behaviour, kept for the places that genuinely want it —
 * a branch name, a status letter, an eight-character object name. Those are
 * short by construction, and `nowrap` on them is what stops `feature/x` breaking
 * after the slash. Use `tag` only where the content is bounded by something
 * other than hope.
 */
const badgeVariants = cva(
  'inline-flex min-w-0 items-center rounded border px-1.5 py-px text-[0.65rem] font-medium leading-4',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground [overflow-wrap:anywhere]',
        outline: 'text-muted-foreground [overflow-wrap:anywhere]',
        /* Short by construction. See the essay: `nowrap` is safe only here. */
        tag: 'shrink-0 whitespace-nowrap bg-muted text-muted-foreground font-mono',
        here: 'shrink-0 whitespace-nowrap border-done/40 bg-done/10 text-done',
        loud: 'shrink-0 whitespace-nowrap border-failed/40 bg-failed/10 text-failed',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
