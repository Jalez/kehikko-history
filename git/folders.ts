import { MODULE_FOLDERS, foldersOwned } from 'kehikot-module-protocol'
import { askHost } from 'kehikot-module-protocol/serve'

/**
 * The folders under `.kehikot/` that their owners declare DERIVED (`module.folders`, protocol
 * 2.85.0): a cache rebuilt from elsewhere, which a data history leaves out. Found through the host,
 * never written here — this module keeps no list of anybody's folders.
 *
 * This is on top of git, not instead of it: a module that keeps a rebuilt cache can also say so in
 * its own `.gitignore`, which `git add` honours as it always did (see `stageAll`). A folder declared
 * derived is left out even when it has no such file. With no answer (no host, an older host, nobody
 * declaring) nothing extra is left out and the `.gitignore` rule alone holds.
 *
 * Asked at most once every `FRESH_MS`, never throws.
 */
const FRESH_MS = 30_000
const ASK_MS = 2_000

let known: string[] = []
let askedAt = 0
let asking: Promise<void> | null = null

/** The derived folders as last found. */
export function knownDerived(): readonly string[] {
  return known
}

/** For tests: say what was found, and keep the host from being asked again for `freshFor` ms. */
export function setKnownDerived(folders: string[], freshFor = FRESH_MS): void {
  known = [...folders]
  askedAt = Date.now() - FRESH_MS + freshFor
}

/** Ask the host which folders are derived, when the last answer is stale. Never throws. */
export async function lookForDerived(module: string): Promise<void> {
  if (Date.now() - askedAt < FRESH_MS) return
  if (asking) return asking
  asking = (async () => {
    try {
      const asked = await askHost('services.find', { service: MODULE_FOLDERS }, { module, timeoutMs: ASK_MS })
      known = asked.ok ? [...foldersOwned(asked.data.providers)].filter(([, owner]) => owner.derived).map(([folder]) => folder) : []
    } catch {
      known = []
    } finally {
      askedAt = Date.now()
      asking = null
    }
  })()
  return asking
}
