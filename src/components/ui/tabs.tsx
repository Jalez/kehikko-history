import * as TabsPrimitive from '@radix-ui/react-tabs'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's tabs, sized for a pane.
 *
 * The two tabs on this page are two halves of one repository — what is
 * committed and what is not — and Radix's primitive is used rather than two
 * buttons with `aria-selected` on them because the arrow keys, the roving
 * focus and the `tabpanel` relationship are the platform's to get right. The
 * previous pair of buttons on this page had none of those.
 *
 * What is changed from upstream is the height. The registry's list is 36
 * pixels tall with 9-pixel padding in it, which is a page's tab strip; in a
 * pane 340 pixels tall it is a tenth of everything. The triggers here are the
 * height of this app's `pane` button and the strip is the height of its
 * triggers, so the tab row costs the same as one row of buttons.
 *
 * `min-w-0` and `flex-1` on the triggers, so a long label — `Uncommitted (12)`
 * — shrinks the other rather than pushing the strip past the frame. See the
 * essay in `badge.tsx` for what a nowrap element does to a 220-pixel pane;
 * the labels here are short by construction and are the one place `nowrap` is
 * kept.
 */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex min-w-0 flex-col gap-2', className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex w-full min-w-0 items-center rounded-md bg-muted p-0.5 text-muted-foreground', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded px-1.5 text-xs font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('min-w-0 outline-none', className)} {...props} />
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
