import { describe, expect, test } from 'bun:test'

import { branchName, commitish, message, repoPath, which } from '../git/names.ts'
import { PREFIX, vetted } from '../git/run.ts'

/**
 * The refusals, which are the whole security story of this module.
 *
 * `spawn` with an array and `shell: false` removes one class of attack and not
 * the other. The one it does not remove is the reason for nearly every test
 * below: **an argument beginning with a dash is an option, not a name**, and no
 * shell is involved in that mistake. So a leading `-` is asserted refused in
 * every position a string can arrive in.
 */

describe('a leading dash is refused everywhere, because it is an option and not a name', () => {
  test('a branch', () => {
    const refused = branchName('--upload-pack=/tmp/evil')
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.why).toContain('option')
  })

  test('a path', () => {
    expect(repoPath('--output=/Users/somebody/.zshrc').ok).toBe(false)
  })

  test('a commit message', () => {
    const refused = message('-m something')
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.why).toContain('Put a word in front')
  })

  test('a commit name', () => {
    expect(commitish('-C/tmp').ok).toBe(false)
  })
})

describe('branch names', () => {
  test('the ordinary ones are accepted', () => {
    for (const name of ['main', 'feature/x', 'release-1.2.3', 'a_b+c', 'v2']) {
      expect(branchName(name)).toEqual({ ok: true, value: name })
    }
  })

  test('the ones git itself refuses are refused, each by its own rule', () => {
    for (const name of ['a..b', 'a//b', 'a/', 'a.', 'a.lock', '@', '.hidden', 'a/.b', 'has space', 'semi;colon', 'back\\slash']) {
      expect(branchName(name).ok).toBe(false)
    }
  })

  test('a shell metacharacter is refused as a NAME rather than becoming a command', () => {
    /* It could not become a command anyway — nothing here reaches a shell. It is
       refused because it is not a branch name, which is the honest reason. */
    expect(branchName('main; rm -rf /').ok).toBe(false)
    expect(branchName('$(whoami)').ok).toBe(false)
    expect(branchName('`id`').ok).toBe(false)
  })

  test('a name too long is refused with its length in the sentence', () => {
    const refused = branchName('a'.repeat(500))
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.why).toContain('500')
  })

  test('anything that is not text is refused rather than coerced', () => {
    for (const value of [null, undefined, 42, {}, ['main']]) expect(branchName(value).ok).toBe(false)
  })
})

describe('commit names', () => {
  test('object names and HEAD are accepted', () => {
    expect(commitish('a1b2c3d').ok).toBe(true)
    expect(commitish('0'.repeat(40)).ok).toBe(true)
    expect(commitish('HEAD').ok).toBe(true)
  })

  test('revision expressions are deliberately not accepted', () => {
    for (const value of ['HEAD~3', 'main@{yesterday}', 'abc^{tree}', 'HEAD^']) {
      const refused = commitish(value)
      expect(refused.ok).toBe(false)
      expect(refused.ok === false && refused.why).toContain('object name')
    }
  })
})

describe('paths inside a repository', () => {
  test('an ordinary relative path is accepted', () => {
    expect(repoPath('notes/notes.json')).toEqual({ ok: true, value: 'notes/notes.json' })
  })

  test('a path that climbs out is refused', () => {
    expect(repoPath('../../etc/passwd').ok).toBe(false)
    expect(repoPath('notes/../../../etc/passwd').ok).toBe(false)
  })

  test('an absolute path is refused, with what to type instead', () => {
    const refused = repoPath('/etc/passwd')
    expect(refused.ok).toBe(false)
    expect(refused.ok === false && refused.why).toContain('relative to its root')
  })

  test('a file genuinely called ..config is allowed — the rule is about components', () => {
    expect(repoPath('notes/..config').ok).toBe(true)
  })
})

describe('commit messages', () => {
  test('prose goes through unchanged except for carriage returns', () => {
    expect(message('notes: 2 added\r\n\r\nand a body')).toEqual({ ok: true, value: 'notes: 2 added\n\nand a body' })
  })

  test('an empty message is refused rather than becoming an empty subject', () => {
    expect(message('   ').ok).toBe(false)
    expect(message('').ok).toBe(false)
  })

  test('a NUL is refused rather than truncated', () => {
    expect(message('a\0b').ok).toBe(false)
  })
})

describe('which history', () => {
  test('two words, and nothing else is one', () => {
    expect(which('project')).toEqual({ ok: true, value: 'project' })
    expect(which('kehikot')).toEqual({ ok: true, value: 'kehikot' })
    for (const value of ['Project', 'kehikko', '', null, undefined, 1]) expect(which(value).ok).toBe(false)
  })

  test('the refusal says why a default would be dangerous', () => {
    const refused = which('')
    expect(refused.ok === false && refused.why).toContain('commits their notes to their thesis')
  })
})

describe('the subcommand allowlist, which is the guard rather than a formality', () => {
  test('what this module runs is allowed', () => {
    for (const args of [['status', '--porcelain'], ['log', '--max-count=40'], ['commit', '-m', 'x'], ['add', '-A', '--', '.']]) {
      expect(vetted(args).ok).toBe(true)
    }
  })

  test('nothing that reaches a remote is allowed', () => {
    for (const name of ['push', 'fetch', 'pull', 'clone', 'remote', 'submodule']) {
      const refused = vetted([name])
      expect(refused.ok).toBe(false)
      expect(refused.ok === false && refused.why).toContain('no push')
    }
  })

  test('nothing that rewrites or discards is allowed', () => {
    for (const name of ['reset', 'clean', 'rebase', 'filter-branch', 'gc', 'reflog']) {
      expect(vetted([name]).ok).toBe(false)
    }
  })

  test('--amend is refused even though commit is allowed, because they are different acts', () => {
    expect(vetted(['commit', '--amend', '-m', 'x']).ok).toBe(false)
  })

  test('--force and --hard are refused wherever they appear', () => {
    expect(vetted(['checkout', '--force', 'main']).ok).toBe(false)
    expect(vetted(['checkout', '-f', 'main']).ok).toBe(false)
    expect(vetted(['restore', '--hard']).ok).toBe(false)
  })

  test('stash -f is the one exception, and it is named rather than special-cased inline', () => {
    expect(vetted(['stash', 'push', '-f']).ok).toBe(true)
  })

  test('a NUL in any argument stops the whole call', () => {
    expect(vetted(['log', 'a\0b']).ok).toBe(false)
  })

  test('a call with no subcommand is refused rather than run', () => {
    expect(vetted(['--version']).ok).toBe(false)
    expect(vetted([]).ok).toBe(false)
  })

  test('the prefix turns hooks off and asks for no pager', () => {
    expect(PREFIX).toEqual(['--no-pager', '-c', 'core.hooksPath='])
  })
})
