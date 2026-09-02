/*
 * Draw the pane at the sizes it actually ships into, and say how wide the
 * document really is at each.
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
 * half: a real Chromium at 220×340, 320×340 and 400×340, reporting
 * `document.scrollWidth`, which must equal the viewport width in every state
 * the pane can be in, including the two that widen it most — an ARMED "Go
 * here", which is a sentence rather than an icon, and the restore box with a
 * long path typed into it.
 *
 * 607 green tests once passed over a completely dead page in this workspace.
 * A screenshot per state is written beside the numbers so that somebody looks.
 *
 * ## It greets itself
 *
 * The page draws nothing until a host greets it with a project path. There is
 * no host here, so the driver posts the greeting from inside the page: the
 * connection binds to `MessageEvent.source`, and a message the window sends to
 * itself has the window as its source, which is a host as far as the page can
 * tell. The path comes from `PROJECT` and must be a git repository.
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
const WIDTHS = (process.env.WIDTHS ?? '220,320,400').split(',').map(Number)
const HEIGHT = Number(process.env.HEIGHT ?? 340)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
})

const problems = []
let failed = 0

const measure = async (page, width, label) => {
  const wide = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }))
  const ok = wide.scroll === width && wide.body <= width
  if (!ok) failed += 1
  console.log(`  ${label.padEnd(16)} scrollWidth=${wide.scroll} body=${wide.body} ${ok ? 'ok' : 'WIDER THAN THE PANE'}`)
  await page.screenshot({ path: `${OUT}/w${width}-${label.replace(/\W+/g, '-')}.png` })
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

  /* What the rows actually show, as words — the terse form or the wide one —
     so the boundary can be read off the log rather than off a class name. */
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll('[data-line="one"]')].map((line) => line.innerText.replace(/\s+/g, ' ').trim()),
  )
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')]
      .map((tab) => `${tab.getAttribute('aria-label') ?? '(no aria-label)'} => "${tab.innerText.trim()}"`)
      .join(' | '),
  )
  const head = await page.evaluate(() => {
    const trigger = document.querySelector('[data-slot="select-trigger"]')
    return trigger?.parentElement?.innerText.replace(/\s+/g, ' ').trim() ?? '(no head row)'
  })
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('[data-line="one"]')].map((line) => Math.round(line.getBoundingClientRect().height)),
  )
  console.log(`  head row: ${JSON.stringify(head)}`)
  console.log(`  tabs: ${tabs}`)
  for (const line of lines) console.log(`  row: ${JSON.stringify(line)}`)
  console.log(`  line-one heights: ${heights.join(', ')}`)

  await measure(page, width, 'commits')

  const go = page.getByRole('button', { name: 'Go here' }).first()
  if (await go.isEnabled().catch(() => false)) {
    await go.click()
    await page.waitForTimeout(200)
    await measure(page, width, 'go-here-armed')
    await page.mouse.click(1, HEIGHT - 2)
    await page.waitForTimeout(100)
  } else {
    console.log('  Go here is disabled here (dirty tree); armed state measured separately')
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
  const kinds = await page.evaluate(() =>
    [...document.querySelectorAll('[data-kind]')].map((badge) => `${badge.innerText.trim()}(${badge.getAttribute('title') ?? ''})`).join(' '),
  )
  const toolbar = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label="Commit"], button[aria-label="Discard"], [data-selected-count]')]
      .map((node) => `"${node.innerText.trim()}"`)
      .join(' '),
  )
  console.log(`  kind badges: ${kinds || '(none)'}`)
  console.log(`  toolbar: ${toolbar}`)
  await measure(page, width, 'uncommitted')

  await page.close()
}

console.log('\nproblems:', problems.length ? problems : 'none')
console.log(failed ? `FAIL: ${failed} state(s) wider than the pane, or unhosted` : 'PASS: every state as wide as the pane and no wider')
await browser.close()
process.exit(failed ? 1 : 0)
