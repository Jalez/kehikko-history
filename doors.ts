import { existsSync } from 'node:fs'

import { ID, MANIFEST, VERSION } from './manifest.ts'

/** Re-exported so `vite.config.ts` has one import for everything it serves. */
export { MANIFEST }
import { commitNow, locate, look, read, standing, watching, type Standing } from './git/committer.ts'
import { saying, type Stance } from './git/enclosing.ts'
import { projectRepo, restore, show, stash, switchTo, type At, type Reading } from './git/repo.ts'
import { which as readWhich, type Which } from './git/names.ts'
import { spawnGit, type GitRunner } from './git/run.ts'

/**
 * Every door this app answers on that is not the page itself.
 *
 * A file of functions rather than a server, for the reason every module here
 * gives: a module is ONE ORIGIN or it is nothing. The page is Vite's, so the
 * manifest, the health check, the MCP door and this app's own `/api` are
 * middleware in front of the same server. `answer()` takes a method, a path, a
 * query and a body and hands back a status and a document; `vite.config.ts`
 * adapts a node request to it in a dozen lines.
 *
 * ## The rule this file exists to hold
 *
 * **Never run `git` with a string a request supplied.** The repository comes
 * from `projectPath` in the context, resolved and fenced in `git/repo.ts`;
 * branch names, commit names and paths are checked in `git/names.ts` before they
 * are put in an argument array; and `git/run.ts` spawns with an array,
 * `shell: false`, and an allowlist of subcommands. Every door below reads its
 * arguments through those, and none of them builds a command line.
 *
 * The thing that is easy to get wrong even with an array is a leading dash: an
 * argument beginning with `-` is an option, not a name, and no shell is involved
 * in that mistake. `names.ts` refuses one everywhere, and `--` separators are
 * passed wherever git accepts them.
 */

const MAX_PROJECT = 4096
const MAX_STRING = 4000

function str(value: unknown, max: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max)
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

function project(value: unknown): string | null {
  return str(value, MAX_PROJECT) || null
}

/**
 * What a caller is told when it did not say which project.
 *
 * Refused rather than defaulted, and every available default is wrong for the
 * same reason it is wrong in every other module here: `process.cwd()` is THIS
 * module's own directory; "the only project, if there is one" is correct until
 * there are two; and nothing at all is a program running `git init` in a folder
 * nobody chose. A refusal an agent can act on costs one round trip.
 */
const NO_PROJECT =
  'this needs project: the absolute path of the project folder whose history you mean, e.g. '
  + '"/Users/you/Projects/thing". There are two histories per project — the project’s own repository and its '
  + '.kehikot data folder — and neither of them exists without one. This module will not guess at which project '
  + 'was meant, because a guess here means running git in somebody’s repository they did not name.'

/** The ticket a write has to carry. Minted per process, printed into `/app`, dies with this process. */
export const TICKET = crypto.randomUUID()

const NO_TICKET =
  'that write did not carry this app’s ticket. The ticket is minted once per process and printed into the page this '
  + 'server serves, so a page from a previous run of this server has an old one — reload the pane. It is what '
  + 'separates this app’s own page from anything else on this machine that found the port.'

/* ------------------------------------------------------------------ *
 * Reading both histories
 * ------------------------------------------------------------------ */

export interface Both {
  ok: true
  /** Null when no project is open, which is an ordinary state and not a refusal. */
  nowhere: boolean
  trouble: string | null
  project: Reading | null
  kehikot: Reading | null
  /** How the committer for this project is standing, or null when nothing has started one. */
  standing: Standing | null
  /**
   * Where `.kehikot` stands as a repository of its own — read, never acted on.
   *
   * The page needs this before it draws anything, and it needs it from a GET,
   * because the alternative is what this module used to do: POST on mount and
   * find out by having already done it.
   */
  at: At
  /** What the repository around the project says about `.kehikot`, or null when no project is open. */
  stance: Stance | null
  /** The sentence for `at` and `stance` together, written once and read in two places. */
  said: string | null
  /** `<project>/.kehikot`, named so every sentence about it can carry the path. */
  path: string | null
}

/**
 * Both histories, and what the folder's situation is — all of it a read.
 *
 * Nothing here creates a directory, runs `git init`, or writes a file. That was
 * true of the two `read` calls before and was NOT true of the page that called
 * this, which POSTed a start alongside it on every mount. The situation now
 * comes back in the same answer, so the page has something to draw and nothing
 * to do.
 */
export async function histories(projectPath: string | null, git: GitRunner = spawnGit): Promise<Both> {
  const nothing = { ok: true, standing: null, at: 'waiting' as At, stance: null, said: null, path: null }
  const found = locate(projectPath)
  if (found.ok === null) {
    return { ...nothing, ok: true, nowhere: true, trouble: null, project: null, kehikot: null }
  }
  if (found.ok === false) {
    return { ...nothing, ok: true, nowhere: false, trouble: found.why, project: null, kehikot: null, at: 'refused' }
  }

  const root = projectRepo(found.where.project)
  const [own, data, seen] = await Promise.all([
    read(root, 'project', git),
    read(found.where.kehikot, 'kehikot', git),
    look(projectPath, git),
  ])
  return {
    ok: true,
    nowhere: false,
    trouble: null,
    project: own,
    kehikot: data,
    standing: standing(projectPath),
    at: seen.at,
    stance: seen.stance,
    said: seen.stance ? saying(seen.stance, found.where.kehikot) : seen.why,
    path: found.where.kehikot,
  }
}

/**
 * Which directory a call about one of the two repositories runs in.
 *
 * The project's repository root is walked upward from the project; the data
 * repository is the `.kehikot` folder itself and is never walked upward from —
 * `git` inside a `.kehikot` that is not yet a repository finds the PROJECT's
 * repository above it, and a "commit to the data" that landed in somebody's
 * thesis is the single worst thing this module could do.
 */
async function rootFor(
  projectPath: string | null,
  wanted: Which,
  git: GitRunner,
): Promise<{ ok: true; cwd: string } | { ok: false; why: string }> {
  const found = locate(projectPath)
  if (found.ok === null) return { ok: false, why: NO_PROJECT }
  if (found.ok === false) return { ok: false, why: found.why }

  if (wanted === 'kehikot') {
    if (!existsSync(`${found.where.kehikot}/.git`)) {
      /* Why it is not one is a question with four answers and this door has to
         give the right one — "start this history" is wrong advice for a folder
         somebody's own repository is already keeping. `look()` creates nothing,
         so asking it here costs three reads. */
      const seen = await look(projectPath, git)
      return {
        ok: false,
        why:
          `${found.where.kehikot} is not a repository of its own, so there is nothing there to act on. `
          + (seen.why ?? 'Start a history for it from the History pane if you want one.'),
      }
    }
    return { ok: true, cwd: found.where.kehikot }
  }

  const root = projectRepo(found.where.project)
  const top = await git(['rev-parse', '--show-toplevel'], { cwd: root })
  if (!top.ok) {
    return {
      ok: false,
      why: `${found.where.project} is not inside a git repository, so the project has no history of its own to act on.`,
    }
  }
  return { ok: true, cwd: top.out.trim() || root }
}

/* ------------------------------------------------------------------ *
 * The agent's door
 * ------------------------------------------------------------------ */

const PROJECT_PROPERTY = {
  project: {
    type: 'string',
    description:
      'The absolute path of the project folder whose history you mean, e.g. "/Users/you/Projects/thing". This is the '
      + 'same path the host shows for the open project. Every call needs it: there are two histories per project and '
      + 'neither exists without one.',
  },
} as const

const WHICH_PROPERTY = {
  which: {
    type: 'string',
    enum: ['project', 'kehikot'],
    description:
      'Which history. "project" is the project’s own git repository — the work. "kehikot" is the .kehikot folder '
      + 'where the Checklist, Notes, Learning and Journeys modules keep their data, which is a separate repository '
      + 'that this module made and commits to. They are not the same history and a change in one is invisible in the '
      + 'other.',
  },
} as const

/**
 * The four tools, and the two that are deliberately absent.
 *
 * ## What is not here: anything that moves HEAD
 *
 * There is no `checkout` tool and no `branch` tool. That is not an oversight and
 * it is the most considered omission in this module.
 *
 * Checking out a different branch changes every file in the working tree. An
 * agent doing that while another agent — or a person — is mid-edit in the same
 * project is a genuinely bad afternoon: files change underneath an editor that
 * has them open, a half-written change is either lost or committed to the wrong
 * branch, and the symptom arrives minutes later as something that makes no
 * sense. A tool description saying "be careful" does not prevent it; not having
 * the tool does.
 *
 * So moving HEAD stays a press a person makes on the page, where they can see
 * what is uncommitted before they make it, and where the module refuses outright
 * if anything is. An agent that wants a branch switched can say so to the person
 * whose afternoon it is.
 *
 * ## What IS here: recording, and reading
 *
 * `record` is the tool this module exists to offer an agent. An agent that has
 * just finished a piece of work knows what it did, in words, better than any
 * diff of the resulting JSON ever will — so it can commit with a message it
 * chose, instead of letting the automatic describer say "notes: 3 added".
 */
function tools() {
  return [
    {
      name: 'history',
      description:
        'One of the project’s two histories: its recent commits, its branches, where HEAD is, and anything not yet '
        + 'committed. Read this before assuming anything about the state of a repository — in particular before '
        + 'suggesting somebody move around in one, because uncommitted work is the thing that makes moving dangerous '
        + 'and it is listed here by name.',
      inputSchema: {
        type: 'object',
        properties: { ...PROJECT_PROPERTY, ...WHICH_PROPERTY },
        required: ['project', 'which'],
      },
    },
    {
      name: 'record',
      description:
        'Commit the .kehikot folder now — where the Checklist, Notes, Learning and Journeys modules keep this '
        + 'project’s material — under a message you choose. Use this when you have just finished a piece of work in '
        + 'that data, because you know what you did and the automatic message only knows what the JSON looks like '
        + 'now. Commits happen by themselves a few seconds after any change, so nothing is lost if you do not call '
        + 'this; what you get by calling it is a line in the log saying what the work WAS. It commits ONLY to a '
        + 'repository inside that folder, and it will never start one: if the project’s own repository is the one '
        + 'keeping that folder, this refuses and says so, because a commit into somebody’s own history is a press '
        + 'they make on the pane rather than something a tool does in their name.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          message: {
            type: 'string',
            description:
              'What you did, as a commit message. One line is usually right. Write it for somebody who has lost '
              + 'something and is scanning a log to find the commit from before they lost it.',
          },
        },
        required: ['project', 'message'],
      },
    },
    {
      name: 'show_commit',
      description:
        'One commit in full: its message, its author, and which files it touched. Use it to find out what a commit in '
        + 'the list actually contains before suggesting anybody restore from it.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          ...WHICH_PROPERTY,
          commit: { type: 'string', description: 'The object name as `history` printed it, or "HEAD".' },
        },
        required: ['project', 'which', 'commit'],
      },
    },
    {
      name: 'restore_file',
      description:
        'Bring one file back as it was at an older commit. It lands as an uncommitted change in the working tree — '
        + 'nothing is committed and nothing else is touched — so it can be looked at before it is kept. It is refused '
        + 'if that file has uncommitted changes, because writing over those would destroy work git has no copy of; '
        + 'the refusal says so, and `overwrite` is how you say you meant it.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PROJECT_PROPERTY,
          ...WHICH_PROPERTY,
          commit: { type: 'string', description: 'The commit to take the file from, as `history` printed it.' },
          path: { type: 'string', description: 'The path of the file, relative to the root of that repository.' },
          overwrite: {
            type: 'boolean',
            description:
              'Go ahead even though that file has uncommitted changes, which will be destroyed. Leave it out the '
              + 'first time: the refusal tells you what would be lost, and that is the sentence to act on.',
          },
        },
        required: ['project', 'which', 'commit', 'path'],
      },
    },
  ]
}

/** One reading as text an agent can act on. */
function readingText(reading: Reading): string {
  if (!reading.present) return reading.absent ?? 'There is no repository there.'
  const lines: string[] = []
  lines.push(`${reading.which === 'project' ? 'The project’s own repository' : 'The .kehikot data repository'} at ${reading.root}`)
  lines.push(
    reading.head.detached
      ? `HEAD is detached at ${reading.head.sha?.slice(0, 8) ?? '?'} — it is not on a branch.`
      : reading.head.branch
        ? `On branch ${reading.head.branch}${reading.head.sha ? ` at ${reading.head.sha.slice(0, 8)}` : ''}.`
        : 'No commits yet.',
  )
  if (reading.dirty.length) {
    lines.push('', `Not committed (${reading.dirty.length}):`)
    for (const entry of reading.dirty.slice(0, 40)) lines.push(`  ${entry.code} ${entry.path}`)
    if (reading.dirty.length > 40) lines.push(`  …and ${reading.dirty.length - 40} more`)
  } else {
    lines.push('Nothing uncommitted.')
  }
  if (reading.branches.length) {
    lines.push('', `Branches: ${reading.branches.map((b) => (b.current ? `${b.name} (here)` : b.name)).join(', ')}`)
  }
  if (reading.commits.length) {
    lines.push('', 'Commits, newest first:')
    for (const one of reading.commits) lines.push(`  ${one.short}  ${one.at.slice(0, 16).replace('T', ' ')}  ${one.who}  ${one.subject}`)
  }
  if (reading.trouble) lines.push('', `git said: ${reading.trouble}`)
  return lines.join('\n')
}

export interface Reply {
  status: number
  body: unknown
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

async function mcp(rpc: Rpc, git: GitRunner): Promise<Reply> {
  const reply = (result: unknown) => ok({ jsonrpc: '2.0', id: rpc.id ?? null, result })
  const text = (s: string, isError = false) =>
    reply({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) })

  if (rpc.method === 'initialize') {
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: ID, version: VERSION },
      instructions:
        'Two histories per project, kept apart. The project’s own git repository holds the work. The .kehikot folder '
        + 'where four modules keep their data MAY be a separate repository — it is one when the project ignores that '
        + 'folder or has no repository at all, and it is deliberately not one when the project’s own repository '
        + 'already tracks it, because two repositories over the same files is a state git only half tolerates. This '
        + 'module never starts one without a person pressing for it, and never commits into a repository it did not '
        + 'make without a person pressing for that either. Where it does commit, commits are automatic and debounced; '
        + '`record` is how you make one deliberately, with a message you chose. Nothing here moves HEAD: switching '
        + 'branches under a running agent is a bad afternoon, so it stays a press a person makes.',
    })
  }
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) {
    return { status: 202, body: null }
  }
  if (rpc.method === 'tools/list') return reply({ tools: tools() })

  if (rpc.method === 'tools/call') {
    const name = String(rpc.params?.name ?? '')
    const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>

    try {
      const where = project(args.project)
      if (!where) return text(NO_PROJECT, true)

      if (name === 'record') {
        const said = await commitNow(where, str(args.message, MAX_STRING) || null, git)
        return text(said.said, !said.ok)
      }

      if (name === 'history' || name === 'show_commit' || name === 'restore_file') {
        const wanted = readWhich(args.which)
        if (!wanted.ok) return text(wanted.why, true)

        if (name === 'history') {
          const both = await histories(where, git)
          if (both.trouble) return text(both.trouble, true)
          if (both.nowhere) return text(NO_PROJECT, true)
          const reading = wanted.value === 'project' ? both.project : both.kehikot
          return text(reading ? readingText(reading) : 'There is no repository there.', !reading?.present)
        }

        const root = await rootFor(where, wanted.value, git)
        if (!root.ok) return text(root.why, true)

        if (name === 'show_commit') {
          const said = await show(root.cwd, args.commit, git)
          return text(said.said, !said.ok)
        }

        const done = await restore(root.cwd, args.commit, args.path, args.overwrite === true, git)
        return text(
          done.wouldLose.length ? `${done.said}\n\nWhat would be lost: ${done.wouldLose.join(', ')}` : done.said,
          !done.ok,
        )
      }
    } catch (e) {
      /* A refusal is an answer, and the sentence is the useful half. It comes
         back as a tool error the agent reads rather than as a transport failure
         it retries. */
      return text(e instanceof Error ? e.message : String(e), true)
    }
    const shown = name.length > 60 ? `${name.slice(0, 60)}…` : name
    return text(
      `no tool "${shown}" here. This module offers history, record, show_commit and restore_file — and deliberately `
        + 'nothing that moves HEAD.',
      true,
    )
  }

  return {
    status: 404,
    body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } },
  }
}

/* ------------------------------------------------------------------ *
 * Every door, as one function
 * ------------------------------------------------------------------ */

export async function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
  git: GitRunner = spawnGit,
): Promise<Reply | null> {
  /*
   * The health check answers about the PROGRAM and counts nothing.
   *
   * A number here would have to be a number for SOME project — one this door was
   * not told about and would have to pick. Whether a particular project's
   * histories are readable is a question `/api/histories?project=…` answers
   * honestly, with the path in the sentence.
   */
  if (path === '/healthz') return ok({ ok: true, id: ID, version: VERSION })

  if (path === '/mcp') {
    if (method !== 'POST') return bad('the MCP door takes POST', 405)
    if (!body || typeof body.method !== 'string') {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    }
    return mcp(body as Rpc, git)
  }

  if (path === '/api/histories' && method === 'GET') {
    return ok(await histories(project(query.get('project')), git))
  }

  /* Everything below writes, and every write carries the ticket. */
  if (path.startsWith('/api/') && method === 'POST') {
    if (ticket !== TICKET) return bad(NO_TICKET, 403)
    const where = project(body?.project)
    if (!where) return bad(NO_PROJECT)

    /*
     * Start watching this project's data folder, and — only when `asked` is
     * exactly `true` — make it a repository if it is not one and may be one.
     *
     * `asked` arrives in the body and is compared to `true` rather than read as
     * truthy, so a body that forgot the field, or carried a string, is a body
     * that does not initialise anything. It is the difference between the page
     * resuming commits to a repository somebody already started and the page
     * starting one, and those two must not be one request that guesses which.
     */
    if (path === '/api/watch') {
      const started = await watching(where, git, body?.asked === true)
      return ok({
        ok: started.ok,
        why: started.why,
        standing: started.standing,
        created: started.created,
        at: started.at,
      })
    }

    /*
     * `press: true`, unconditionally, because this door is only reachable from
     * this app's own page carrying this process's ticket. It is what lets a
     * commit go into the repository the project is already in — see `commitNow`.
     */
    if (path === '/api/commit') {
      const said = await commitNow(where, str(body?.message, MAX_STRING) || null, git, true)
      return ok(said.ok ? { ok: true, said: said.said, sha: said.sha } : { ok: false, error: said.said })
    }

    const wanted = readWhich(body?.which)
    if (!wanted.ok) return bad(wanted.why)
    const root = await rootFor(where, wanted.value, git)
    if (!root.ok) return bad(root.why)

    if (path === '/api/switch') {
      const moved = await switchTo(root.cwd, { branch: body?.branch, commit: body?.commit, create: body?.create === true }, git)
      return ok(moved.ok ? { ok: true, said: moved.said } : { ok: false, error: moved.said, wouldLose: moved.wouldLose })
    }

    if (path === '/api/restore') {
      const done = await restore(root.cwd, body?.commit, body?.path, body?.overwrite === true, git)
      return ok(done.ok ? { ok: true, said: done.said } : { ok: false, error: done.said, wouldLose: done.wouldLose })
    }

    if (path === '/api/stash') {
      const done = await stash(root.cwd, git)
      return ok(done.ok ? { ok: true, said: done.said } : { ok: false, error: done.said })
    }

    if (path === '/api/show') {
      const said = await show(root.cwd, body?.commit, git)
      return ok(said.ok ? { ok: true, said: said.said } : { ok: false, error: said.said })
    }
  }

  return null
}
