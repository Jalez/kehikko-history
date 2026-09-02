import * as SelectPrimitive from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's select, as the atlas module vendors it, with the same three
 * departures and one more.
 *
 * ## `popper` placement, not `item-aligned`
 *
 * Item-aligned placement lays the open list over the trigger with the chosen
 * item under the pointer and needs room above and below the trigger to do it.
 * This page is framed in a pane 220 pixels wide and sometimes 340 tall; popper
 * placement collides with the frame's own edges and flips, which is the
 * behaviour that survives a small box. The viewport is not pinned to the
 * trigger's height either — that utility, which the registry carries, is a
 * 24-pixel window onto a list of branches.
 *
 * ## The list is INSIDE the frame
 *
 * Radix portals the open list to `document.body`, and this document IS the
 * pane — a module cannot draw outside its iframe. So the list is clipped by the
 * frame, and `--radix-select-content-available-height` is what keeps it
 * scrollable rather than cut off. Fourteen branches in a 340-pixel pane is a
 * list that scrolls, and that is correct.
 *
 * ## Sized like everything else here
 *
 * The trigger is the height of a `pane` button, so the row it sits in — beside
 * a badge for the commit — is one row rather than one and a half. The value is
 * `truncate` rather than wrapping, and that is the exception to this module's
 * rule about long strings, made because a trigger that grew to three lines to
 * show `feature/some-long-name` would move every row under it every time the
 * branch changed. The full name is in the open list.
 */
function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectGroup({ ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex h-6 min-w-0 items-center justify-between gap-1 rounded border border-input bg-transparent px-1.5 text-xs whitespace-nowrap transition-[color,box-shadow] outline-none',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        'data-[placeholder]:text-muted-foreground *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:truncate',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-3.5 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          'relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md border bg-background text-foreground shadow-md',
          position === 'popper' && 'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn('p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1')}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('px-1.5 py-1 text-[0.6rem] text-muted-foreground', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full min-w-0 cursor-default items-center gap-1 rounded-sm py-1 pr-6 pl-1.5 text-xs outline-hidden select-none',
        'focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      {...props}
    >
      <span data-slot="select-item-indicator" className="absolute right-1.5 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      {/* The one place a branch name is allowed to wrap: the open list, where a
          row that is two lines tall costs nothing that stays on screen. */}
      <SelectPrimitive.ItemText>
        <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn('flex cursor-default items-center justify-center py-0.5', className)}
      {...props}
    >
      <ChevronUpIcon className="size-3.5" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn('flex cursor-default items-center justify-center py-0.5', className)}
      {...props}
    >
      <ChevronDownIcon className="size-3.5" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
