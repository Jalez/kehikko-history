import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button.tsx'
import { Explained } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/utils.ts'

/**
 * A press that has to be made twice, with what it would do said in between.
 *
 * ## Why not `window.confirm()`
 *
 * Because it does not work here, and it fails in the worst possible way. A host
 * frames a module in a sandboxed iframe, and this workspace's host does not
 * include `allow-modals`. In that sandbox `confirm()` does not throw and does not
 * open anything: it **silently returns `false`**. So a button guarded by one is
 * a button that does nothing, forever, with nothing in the console and nothing on
 * screen. A person presses it, watches nothing happen, presses it again, and
 * concludes the module is broken.
 *
 * `alert()` and `prompt()` are the same. Nothing in this module may use any of
 * them, and that is a rule about the sandbox rather than a preference about
 * dialogs.
 *
 * ## What an arm is instead
 *
 * The first press changes the button: it says what will happen, in the words of
 * the specific thing about to happen, and it looks different — a red border, not
 * only a red word, because a person scanning a pane reads shape before text. The
 * second press does it. Anywhere else, or eight seconds, disarms it.
 *
 * The eight seconds matter. An armed button left armed is a trap: somebody comes
 * back to the pane, presses what they think is a fresh button, and it fires. So
 * it un-arms itself, and the timeout is long enough to read the sentence and
 * short enough that it is never still armed when attention has moved.
 *
 * ## `warning` is the sentence, and it is the caller's job
 *
 * This component does not compose it, because a generic "are you sure?" is
 * exactly the prompt people learn to press through. What is passed in names the
 * actual thing: which files, by name, that would be lost. See `Histories`.
 *
 * ## `icon` shrinks the resting state, never the armed one
 *
 * With an `icon`, the button at rest is the icon alone with `label` as its
 * accessible name — a row of commits should not repeat three words per row.
 * Once ARMED it goes back to words, and that is deliberate rather than
 * inconsistent: the armed state is the one a person must read before pressing
 * again, and an icon that has quietly become dangerous is exactly the trap the
 * two-press pattern exists to avoid. The border still turns red, and the
 * sentence still appears under it.
 */
export function Arm({
  label,
  icon,
  reason,
  armed: armedLabel,
  warning,
  onFire,
  disabled,
  className,
}: {
  /** What the button says at rest — and, with `icon`, its accessible name instead. */
  label: string
  /** Drawn instead of `label` at rest. The armed state is always words. */
  icon?: ReactNode
  /** What a tooltip says about the resting press. Only meaningful with `icon`. */
  reason?: string
  /** What it says once armed. Should be a verb about the specific act. */
  armed: string
  /** What would happen, in specifics. Shown only while armed. */
  warning: string
  onFire: () => void
  disabled?: boolean
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disarm = useCallback(() => {
    setArmed(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  /* Disarmed by a press anywhere else on the page. Without this, the only way to
     un-arm is to wait — and a person who has changed their mind has no way to
     say so, which teaches them to navigate away instead. */
  useEffect(() => {
    if (!armed) return
    const elsewhere = () => disarm()
    document.addEventListener('pointerdown', elsewhere, { capture: true })
    return () => document.removeEventListener('pointerdown', elsewhere, { capture: true })
  }, [armed, disarm])

  const button = (
    <Button
      type="button"
      size={icon && !armed ? 'paneIcon' : 'pane'}
      variant="outline"
      aria-label={icon && !armed ? label : undefined}
      disabled={disabled}
      /* Armed, the label WRAPS. shadcn's button is `whitespace-nowrap`, which
         is right for `Cancel` and wrong for `Overwrite notes/a/really/long/
         path.json`: the armed label names the specific thing about to happen,
         and a path is not bounded by anything. Measured in Chrome before this
         line existed — the restore box armed over a 54-character path set
         `document.body.scrollWidth` to 293 on a 220-pixel pane and 343 on a
         320-pixel one. The essay in `badge.tsx` is about exactly this, one
         component over. `h-auto` with the pane height as a minimum, because a
         label on two lines cannot be 24 pixels tall. */
      className={cn(
        armed && 'h-auto min-h-6 whitespace-normal py-0.5 text-left [overflow-wrap:anywhere] border-failed/60 text-failed',
        className,
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          timer.current = setTimeout(() => setArmed(false), 8000)
          return
        }
        disarm()
        onFire()
      }}
    >
      {armed ? armedLabel : (icon ?? label)}
    </Button>
  )

  return (
    <span className="inline-flex min-w-0 flex-col gap-1">
      {icon && !armed && reason ? <Explained reason={reason}>{button}</Explained> : button}
      {armed ? (
        <span
          role="alert"
          className="rounded border border-failed/40 bg-failed/5 px-1.5 py-1 text-[0.65rem] leading-4 text-failed"
        >
          {warning}
        </span>
      ) : null}
    </span>
  )
}
