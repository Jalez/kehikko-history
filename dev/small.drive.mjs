/*
 * Draw the pane at the sizes it actually ships into, and say how wide the
 * document really is at each — and whether anything is drawn on top of
 * anything else, which the width cannot say.
 *
 *     ROADMAP_MODULES_DIR=/tmp/scratch PORT=7999 bunx vite &
 *     PROJECT=/tmp/scratch/project node dev/small.drive.mjs http://127.0.0.1:7999/app out/
 *
 * ## Why this is a driver and not a test
 *
 * happy-dom does no layout. Every test in `test/render.test.tsx` about width
 * asserts the CAUSE — that no unbounded string is in a `nowrap` element, that
 * the terse and the wide form of a thing are both in the DOM — and not the
 * width, because the width is not a thing it can know. This is the other
 * half: a real Chromium at 140, 160, 220, 320 and 400 by 340, reporting what
 * only a browser can.
 *
 * 607 green tests once passed over a completely dead page in this workspace.
 * A screenshot per state is written beside the numbers so that somebody looks.
 *
 * ## `scrollWidth` cannot see two boxes on top of each other
 *
 * The first version of this driver checked one number, `document.scrollWidth
 * === viewport`, and reported PASS while the object-name badge was drawn
 * UNDER the three icon presses. The number was right: overlapping boxes take
 * no more room than one, and a page whose widest thing is the frame is
 * exactly as wide as the frame. The mechanism was a flex item with
 * `min-width: 0` being squeezed narrower than the one thing in it that
 * cannot wrap, and inline content that does not fit its box being drawn on
 * past the edge rather than clipped. No width measurement can catch that
 * class of bug. Only the boxes can.
 *
 * So this now also takes `getBoundingClientRect` of the badge and of the
 * presses group on every row, at rest and armed, and of every press's
 * tooltip against the subject of its own row, and fails on any intersection
 * of the first pair and any of the tooltip with its row's subject. A tooltip
 * over the PREVIOUS row's subject is reported and allowed: it is transient,
 * it is above the pointer, and it covers what has already been read on the
 * way down rather than the sentence the press is about.
 *
 * ## It greets itself
 *
 * The page draws nothing until a host greets it with a project path. There is
 * no host here, so the driver posts the greeting from inside the page: the
 * connection binds to `MessageEvent.source`, and a message the window sends to
 * itself has the window as its source, which is a host as far as the page can
 * tell. The path comes from `PROJECT` and must be a git repository. Over a
 * CLEAN one, "Go here" is pressable and the armed state is measured too.
 *
 * ## Run it against a scratch registry
 *
 * Starting this module's dev server REWRITES
 * `~/.roadmap/modules/roadmap.history.json` to the port and directory it bound
 * — that is what `serves()` is for. Set `ROADMAP_MODULES_DIR` before starting
 * the server this points at, or the user's live registration is pointed at a
 * worktree. That has happened.
 */
import { mkdirSync } from 'node:fs'

/* playwright-core is not a dependency of this app and must not become one. */
const { chromium } = await import(process.env.PLAYWRIGHT ?? '/tmp/height-drive/node_modules/playwright-core/index.mjs')

const PAGE = process.argv[2] ?? 'http://127.0.0.1:7999/app'
const OUT = process.argv[3] ?? '/tmp/history-small/shots'
const PROJECT = process.env.PROJECT ?? '/tmp/history-small/project'
const WIDTHS = (process.env.WIDTHS ?? '140,160,220,320,400').split(',').map(Number)
const HEIGHT = Number(process.env.HEIGHT ?? 340)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
})

const problems = []
let failed = 0

const box = (b) => `[x${Math.round(b.left)}-${Math.round(b.right)} y${Math.round(b.top)}-${Math.round(b.bottom)}]`

/** Width, and the badge against the presses on every row. */
const measure = async (page, width, label) => {
  const wide = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-line="one"]')].map((line) => {
      const badge = line.querySelector('[data-slot="badge"]')?.getBoundingClientRect()
      const presses = line.querySelector('[data-presses]')?.getBoundingClientRect()
      if (!badge || !presses) return null
      const hit = badge.right > presses.left && presses.right > badge.left && badge.bottom > presses.top && presses.bottom > badge.top
      return { badge, presses, hit }
    }),
  )
  const overlaps = rows.filter((row) => row?.hit)
  const ok = wide.scroll === width && wide.body <= width && overlaps.length === 0
  if (!ok) failed += 1
  console.log(
    `  ${label.padEnd(16)} scrollWidth=${wide.scroll} body=${wide.body} rows=${rows.length} badge/presses overlaps=${overlaps.length} ${ok ? 'ok' : 'FAIL'}`,
  )
  for (const row of overlaps) console.log(`    OVERLAP badge${box(row.badge)} presses${box(row.presses)}`)
  await page.screenshot({ path: `${OUT}/w${width}-${label.replace(/\W+/g, '-')}.png` })
}

/** Each press's tooltip against the subject of its own row, on two rows. */
const tooltips = async (page) => {
  for (const row of [0, 2]) {
    for (const name of ['Open', 'Go here', 'Restore a file']) {
      const button = page.getByRole('button', { name }).nth(row)
      if ((await button.count()) === 0) continue
      await button.scrollIntoViewIfNeeded()
      await button.hover()
      await page.waitForTimeout(500)
      const out = await page.evaluate((row) => {
        const tip = document.querySelector('[data-slot="tooltip-content"]')
        const li = document.querySelectorAll('ol > li')[row]
        const subject = li?.querySelector('[data-line="one"] + p')?.getBoundingClientRect()
        const previous = li?.previousElementSibling?.querySelector('[data-line="one"] + p')?.getBoundingClientRect()
        if (!tip || !subject) return null
        const t = tip.getBoundingClientRect()
        const hit = (a, b) => a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top
        return {
          tip: t,
          subject,
          side: tip.getAttribute('data-side'),
          inFrame: t.left >= 0 && t.right <= window.innerWidth,
          own: hit(t, subject),
          previous: previous ? hit(t, previous) : false,
        }
      }, row)
      await page.mouse.move(1, 1)
      await page.waitForTimeout(250)
      if (!out) {
        console.log(`  tooltip row${row} ${name.padEnd(14)} did not open`)
        failed += 1
        continue
      }
      const ok = !out.own && out.inFrame
      if (!ok) failed += 1
      console.log(
        `  tooltip row${row} ${name.padEnd(14)} side=${out.side} tip${box(out.tip)} subject${box(out.subject)} ${
          out.own ? 'COVERS ITS SUBJECT' : 'clear of its subject'
        }${out.previous ? ', over the previous row (allowed)' : ''}${out.inFrame ? '' : ', PAST THE FRAME'} ${ok ? 'ok' : 'FAIL'}`,
      )
    }
  }
}

for (const width of WIDTHS) {
  console.log(`\n${width}×${HEIGHT}`)
  const page = await browser.newPage({ viewport: { width, height: HEIGHT } })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  await page.evaluate((projectPath) => {
    window.postMessage(
      {
        type: 'roadmap.hello',
        protocol: 2,
        session: 'small-drive',
        context: { projectPath, project: 'scratch', theme: 'light' },
        state: null,
      },
      '*',
    )
  }, PROJECT)
  await page.waitForTimeout(2500)

  const text = await page.evaluate(() => document.body.innerText)
  if (/Nothing is framing/.test(text)) {
    console.log('  the greeting was not accepted; the page is unhosted')
    failed += 1
  }
  /* The page is not in an iframe here, so it draws the standalone header — a
     title and a paragraph that a host never shows and that would take most
     of a 340-pixel screenshot. Removed from the DOM for the pictures; it is
     above everything measured and touches no width. */
  await page.evaluate(() => document.querySelector('header')?.remove())

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')]
      .map((tab) => `${tab.getAttribute('aria-label') ?? '(no aria-label)'} => "${tab.innerText.trim()}"`)
      .join(' | '),
  )
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('ol > li')].map((li) => {
      const one = li.querySelector('[data-line="one"]')?.getBoundingClientRect().height ?? 0
      const subject = li.querySelector('[data-line="one"] + p')?.getBoundingClientRect().height ?? 0
      return `${Math.round(one)}+${Math.round(subject)}`
    }),
  )
  console.log(`  tabs: ${tabs}`)
  console.log(`  row heights (line one + subject): ${heights.join(', ')}`)

  await measure(page, width, 'commits')
  await tooltips(page)

  const go = page.getByRole('button', { name: 'Go here' }).first()
  if (await go.isEnabled().catch(() => false)) {
    await go.click()
    await page.waitForTimeout(200)
    await measure(page, width, 'go-here-armed')
    await page.mouse.click(1, HEIGHT - 2)
    await page.waitForTimeout(100)
  } else {
    console.log('  Go here is disabled here (dirty tree); run over a clean repository for the armed state')
  }

  await page.getByRole('button', { name: 'Restore a file' }).first().click()
  await page.waitForTimeout(150)
  await page.getByRole('textbox', { name: 'File to restore' }).fill('notes/a/really/quite/long/path/to/some/file/notes.json')
  await page.getByRole('button', { name: 'Restore it' }).click()
  await page.waitForTimeout(200)
  await measure(page, width, 'restore-armed')
  await page.mouse.click(1, HEIGHT - 2)

  await page.getByRole('tab', { name: /Uncommitted/ }).click()
  await page.waitForTimeout(300)
  await measure(page, width, 'uncommitted')

  await page.close()
}

console.log('\nproblems:', problems.length ? problems : 'none')
console.log(failed ? `FAIL: ${failed} state(s) wider than the pane, overlapping, or unhosted` : 'PASS: as wide as the pane, nothing drawn over anything')
await browser.close()
process.exit(failed ? 1 : 0)
