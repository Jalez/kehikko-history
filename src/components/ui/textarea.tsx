import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's textarea, holding the one field on this page that is somebody's
 * writing: a commit message.
 *
 * A textarea rather than the `<input>` the old commit box had, because a commit
 * message is a subject line and, sometimes, a paragraph under it — and git
 * keeps the paragraph. `field-sizing-content` with a floor of two lines and a
 * ceiling, so one sentence is one row and a paragraph grows to fit without the
 * dialog's buttons leaving the pane.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-10 max-h-40 w-full min-w-0 rounded border bg-transparent px-1.5 py-1 text-[0.7rem] leading-4 shadow-xs outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
