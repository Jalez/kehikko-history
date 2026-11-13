import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import * as manifest from '../manifest.ts'

/* Modules do not name each other: text an agent or a person reads says what the other thing does.
   "Inbox" is a host term and may stay. */
const OTHERS = ['Journeys', 'References', 'Checklist', 'Paper', 'Slides', 'Citations', 'Notes', 'Learning', 'Source', 'Diff', 'Review', 'Explorer', 'Terminal', 'History', 'Orchestrator', 'Browser', 'Editor', 'Factory', 'Kanban', 'Monitor', 'Queue', 'Worktrees', 'Flows', 'Screenplay', 'Codex', 'Antigravity', 'OpenCode', 'Vibe'].filter((n) => n !== 'History')
const ROOT = join(import.meta.dir, '..')
const own = (t: string): string => t.replaceAll('Source Control', '')
const names = new RegExp(`\\b(${OTHERS.join('|')})\\b|kehikot\\.(${OTHERS.map((n) => n.toLowerCase()).join('|')})\\b|mcp__(${OTHERS.map((n) => n.toLowerCase()).join('|')})__`)
const ids = new RegExp(`kehikot\\.(${OTHERS.map((n) => n.toLowerCase()).join('|')})\\b`)

/* Lines where a capitalised everyday word is only a word, not a module. */
const PLAIN: string[] = []
const found = (text: string): string[] => text.split('\n').filter((line) => names.test(own(line)) && !PLAIN.some((one) => line.includes(one)))
const read = (path: string): string => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : '')

describe('no module names another', () => {
  test('the manifest, its help and what agents are told', () => {
    /* Everything the manifest module exports: the manifest itself, its help, what agents are told. */
    expect(found(JSON.stringify({ ...manifest }, null, 1))).toEqual([])
  })

  test('the skills', () => {
    const dir = join(ROOT, 'plugin', 'skills')
    const skills = existsSync(dir) ? readdirSync(dir).map((one) => read(`plugin/skills/${one}/SKILL.md`)) : []
    /* allowed-tools names tools, which is functional; the prose is what is read. */
    for (const text of skills) expect(found(text.split('\n').filter((line) => !line.startsWith('allowed-tools')).join('\n'))).toEqual([])
  })

  test('the descriptions an agent reads in the code', () => {
    for (const file of ["doors.ts","git/committer.ts"]) {
      let inBlock = false
      const lines = read(file).split('\n').filter((line) => {
        const was = inBlock
        if (!inBlock && /^\s*\/\*/.test(line)) inBlock = true
        if (inBlock && line.includes('*/')) inBlock = false
        return !was && !/^\s*(\/\*|\*|\/\/)/.test(line) && !/^\s*import /.test(line)
      })
      expect(lines.filter((line) => ids.test(line))).toEqual([])
    }
  })

  test('the code, its comments and the README name no other module, its id or its folder', () => {
    /* Another module's folder is a `.kehikot/<folder>` path; who owns a folder, and whether it is
       derived, is read from `module.folders`, never written here. */
    const folders = new RegExp(`\\.kehikot\\/(${OTHERS.map((n) => n.toLowerCase()).join('|')})\\b`)
    const SKIP = new Set(['node_modules', 'dist', 'test', 'notes', '.git', '.github'])
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((one) => {
      if (SKIP.has(one)) return []
      const at = join(dir, one)
      return statSync(at).isDirectory() ? walk(at) : /\.(ts|tsx|json|sh)$/.test(one) && one !== 'bun.lock' ? [at] : []
    })
    const hits: string[] = []
    for (const file of [...walk(ROOT), join(ROOT, 'README.md')]) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (names.test(own(line)) || folders.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })
})
