import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.history'
export const VERSION = '1.0.0'

/**
 * The port this app would rather have, said once and beside the name it belongs
 * to.
 *
 * It used to be written twice — `--port "${PORT:-7960}"` in `run.sh` and
 * `Number(process.env.PORT ?? 7960)` in `register.ts` — with nothing keeping the
 * two in step and a third copy of the number sitting in `~/.roadmap/modules`
 * from the last time somebody ran the second. Moving a module was two edits and
 * a thing to remember.
 *
 * It lives HERE rather than in `vite.config.ts` because `register.ts` needs it
 * too, and importing a Vite config to read one number would mean building the
 * whole plugin list and minting this process's write ticket to find out what
 * port to write down.
 *
 * It is a PREFERENCE and not a promise. 7820 through 7950 belong to the other
 * modules on this machine, and if something else has 7960 when this starts,
 * `serves()` moves to the next free port and rewrites the registration to match
 * — see `roadmap-module-protocol/serve`. The registry is what a host reads, so
 * the registry is what has to be true; this number is only where to start
 * looking.
 */
export const PREFERRED_PORT = 7960

/**
 * What this app says about itself when a host asks.
 *
 * ## What this module is for, in one paragraph
 *
 * Four modules now keep their data in `<projectPath>/.kehikot/<module>/`, and
 * that folder is gitignored by the project it sits in — deliberately, because it
 * is one person's working material and not the project's. The consequence was
 * noticed by the person it happened to:
 *
 * > "The problem with .kehikot being .gitignored is that it then doesn't have
 * > history control provided by the host project which I kind of wanted to have.
 * > Should the .kehikot folder itself have its own git history so that we get
 * > the history control we want that works for all the data? Then the History
 * > module could let you control both the project's history and kehikot history
 * > separately."
 *
 * So: `.kehikot` is its own git repository, this module is the one thing
 * responsible for initialising it and the only thing that commits to it, and the
 * pane shows both histories side by side. See the README for the nesting
 * property that makes it safe — `git clean -xdf` in the parent SKIPS a nested
 * repository — and for the one flag that does not.
 *
 * ## `scope: 'global'`, and the argument for it
 *
 * Every other module in this workspace declares `scope: 'epic'`, so this is the
 * odd one and it should say why rather than look like a typo.
 *
 * An epic-scoped mode gets a tab that FOLLOWS THE READER: the host tells it
 * which epic is open and tells it again on every switch. That is exactly right
 * for a checklist held against a paper, or questions anchored to a passage —
 * their subject moves when the reader moves.
 *
 * A history's subject does not. There is one `.kehikot` repository per project
 * and one project repository per project, and neither of them changes because
 * somebody clicked a different epic. A tab that re-pointed itself on every epic
 * switch would be re-pointing at the same two repositories, which is a promise
 * of relevance this module cannot keep — and a reader who saw the tab move would
 * reasonably conclude the commits below it had moved too. They have not.
 *
 * The thing this module DOES follow is the project, and `projectPath` arrives in
 * `roadmap.context` for a global mode exactly as it does for an epic one. So
 * nothing is lost by declining the epic: switching project still repaints, which
 * is the only switch that means anything here.
 *
 * ## What it declares
 *
 * - **`storage: true`, and no `server.cors`.** This module owns data —
 *   the `.kehikot` repository is data it creates and writes — and it takes
 *   writes on its own `/api`, gated on a per-process ticket printed into the
 *   page. A host frames a module WITHOUT `allow-same-origin` unless its manifest
 *   declares storage, which puts the page on an opaque origin; an opaque page's
 *   fetches to its own `/api` are cross-origin, so the server would have to
 *   answer every origin with a permissive header — and then any page in any tab
 *   could read `/app` off loopback and take the ticket. Declaring storage closes
 *   that at the root instead of mitigating it. The pair is load-bearing:
 *   `storage: true` WITHOUT `server.cors` is the arrangement, and either half on
 *   its own is a bug.
 * - **`state:keep`.** One opaque string, holding which of the two repositories
 *   this pane had in front of it. A small thing, and it is the difference
 *   between a pane that comes back where you left it and one that resets to the
 *   project's history every time the canvas reloads.
 * - **`events:emit` — NOT declared, and this is the deliberate omission.** It
 *   was the obvious thing to add: this module commits by itself, which is
 *   exactly the class of event a person cannot see happening. It is not declared
 *   because of how OFTEN it happens. A commit lands a few seconds after every
 *   burst of edits, all day, in the ordinary course of somebody writing notes —
 *   announcing each one would fill a shared panel with the single least
 *   surprising thing in the workspace, and a panel where the common line means
 *   nothing is a panel nobody reads the rare line on. The place to see what this
 *   module did is this module's own pane, where the commits are, and it is one
 *   click away. If a failure ever needs announcing — a repository that stopped
 *   accepting commits — that is a different event with a different frequency and
 *   this line becomes `true` then, for that.
 * - **`live:read`, `epics:read`, `steps:read` — not declared.** This module
 *   never speaks to GitHub or GitLab and has no code path that could. What it
 *   reads is two repositories on this disk, with `git`, and a tracker has
 *   nothing to say about either.
 * - **`selection:set` and `view:navigate` — not declared.** A history reacts to
 *   which project is open. It has no business changing what every other pane on
 *   the canvas is looking at.
 * - **`stage:report` — not declared.** Saying where work is belongs to whoever
 *   is doing it.
 *
 * ## `prompt: false`
 *
 * A prompt is prose a person writes on the canvas, aimed at one pane, composed
 * by the host and delivered in every context. Declaring it makes a host OFFER
 * one. There is nothing here that has to be described before it can be done: the
 * two repositories are found rather than named, the commit messages are derived
 * from what actually changed on disk, and the one message a person might want to
 * write themselves is typed into the commit box where it belongs — stamped, in
 * the repository, with an author and a time. A prompt is none of those things
 * and would be a second, worse place to write the same sentence.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'History',
  version: VERSION,
  /* Bounded at 200 by the protocol, and the parse above is what says so — this
     line was 260 characters when it was first written, and the schema refused it
     at import rather than a host refusing it in somebody else's log. */
  summary:
    'A project’s git history as two tabs — what is committed and what is not, with commit and discard by file. '
    + 'The .kehikot data folder can be a repository of its own, made only when you press for one.',
  /**
   * What an agent should do about this module, given that it is here.
   *
   * Written for somebody who has just arrived and does not know either
   * repository exists, because that is who reads it. Two things matter more than
   * the rest and are said first: whether the data folder is versioned at all is
   * a question with an answer rather than an assumption, and this module is the
   * only thing that commits to a repository inside it, so an agent should ask it
   * rather than running git itself.
   *
   * The "MAY be" is deliberate and is the correction. This line used to say the
   * folder IS a repository of its own, which was this module asserting a fact it
   * had created by running `git init` in somebody's project uninvited.
   */
  guidance:
    'This project has two histories and they are separate. Its own repository holds the work; `.kehikot/` — where '
    + 'the Checklist, Notes, Learning and Journeys modules keep their data — MAY be a git repository of its own: it '
    + 'is one when the project ignores that folder or has no repository at all AND somebody pressed to start it, and '
    + 'deliberately not one when the project’s own repository already tracks it — two repositories over the same '
    + 'files is a state git only half tolerates. `history` with which: "kehikot" says which you are in. Where there '
    + 'is one, commits are automatic a few seconds after a change, and `record` makes one now under a message you '
    + 'chose. `record` never starts a repository and never commits into the project’s own; that is a press a person '
    + 'makes. `show_commit` reads one commit in full, `restore_file` brings one file back. There is deliberately no '
    + 'tool here that switches branches or moves HEAD: doing that under a running agent loses somebody an afternoon.',
  entry: '/app',
  modes: [{ id: 'history', label: 'History', scope: 'global' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'Both of a project’s histories — its own repository and the .kehikot data repository — and committing to the second deliberately.',
  },
  extensions: { emits: [], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['state:keep'],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
