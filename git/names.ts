/**
 * Every string that reaches a `git` argument, and the rules it has to pass
 * first.
 *
 * ## Why this file exists when `spawn` already takes an array
 *
 * `shell: false` and an argument array remove one whole class of attack: nothing
 * a caller writes can become a second command. It is the necessary half and it
 * is not the sufficient half, and the reason is short enough to say in one
 * sentence: **an argument that begins with a dash is not an argument, it is an
 * option.**
 *
 * `git log --format=...` is fine. `git log <branch>` where the caller supplies
 * `--output=/Users/somebody/.zshrc` is `git` being asked to write a file. There
 * is no shell involved, no quoting to get wrong, and no interpolation anywhere —
 * the array is perfectly formed and the program does something nobody asked for.
 * So every value that arrives from a request is checked to be the kind of name
 * it claims to be, a leading `-` is refused everywhere without exception, and
 * `--` separators are used wherever git accepts one.
 *
 * ## Why the refusals are sentences
 *
 * Because they are read. The commonest reason one of these fires is somebody
 * typing a branch name with a space in it, not somebody attacking anything, and
 * "that is not a branch name" tells them nothing. Each one below says what the
 * rule is and, where there is one, what to type instead.
 */

/**
 * The longest a name may be.
 *
 * 200 is comfortably longer than any branch anybody works on and far short of
 * what a filesystem or a command line would refuse — the point of the bound is
 * that a string has a length before it has a meaning, not that 201 characters
 * would break something.
 */
export const MAX_NAME = 200

/** How long a commit message may be. Long enough for a paragraph, bounded because it arrives on a request. */
export const MAX_MESSAGE = 4000

/** How long a path inside a repository may be. */
export const MAX_PATH = 1024

export type Checked = { ok: true; value: string } | { ok: false; why: string }

const bad = (why: string): Checked => ({ ok: false, why })

/**
 * The rule every one of these shares, applied first and separately so its
 * refusal can say the one thing that is actually surprising.
 */
function notAnOption(value: string, what: string): Checked | null {
  if (value.startsWith('-')) {
    return bad(
      `A ${what} may not start with "-". That is not a style rule: an argument beginning with a dash is read by git `
        + 'as an option rather than as a name, so this module refuses one everywhere rather than hoping each call site '
        + 'remembered a "--".',
    )
  }
  return null
}

/**
 * A branch name.
 *
 * git's own rules (`git check-ref-format`) are more permissive than this and
 * this is deliberate. What is accepted here is the set of names a person
 * actually types plus the separators teams actually use: letters, digits, dot,
 * underscore, slash, plus, dash. Everything git allows beyond that — spaces are
 * not allowed by git either, but `{`, `}`, `%`, `!`, unicode, and so on are —
 * is refused, because this module has no need of them and a narrower rule is one
 * with fewer edges to be wrong about.
 *
 * The specific refusals below are git's own and are checked explicitly, so that
 * a name failing one of them is told which: git refuses `..`, a trailing
 * `.lock`, a leading or trailing slash, a doubled slash, a component beginning
 * with a dot, a trailing dot, and the bare `@`.
 */
export function branchName(raw: unknown): Checked {
  if (typeof raw !== 'string') return bad('A branch name has to be text.')
  const value = raw.trim()
  if (!value) return bad('That is an empty branch name. Type the name of the branch.')
  if (value.length > MAX_NAME) return bad(`A branch name here is at most ${MAX_NAME} characters; that one is ${value.length}.`)
  const option = notAnOption(value, 'branch name')
  if (option) return option
  if (!/^[A-Za-z0-9][A-Za-z0-9._/+-]*$/.test(value)) {
    return bad(
      'A branch name here may contain letters, digits, dots, dashes, underscores, plus signs and slashes, and has to '
        + 'start with a letter or a digit. Spaces are the usual culprit — git does not allow them either; a dash or a '
        + 'slash is what people mean by one.',
    )
  }
  if (value.includes('..')) return bad('A branch name may not contain "..", which git reads as a range rather than as a name.')
  if (value.includes('//')) return bad('A branch name may not contain "//".')
  if (value.endsWith('/') || value.endsWith('.')) return bad('A branch name may not end with "/" or ".".')
  if (value.endsWith('.lock')) return bad('A branch name may not end with ".lock" — git uses that suffix for its own files.')
  if (value.split('/').some((part) => part === '' || part.startsWith('.'))) {
    return bad('No part of a branch name may be empty or begin with a dot.')
  }
  if (value === '@') return bad('"@" on its own is git\'s shorthand for HEAD rather than a branch name.')
  return { ok: true, value }
}

/**
 * A commit, as a caller may name one.
 *
 * A full or abbreviated object name, or `HEAD`, or a branch. Deliberately NOT
 * the whole of git's revision grammar: `HEAD~3`, `main@{yesterday}` and
 * `abc^{tree}` are all things git understands and all things this module has no
 * screen for. What the page sends is an object name it read out of `git log`
 * moments earlier, so the narrow rule costs nothing and means the set of things
 * that can reach a `git show` is the set of things that came out of a `git log`.
 */
export function commitish(raw: unknown): Checked {
  if (typeof raw !== 'string') return bad('A commit has to be named as text.')
  const value = raw.trim()
  if (!value) return bad('That is an empty commit name.')
  if (value === 'HEAD') return { ok: true, value }
  if (/^[0-9a-f]{7,40}$/.test(value)) return { ok: true, value }
  const branch = branchName(value)
  if (branch.ok) return branch
  return bad(
    'That is not a commit this module will look up. Give an object name as `git log` prints it — seven to forty hex '
      + 'characters — or "HEAD", or a branch name. Revision expressions like "HEAD~3" or "main@{yesterday}" are '
      + 'deliberately not accepted: everything this page shows came out of a log, so an object name is always '
      + 'available and is never ambiguous.',
  )
}

/**
 * A path inside a repository, as a caller may name one.
 *
 * Relative, POSIX, and with no way out of the repository it will be joined onto.
 * `..` is refused as a component rather than anywhere in the string, so a file
 * genuinely called `..config` is allowed; a leading `/` is refused because an
 * absolute path handed to `git restore` is a path outside the repository.
 *
 * The check here is about the SPELLING. Whether the path is one this repository
 * actually has is a question git answers, and it answers it better than a
 * pre-check would.
 */
export function repoPath(raw: unknown): Checked {
  if (typeof raw !== 'string') return bad('A file name has to be text.')
  const value = raw.trim()
  if (!value) return bad('That is an empty file name.')
  if (value.length > MAX_PATH) return bad(`A path here is at most ${MAX_PATH} characters; that one is ${value.length}.`)
  const option = notAnOption(value, 'path')
  if (option) return option
  if (value.startsWith('/')) {
    return bad('Give the path as it appears in the repository — relative to its root — rather than as an absolute path.')
  }
  if (value.includes('\0')) return bad('A path may not contain a NUL byte.')
  if (value.split('/').some((part) => part === '..')) {
    return bad('A path may not climb out of the repository with "..".')
  }
  return { ok: true, value }
}

/**
 * A commit message somebody wrote.
 *
 * The most permissive thing here, and it should be: it is prose, it goes into
 * the repository verbatim, and narrowing it would be this module editing
 * somebody's sentence. Three things are done to it and each is a fact about
 * commit messages rather than a preference:
 *
 * - **A leading `-` is refused.** `git commit -m` takes the message as the next
 *   argument, so a message beginning with a dash is a message git reads as an
 *   option. The refusal says to put a word in front, which is what a person does
 *   anyway.
 * - **Carriage returns are dropped and NUL is refused.** A `\r\n` in a commit
 *   message shows up as a stray character in every log for the life of the
 *   repository, and a NUL cannot be passed to a process at all.
 * - **It is trimmed and bounded.** An empty message is refused rather than
 *   becoming an empty commit subject, because a log line with nothing on it is
 *   a commit nobody can find again.
 */
export function message(raw: unknown): Checked {
  if (typeof raw !== 'string') return bad('A commit message has to be text.')
  const value = raw.replace(/\r/g, '').trim()
  if (!value) {
    return bad('A commit needs a message. An empty one is a line in the log with nothing on it, which is a commit nobody finds again.')
  }
  if (value.length > MAX_MESSAGE) {
    return bad(`A commit message here is at most ${MAX_MESSAGE} characters; that one is ${value.length}.`)
  }
  if (value.includes('\0')) return bad('A commit message may not contain a NUL byte.')
  const option = notAnOption(value, 'commit message')
  if (option) {
    return bad(
      'A commit message may not start with "-": git reads the next thing after -m as the message, and a leading dash '
        + 'makes it read an option instead. Put a word in front of it.',
    )
  }
  return { ok: true, value }
}

/** Which of the two repositories a call is about. Two words, and nothing else is one. */
export type Which = 'project' | 'kehikot'

export function which(raw: unknown): { ok: true; value: Which } | { ok: false; why: string } {
  if (raw === 'project' || raw === 'kehikot') return { ok: true, value: raw }
  return {
    ok: false,
    why:
      'Say which history: "project" for the project’s own repository, or "kehikot" for the .kehikot folder the '
      + 'modules keep their data in. They are two separate repositories and a call that did not say which would have '
      + 'to guess, which is how somebody commits their notes to their thesis.',
  }
}
