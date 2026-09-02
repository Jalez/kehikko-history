import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's input, at pane height.
 *
 * The three inputs this page used to draw by hand — a branch name, a file to
 * restore, a message — each carried their own copy of the same eleven
 * classes. One component, one height, and the focus ring the rest of the page
 * uses.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-6 w-full min-w-0 rounded border bg-transparent px-1.5 py-1 text-[0.7rem] leading-4 shadow-xs outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
