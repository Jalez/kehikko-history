import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's dialog, sized to a pane rather than to a page.
 *
 * ## A modal inside an iframe is a modal over the pane, and that is what is wanted
 *
 * The host's own copy of this component says a module cannot open a modal over
 * the canvas — its page is an iframe and a dialog drawn inside one is clipped
 * by the frame's box. True, and the reason this one exists anyway is that
 * what it covers is the right thing to cover. A commit dialog is about the
 * files ticked in THIS pane; the rest of the canvas is not part of the
 * question, and a backdrop over the whole screen would be this module
 * claiming an attention it has no business claiming.
 *
 * So the content is not `max-w-2xl` centred on a page. It is `inset-2`: the
 * pane, minus eight pixels, at whatever size the pane is. At 220 by 340 that
 * is a 204-pixel box with a heading, a list and two buttons, which is cramped
 * and readable; the list scrolls inside it rather than the box growing past
 * the frame.
 *
 * ## Why this and not `window.confirm()`
 *
 * See `view/arm.tsx`. The host's sandbox has no `allow-modals`, so `confirm()`
 * returns `false` without opening anything. This is a real element in the
 * document and works everywhere the document does.
 *
 * ## No enter and exit animation classes
 *
 * The registry's `animate-in` / `fade-in-0` utilities come from
 * `tw-animate-css`, which this module does not carry. Left in, they are class
 * names that match nothing; left out, the file says what it does.
 */
function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-black/50', className)}
      {...props}
    />
  )
}

function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed inset-2 z-50 flex min-w-0 flex-col gap-2 overflow-y-auto rounded-md border bg-background p-2 text-foreground shadow-lg outline-none',
          '@sm/pane:inset-4 @sm/pane:p-3',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className="absolute top-2 right-2 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:text-foreground hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
        >
          <XIcon className="size-3.5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex min-w-0 flex-col gap-1 pr-5', className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-footer" className={cn('mt-auto flex min-w-0 flex-wrap items-start gap-1', className)} {...props} />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('min-w-0 text-[0.8rem] leading-4 font-semibold [overflow-wrap:anywhere]', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('min-w-0 text-[0.65rem] leading-4 text-muted-foreground [overflow-wrap:anywhere]', className)}
      {...props}
    />
  )
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger }
