/**
 * The short forms of the two unbounded strings on a commit row: who, and when.
 *
 * ## Why they exist at all
 *
 * A commit row's first line holds a badge, a time, an author and three icon
 * presses. At 220 pixels — the narrowest pane this ships into — the presses
 * take 80 and the badge 58, and what is left for `2026-08-31 09:00 · Jaakko` is
 * 66 pixels. Measured in Chrome: the meta wrapped to two lines under a short
 * name and to four under an email-shaped one, so a row cost 36 to 68 pixels
 * before its subject was drawn, in a pane 340 pixels tall. Nothing on that
 * line can be dropped — a list that loses its year across a boundary lies at
 * exactly the row somebody is scrolling for — but both strings can be SAID
 * SHORTER, with the long form one hover away in a `title` and, for a screen
 * reader, still in the DOM.
 *
 * These are the rules for saying them shorter. They are pure and tested as a
 * table, because every input git can produce has an answer here and the wrong
 * answer is an empty badge.
 *
 * ## `initials`: the first letter of the first word and of the last
 *
 * `git log --format=%an` gives whatever the committer configured, which is one
 * of four shapes:
 *
 * - `Jaakko Rajala`, two or more words → `JR`. First and LAST rather than the
 *   first two, so that `Jaakko Matias Rajala` is still `JR` and a middle name
 *   does not change how a person is drawn between two of their machines.
 * - `Jaakko`, one word → `J`. One letter is thin, and it is honest; `JA` would
 *   read as a truncation rather than as initials.
 * - `jaakko.rajala@example.com`, an email in the name field — common on
 *   repositories made by tools — → the part before the `@`, split on the
 *   dots, underscores, dashes and pluses that stand in for spaces there → `JR`.
 * - `山田太郎`, a script with no word breaks → its first character, `山`.
 *   Characters, not UTF-16 units, so an astral-plane letter is not cut in half.
 *
 * Leading punctuation is stripped from every word — `*bot*` is `B`, not `*` —
 * and a name with no letter or digit anywhere in it, or no name at all, is
 * `?`. Never the empty string: an empty badge beside a date is a row that
 * looks broken rather than terse.
 *
 * ## `age`: relative, coarse, and never a lie about the year
 *
 * `3d`, not `08-31`. A date with the year dropped is the failure named above,
 * and `2026-08-31` does not fit in 66 pixels beside a badge. A relative age is
 * coarse — `3d` is anything from 72 to 95 hours — but it is coarse honestly:
 * `2y` says two years, and nothing about it invites a person to think it is
 * this year. One unit, the largest that is at least 1: `now` under a minute,
 * then `m`, `h`, `d`, `w`, `mo`, `y`. `mo` rather than `M` because `M` beside
 * `m` is a bug waiting for a tired reader.
 *
 * A time in the future — a clock that disagrees with the committer's — is
 * `now`, not a negative number. A string `Date.parse` cannot read is shown as
 * its first ten characters, which for anything git wrote is the date, and `?`
 * if there are none.
 *
 * `now` is a parameter so the table of tests can pin it. The component passes
 * `Date.now()` at render; the reading is re-fetched every few seconds, so the
 * age is never more than that stale.
 */

/** Space, and the characters an email local part uses instead of one. */
const WORD_BREAK = /[\s._-]+/

/** Anything before the first letter or digit of a word. */
const LEADING_JUNK = /^[^\p{L}\p{N}]+/u

export function initials(who: string): string {
  const name = who.trim()
  const at = name.indexOf('@')
  /* An email: the part before the `@`, and before any `+` in that — a
     subaddress tag is a routing note, not a name. The domain is never a
     name either, so `@example.com` has nothing to take a letter from. */
  const local = at >= 0 ? (name.slice(0, at).split('+')[0] ?? '') : name
  const words = local
    .split(WORD_BREAK)
    .map((word) => word.replace(LEADING_JUNK, ''))
    .filter(Boolean)
  const first = words[0]
  const last = words[words.length - 1]
  if (!first || !last) return '?'
  const head = Array.from(first)[0] ?? ''
  const tail = words.length > 1 ? (Array.from(last)[0] ?? '') : ''
  const letters = (head + tail).toLocaleUpperCase()
  return letters || '?'
}

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

export function age(at: string, now: number): string {
  const then = Date.parse(at)
  if (Number.isNaN(then)) return at.slice(0, 10) || '?'
  const seconds = Math.max(0, Math.floor((now - then) / 1000))
  if (seconds < MINUTE) return 'now'
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`
  if (seconds < WEEK) return `${Math.floor(seconds / DAY)}d`
  if (seconds < MONTH) return `${Math.floor(seconds / WEEK)}w`
  if (seconds < YEAR) return `${Math.floor(seconds / MONTH)}mo`
  return `${Math.floor(seconds / YEAR)}y`
}

/**
 * The long form of the time: `2026-08-31 09:00`, in the committer's own offset
 * as git wrote it. The seconds and the offset are dropped from the screen and
 * kept in the `title`, which shows `at` verbatim.
 */
export function absolute(at: string): string {
  return at.slice(0, 16).replace('T', ' ')
}
