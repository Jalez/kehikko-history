import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckIcon, MinusIcon } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's checkbox, at the size the paper module settled on for a pane.
 *
 * The Radix primitive rather than `<input type="checkbox">`, for the reason
 * the paper module gives in its copy of this file: a native checkbox is the
 * operating system's, `accent-color` is the whole of what a page may say about
 * it, and in a dark pane it is the one control that does not match. The
 * primitive gives the label, the space bar, the focus ring and `aria-checked`
 * for free, and draws with this theme's tokens.
 *
 * `size-3.5` rather than upstream's `size-4`, because the rows this sits in are
 * sixteen pixels of text and a sixteen-pixel box beside them reads as the
 * larger thing. And `indeterminate` is drawn — a dash rather than a tick —
 * because the tick-all box at the top of the Uncommitted list has three states
 * to be honest about, and a box that showed "some" as "none" is a box a person
 * presses expecting to select everything and deselects three files instead.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-3.5 shrink-0 rounded-[3px] border border-input shadow-xs transition-shadow outline-none',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        {props.checked === 'indeterminate' ? <MinusIcon className="size-2.5" /> : <CheckIcon className="size-2.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
