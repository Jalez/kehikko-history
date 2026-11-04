import { LIMITS, footerItemsSchema, type FooterItem } from 'kehikot-module-protocol'

import type { Reading } from '@/store/ask.ts'
import { pullControl, pushControl, type Control } from '@/view/upstream.ts'

/**
 * History's footer, in a host that draws one (`kehikot.footer`, protocol 2.38.0): where the
 * repository stands now, and the two presses that act on it. A container folded to its header and
 * footer still says which branch it is on, what is uncommitted and how far it is from its remote.
 *
 * The header keeps the choices (Commits or Uncommitted, which repository), and the branch picker
 * stays on the page: a checkout is refused while anything is uncommitted, has a "not on a branch"
 * state and a New branch dialog, none of which a header switch can say. The commit badge and
 * Push / Pull leave the page's branch row for here, Push and Pull beside the counts they act on.
 *
 * - the branch and the commit it is on, or that HEAD is detached (warn);
 * - how many changes are uncommitted;
 * - Push and Pull with how many commits each would move, off with the reason when they cannot;
 * - what the last press said, done or failed.
 *
 * Pure: the page declares it only when the greeting said the host draws it.
 */
export const FOOT = { BRANCH: 'branch', DIRTY: 'dirty', PUSH: 'push', PULL: 'pull', SAID: 'said' } as const

export interface FooterState {
  reading: Reading
  busy: boolean
  /** What the last press said: done, or failed with its reason; null when nothing is to be said. */
  said: { kind: 'done' | 'failed'; text: string } | null
  now?: number
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)
const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

function press(id: string, word: 'Push' | 'Pull', control: Control, busy: boolean): unknown {
  return {
    kind: 'run',
    id,
    label: control.count !== null ? `${word} ${control.count}` : control.word === 'publish' ? 'Publish' : word,
    align: 'end',
    tooltip: cut(control.reason, LIMITS.FOOTER_TOOLTIP),
    disabled: busy ? 'Something is running in this repository; wait for it to finish.' : control.on ? null : cut(control.reason, LIMITS.REASON),
  }
}

export function footerItems({ reading, busy, said, now = Date.now() }: FooterState): FooterItem[] {
  const { head } = reading
  const items: unknown[] = []
  const sha = head.sha?.slice(0, 7) ?? null
  if (head.detached) {
    items.push({ kind: 'text', id: FOOT.BRANCH, text: `detached at ${sha ?? '?'}`, level: 'warn', tooltip: 'HEAD is on a commit rather than a branch. Pick a branch to get back onto one.' })
  } else {
    items.push({
      kind: 'text',
      id: FOOT.BRANCH,
      text: cut(`${head.branch ?? 'no branch yet'}${sha ? ` · ${sha}` : ' · no commits yet'}`, LIMITS.FOOTER_TEXT),
      tooltip: cut(`${reading.root}${sha ? `, on commit ${head.sha}` : ''}`, LIMITS.FOOTER_TOOLTIP),
    })
  }
  const dirty = reading.dirty.length
  items.push({ kind: 'text', id: FOOT.DIRTY, text: dirty ? `${dirty} uncommitted` : 'Clean', align: 'center', optional: true })
  if (said) {
    const text = flat(said.text)
    items.push({ kind: 'text', id: FOOT.SAID, text: cut(text, LIMITS.FOOTER_TEXT), level: said.kind === 'failed' ? 'critical' : 'normal', align: 'center', tooltip: cut(text, LIMITS.FOOTER_TOOLTIP) })
  }
  items.push(press(FOOT.PUSH, 'Push', pushControl(reading), busy), press(FOOT.PULL, 'Pull', pullControl(reading, now), busy))
  return footerItemsSchema.parse(items)
}
