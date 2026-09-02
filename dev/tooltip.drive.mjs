/*
 * Open a tooltip and check it is actually a surface, then take the pointer out
 * of the page and check it shuts.
 *
 *     CHROME=<path to chromium> node dev/tooltip.drive.mjs [page url]
 *
 * ## Why a driver and not a test
 *
 * Both failures here are invisible to the DOM harness, and for the same reason:
 * they are properties of the RENDERED page rather than of the markup.
 *
 * `bg-popover` on a theme with no `--popover` colour emits
 * `background-color: var(--popover)`, which the browser discards. The class is
 * present, the element is present, every assertion about markup passes — and
 * the box is transparent, with its words drawn over whatever is beneath. Only
 * `getComputedStyle` in a real browser can tell the difference between a
 * background that is set and one that was thrown away.
 *
 * And a tooltip left open when the pointer leaves the frame cannot be produced
 * by `fireEvent` at all: the bug IS the absence of an event.
 */
const { chromium } = await import(process.env.PLAYWRIGHT ?? '/tmp/height-drive/node_modules/playwright-core/index.mjs')

const PAGE = process.argv[2] ?? 'http://127.0.0.1:7960/app'
const PROJECT = process.env.PROJECT ?? '/Users/jaakkorajala/Projects/kehikko-history'

const browser = await chromium.launch({ executablePath: process.env.CHROME })
const page = await browser.newPage({ viewport: { width: 320, height: 340 } })
const problems = []
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))

await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
/* The page waits to be told which project is open, the way `small.drive.mjs`
   does it: one `roadmap.hello` posted into its own window. */
await page.evaluate((projectPath) => {
  window.postMessage(
    {
      type: 'roadmap.hello',
      protocol: 2,
      session: 'tooltip-drive',
      context: { projectPath, project: 'scratch', theme: 'light' },
      state: null,
    },
    '*',
  )
}, PROJECT)
await page.waitForTimeout(2500)

const open = page.getByRole('button', { name: 'Open' }).first()
if ((await open.count()) === 0) {
  console.log('no commit rows on this page — point this at a project with a history')
  await browser.close()
  process.exit(2)
}

await open.hover()
await page.waitForTimeout(700)

const tip = page.locator('[data-slot="tooltip-content"]').first()
const there = (await tip.count()) > 0
console.log('tooltip opened on hover:', there)

let opaque = false
if (there) {
  const paint = await tip.evaluate((node) => {
    const style = getComputedStyle(node)
    return { background: style.backgroundColor, colour: style.color }
  })
  console.log('  background-color:', paint.background)
  console.log('  color:           ', paint.colour)
  /* The failure looked exactly like this: rgba(0, 0, 0, 0) — a declaration the
     browser threw away, not a colour anybody chose. */
  opaque = paint.background !== 'rgba(0, 0, 0, 0)' && !paint.background.includes('transparent')
  console.log('  a real surface:  ', opaque)
}

/* Out of the page entirely. `mouse.move` to a negative coordinate does not
   leave the viewport, so dispatch the events the browser sends when the pointer
   genuinely goes elsewhere. */
await page.evaluate(() => {
  document.documentElement.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
  window.dispatchEvent(new Event('blur'))
})
await page.waitForTimeout(500)
const stillThere = (await page.locator('[data-slot="tooltip-content"]').count()) > 0
console.log('tooltip still open after the pointer left:', stillThere)

console.log('')
console.log('page errors:', problems.length ? problems : 'none')
const verdict = there && opaque && !stillThere
console.log(verdict ? 'PASS: it is a surface, and it shuts when the pointer goes' : 'FAIL')
await browser.close()
process.exit(verdict ? 0 : 1)
