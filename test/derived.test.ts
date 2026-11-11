import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { stageAll, staged } from '../git/repo.ts'
import { spawnGit } from '../git/run.ts'

/* A folder its owner declares derived (`module.folders`) is left out of what is staged; any name, never spelled in the code. */
const dir = mkdtempSync(join(tmpdir(), 'kehikko-history-derived-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('stageAll', () => {
  test('leaves out the folders declared derived, and only those', async () => {
    expect((await spawnGit(['init', '-q', '--initial-branch=main'], { cwd: dir })).ok).toBe(true)
    for (const folder of ['authored', 'rebuilt']) {
      mkdirSync(join(dir, folder), { recursive: true })
      writeFileSync(join(dir, folder, 'data.json'), '{}\n')
    }
    expect((await stageAll(dir, spawnGit, ['rebuilt', '../escape', ':(top)x'])).ok).toBe(true)
    expect((await staged(dir, spawnGit)).map((one) => one.path)).toEqual(['authored/data.json'])
  })
})
