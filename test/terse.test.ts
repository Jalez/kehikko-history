import { describe, expect, test } from 'bun:test'

import { absolute, age, initials } from '../src/view/terse.ts'

/**
 * The short forms a commit row falls back to under 320 pixels, as a table.
 *
 * Every shape `git log --format=%an` can hand over has a row here, and the
 * one property that holds across all of them is the one that matters on
 * screen: the result is never empty. An empty badge beside a date is a row
 * that looks broken, and a name that is nothing but punctuation is not a
 * hypothetical — bots and misconfigured machines commit too.
 */
describe('initials: first letter of the first word and of the last', () => {
  const table: [string, string][] = [
    ['Jaakko Rajala', 'JR'],
    ['Jaakko Matias Rajala', 'JR'],
    ['Somebody With A Rather Long Name', 'SN'],
    ['Jaakko', 'J'],
    ['jaakko', 'J'],
    ['jaakko.rajala@example.com', 'JR'],
    ['jaakko_rajala@example.com', 'JR'],
    ['jaakko-rajala+git@example.com', 'JR'],
    ['root@localhost', 'R'],
    ['github-actions[bot]', 'GA'],
    ['*bot*', 'B'],
    ['山田太郎', '山'],
    ['Émile Zola', 'ÉZ'],
    ['  padded   name  ', 'PN'],
    /* Nothing to take a letter from. `?`, never the empty string. */
    ['', '?'],
    ['   ', '?'],
    ['***', '?'],
    ['@example.com', '?'],
    ['🚀', '?'],
  ]
  for (const [who, expected] of table) {
    test(`${JSON.stringify(who)} → ${expected}`, () => {
      expect(initials(who)).toBe(expected)
    })
  }

  test('is never empty, whatever git hands over', () => {
    for (const who of ['', ' ', '.', '@', '-', '__', '...@...', '\t\n']) {
      expect(initials(who).length).toBeGreaterThan(0)
    }
  })

  test('takes characters, not UTF-16 units', () => {
    /* An astral-plane letter is one character and two units; a rule that
       sliced units would show half of it. */
    expect(initials('𝒜lice 𝒵oe')).toBe('𝒜𝒵')
  })
})

describe('age: one unit, the largest that is at least one', () => {
  const now = Date.parse('2026-09-02T12:00:00Z')
  const table: [string, string][] = [
    ['2026-09-02T12:00:00Z', 'now'],
    ['2026-09-02T11:59:30Z', 'now'],
    ['2026-09-02T11:59:00Z', '1m'],
    ['2026-09-02T11:15:00Z', '45m'],
    ['2026-09-02T11:00:00Z', '1h'],
    ['2026-09-01T13:00:00Z', '23h'],
    ['2026-09-01T12:00:00Z', '1d'],
    ['2026-08-27T12:00:00Z', '6d'],
    ['2026-08-26T12:00:00Z', '1w'],
    ['2026-08-05T12:00:00Z', '4w'],
    ['2026-08-03T12:00:00Z', '1mo'],
    ['2025-09-10T12:00:00Z', '11mo'],
    ['2025-09-02T12:00:00Z', '1y'],
    ['2024-03-01T09:00:00+02:00', '2y'],
    /* git writes the committer's own offset; it is read, not ignored. */
    ['2026-09-02T14:00:00+03:00', '1h'],
  ]
  for (const [at, expected] of table) {
    test(`${at} → ${expected}`, () => {
      expect(age(at, now)).toBe(expected)
    })
  }

  test('a time in the future is "now", not a negative number', () => {
    expect(age('2026-09-03T12:00:00Z', now)).toBe('now')
  })

  test('a string that is not a time shows its date part, or a question mark, never nothing', () => {
    expect(age('not a date at all', now)).toBe('not a date')
    expect(age('', now)).toBe('?')
  })

  test('`mo` and not `M`, because `M` beside `m` is a bug waiting for a tired reader', () => {
    expect(age('2026-07-01T12:00:00Z', now)).toMatch(/^\d+mo$/)
    expect(age('2026-09-02T11:30:00Z', now)).toMatch(/^\d+m$/)
  })
})

describe('absolute: the long form, minute precision, the offset kept for the title', () => {
  test('drops the T, the seconds and the offset', () => {
    expect(absolute('2026-08-31T09:00:00+03:00')).toBe('2026-08-31 09:00')
  })
})
