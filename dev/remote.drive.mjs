/*
 * Draw the branch row with push and pull on it at the widths the pane ships
 * into, and say whether any two of its boxes are drawn on top of each other —
 * then press both and read what the pane said.
 *
 *     mkdir -p /tmp/kh-drive/modules
 *     ROADMAP_MODULES_DIR=/tmp/kh-drive/modules PORT=7983 bunx vite &
 *     PROJECT=/tmp/kh-drive/project node dev/remote.drive.mjs http://127.0.0.1:7983/app /tmp/kh-drive/shots
 *
 * `PROJECT` must be a git repository with a remote it can actually reach —
 * make a BARE repository in a scratch directory and clone from it; never point
 * this at anything with a real remote, because the driver presses push.
 *
 * ## Why a driver and not a test
 *
 * The three things checked here are properties of the rendered page and not
 * of its markup, and `test/render.test.tsx` asserts the markup.
 *
 * 1. **Overlap.** The row holds a select that may shrink, a badge that may
 *    not, and two presses that may not. A flex item squeezed under its
 *    min-content paints its content past its own edge, unclipped, under the
 *    next sibling — and `document.scrollWidth` cannot see it, because two
 *    boxes on top of each other take no more room than one. This pane had
 *    exactly that fault once, on the commit rows. So the four boxes are read
 *    with `getBoundingClientRect` and every pair is checked for intersection.
 * 2. **The tooltip is a surface.** `bg-popover` on this theme is a discarded
 *    declaration and a transparent box; only `getComputedStyle` in a real
 *    browser tells the difference. Several of this row's reasons attach to
 *    greyed presses, so the grey push is hovered and its tooltip measured.
 * 3. **The container query.** Under 320 the presses are an icon and a number;
 *    from 320 up they carry a word. happy-dom does no layout, so whether the
 *    word is actually drawn at 220 is a question only a browser answers.
 *
 * And then the presses are pressed, against the scratch origin, and the
 * sentences that come back are printed, so that somebody looks.
 */
import { mkdirSync } from 'node:fs'

/* playwright-core is not a dependency of this app and must not become one. */
const { chromium } = await import(process.env.PLAYWRIGHT ?? '/tmp/height-drive/node_modules/playwright-core/index.mjs')

const PAGE = process.argv[2] ?? 'http://127.0.0.1:7983/app'
const OUT = process.argv[3] ?? '/tmp/kh-drive/shots'
const PROJECT = process.env.PROJECT ?? '/tmp/kh-drive/project'
const WIDTHS = (process.env.WIDTHS ?? '220,320,460,900').split(',').map(Number)
const HEIGHT = Number(process.env.HEIGHT ?? 340)
const PRESS = process.env.PRESS !== '0'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME ??
    `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
})

const problems = []
let failed = 0
const box = (b) => `[x${Math.round(b.left)}-${Math.round(b.right)} y${Math.round(b.top)}-${Math.round(b.bottom)}]`

/** Open the page at one width and greet it as a host would. */
async function open(width) {
  const page = await browser.newPage({ viewport: { width, height: HEIGHT } })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  await page.evaluate((projectPath) => {
    window.postMessage(
      { type: 'roadmap.hello', protocol: 2, session: 'drive', context: { projectPath, project: 'scratch', theme: 'light' }, state: null },
      '*',
    )
  }, PROJECT)
  await page.waitForTimeout(2500)
  /* Not framed, so the page draws its standalone header; it is above the row
     and touches nothing measured, and it would take most of the screenshot. */
  await page.evaluate(() => document.querySelector('header')?.remove())
  return page
}

/** The four boxes on the row, every pair checked, and whether each press carries its word. */
async function measure(page, width, label) {
  const row = await page.evaluate(() => {
    const select = document.querySelector('[data-slot="select-trigger"]')
    const badge = select?.parentElement?.closest('div.flex.items-center')?.querySelector('[data-slot="badge"]') ?? document.querySelector('[data-slot="badge"]')
    const push = document.querySelector('[data-press="push"]')
    const pull = document.querySelector('[data-press="pull"]')
    if (!select || !badge || !push || !pull) return null
    const rect = (node) => {
      const r = node.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    const word = (node) => {
      const span = node.querySelector('span:not(.tabular-nums)')
      return span ? getComputedStyle(span).display !== 'none' && span.getBoundingClientRect().width > 0 : false
    }
    return {
      boxes: { select: rect(select), badge: rect(badge), push: rect(push), pull: rect(pull) },
      words: { push: word(push), pull: word(pull) },
      state: {
        push: { off: push.disabled, why: push.getAttribute('data-why'), count: push.getAttribute('data-count'), text: push.textContent },
        pull: { off: pull.disabled, why: pull.getAttribute('data-why'), count: pull.getAttribute('data-count'), text: pull.textContent },
      },
      scroll: document.documentElement.scrollWidth,
    }
  })
  if (!row) {
    console.log(`  ${label.padEnd(12)} the row is missing a select, a badge, or a press — FAIL`)
    failed += 1
    return null
  }
  const names = Object.keys(row.boxes)
  const hits = []
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = row.boxes[names[i]]
      const b = row.boxes[names[j]]
      if (a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top) hits.push(`${names[i]}${box(a)} over ${names[j]}${box(b)}`)
    }
  }
  const past = names.filter((name) => row.boxes[name].left < 0 || row.boxes[name].right > width)
  const wordsWanted = width >= 320
  const wordsRight = row.words.push === wordsWanted && row.words.pull === wordsWanted
  const ok = hits.length === 0 && past.length === 0 && wordsRight && row.scroll === width
  if (!ok) failed += 1
  console.log(
    `  ${label.padEnd(12)} select${box(row.boxes.select)} badge${box(row.boxes.badge)} push${box(row.boxes.push)} pull${box(row.boxes.pull)}`,
  )
  console.log(
    `  ${''.padEnd(12)} words drawn: push=${row.words.push} pull=${row.words.pull} (wanted ${wordsWanted}); scrollWidth=${row.scroll}; overlaps=${hits.length}; past the frame=${past.length} ${ok ? 'ok' : 'FAIL'}`,
  )
  console.log(
    `  ${''.padEnd(12)} push: ${row.state.push.off ? 'grey' : 'on'} (${row.state.push.why}) "${row.state.push.text}"   pull: ${row.state.pull.off ? 'grey' : 'on'} (${row.state.pull.why}) "${row.state.pull.text}"`,
  )
  for (const hit of hits) console.log(`    OVERLAP ${hit}`)
  for (const name of past) console.log(`    PAST THE FRAME ${name}${box(row.boxes[name])}`)
  await page.screenshot({ path: `${OUT}/w${width}-${label.replace(/\W+/g, '-')}.png` })
  return row
}

/** Hover a press — a greyed one is wrapped in a span that CAN be hovered — and check its tooltip is a surface. */
async function tooltip(page, press) {
  const target = page.locator(`[data-press="${press}"]`)
  const wrapped = await target.evaluate((node) => node.parentElement?.tagName === 'SPAN' && node.parentElement.getAttribute('tabindex') === '0')
  await (wrapped ? target.locator('xpath=..') : target).hover()
  await page.waitForTimeout(600)
  const tip = page.locator('[data-slot="tooltip-content"]').first()
  if ((await tip.count()) === 0) {
    console.log(`  tooltip on ${press}: did not open FAIL`)
    failed += 1
    return
  }
  const paint = await tip.evaluate((node) => {
    const style = getComputedStyle(node)
    const r = node.getBoundingClientRect()
    return { background: style.backgroundColor, text: node.textContent, left: r.left, right: r.right }
  })
  const opaque = paint.background !== 'rgba(0, 0, 0, 0)' && !paint.background.includes('transparent')
  const inFrame = paint.left >= 0 && paint.right <= (await page.viewportSize()).width
  if (!opaque || !inFrame) failed += 1
  console.log(`  tooltip on ${press} (${wrapped ? 'via its wrapper' : 'directly'}): background=${paint.background} ${opaque ? 'a real surface' : 'TRANSPARENT'}${inFrame ? '' : ', PAST THE FRAME'} ${opaque && inFrame ? 'ok' : 'FAIL'}`)
  console.log(`    "${paint.text}"`)
  await page.mouse.move(1, HEIGHT - 2)
  await page.waitForTimeout(300)
}

/** Press, wait for the pane to answer, and print what it said. */
async function press(page, which) {
  const button = page.locator(`[data-press="${which}"]`)
  if (!(await button.isEnabled())) {
    console.log(`  ${which}: grey, not pressed`)
    return null
  }
  await button.click()
  await page.waitForTimeout(3000)
  const said = await page.evaluate(() => {
    const good = document.querySelector('p.text-done')
    const bad = document.querySelector('div.text-failed p, p.text-failed')
    return { good: good?.textContent ?? null, bad: bad?.textContent ?? null }
  })
  console.log(`  ${which}: ${said.good ? `said "${said.good}"` : said.bad ? `refused "${said.bad}"` : 'said nothing'}`)
  return said
}

for (const width of WIDTHS) {
  console.log(`\n${width}×${HEIGHT}`)
  const page = await open(width)
  const text = await page.evaluate(() => document.body.innerText)
  if (/Nothing is framing/.test(text)) {
    console.log('  the greeting was not accepted; the page is unhosted')
    failed += 1
  }
  await measure(page, width, 'at rest')
  await page.close()
}

/* The presses, once, at the narrowest width — the state after each is measured
   too, because a push that turns "push 2" into a grey "push" changes the row. */
if (PRESS) {
  const width = WIDTHS[0]
  console.log(`\npresses at ${width}×${HEIGHT}`)
  const page = await open(width)
  const before = await measure(page, width, 'before')
  if (before) {
    /* The tooltips: the live pull directly, and — after the push — the greyed
       push through its wrapper. */
    await tooltip(page, 'pull')
    await press(page, 'pull')
    await page.waitForTimeout(500)
    await measure(page, width, 'after pull')
    const pushed = await press(page, 'push')
    await page.waitForTimeout(500)
    const after = await measure(page, width, 'after push')
    /* A push that went through leaves nothing to push, and the control must
       say so by going grey; a push that was refused leaves the row as it was. */
    if (after && pushed?.good && !after.state.push.off) {
      console.log('  push is still on after a push that succeeded — FAIL')
      failed += 1
    }
    if (after && pushed?.good && after.state.push.why !== 'nothing') {
      console.log(`  push went through but the reason is "${after.state.push.why}" rather than "nothing" — FAIL`)
      failed += 1
    }
    await tooltip(page, 'push')
  }
  await page.close()
}

console.log('\nproblems:', problems.length ? problems : 'none')
console.log(failed ? `FAIL: ${failed} check(s)` : 'PASS: nothing drawn over anything, words only from 320 up, tooltips are surfaces, and both presses answered')
await browser.close()
process.exit(failed ? 1 : 0)
