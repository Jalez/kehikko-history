# kehikko-history

Both of a project's histories, side by side, and the one that did not exist
before this module.

A project's own git repository holds the work. `<project>/.kehikot/` — where the
Checklist, Notes, Learning and Journeys modules keep their data — is **a git
repository of its own**, created and committed to by this module, because the
project ignores that folder and its history would otherwise not exist anywhere.

```
bun install
bun run register        # or: PORT=7960 bun run register
./run.sh                # or: PORT=7960 ./run.sh
```

Then open `http://127.0.0.1:7960/app`, or reload a kehikko host; it sweeps
`~/.roadmap/modules` on every read.

---

## Why this exists

Four modules keep their data in `<projectPath>/.kehikot/<module>/`, as plain
JSON. The folder is gitignored by the project it sits in — deliberately, because
it is one person's working material and not the project's. The consequence was
noticed by the person it happened to:

> The problem with .kehikot being .gitignored is that it then doesn't have
> history control provided by the host project which I kind of wanted to have.
> Should the .kehikot folder itself have its own git history so that we get the
> history control we want that works for all the data? Then the History module
> could let you control both the project's history and kehikot history
> separately.

Yes. So `.kehikot` is a repository, this module is the one thing responsible for
making it one, and the pane shows both.

---

## The safety property this rests on, and the one flag that breaks it

A git repository nested inside an ignored folder of another repository sounds
fragile. The specific worry is `git clean`, which is what people run when they
want a checkout back to a known state. It was checked before this design was
agreed to:

Measured on git 2.50.1, against a project with `.kehikot/` ignored and a
repository inside it:

```
$ git clean -xdfn        # dry run
$                        # ...nothing. It is not even listed.
$ git clean -xdf
$ ls .kehikot/.git       # still there; the history is intact

$ git clean -xdffn       # dry run, two f's
Would remove .kehikot/
$ git clean -xdff
Removing .kehikot/       # gone, permanently
```

The single `-f` is what people run and what tooling runs, and it leaves a nested
repository alone — **silently**, which is worth knowing: it does not warn, it
does not list it, it simply does not touch it. **That property is what makes this
workable at all.** The double `-f` exists precisely to override it, and there is
nothing this module can do about somebody typing it.

So: **`git clean -xdff` in a project deletes its `.kehikot` history
permanently.** Nothing in this module will ever run it — `clean` is not on the
allowlist of subcommands this module will pass to git, along with `push`,
`reset`, `rebase` and everything else that rewrites or discards — but a person
with a terminal can. If that history matters, `git clone` the `.kehikot` folder
somewhere, or push it to a remote yourself. This module has no network path and
will not do it for you.

---

## Commits are automatic, debounced, and say what changed

The user chose automatic over a timer and over doing it by hand, and gave the
reason to design to: **the value here is recovery, not a curated log.** Nobody is
going to browse these commits for pleasure. Somebody is going to want the state
of their notes from just before the thing that went wrong.

- A burst of edits becomes **one** commit, three seconds after the last write.
- A run of writes cannot postpone a commit past thirty seconds, so the afternoon
  somebody wants back is never the afternoon nothing was committed.
- The message is derived by **diffing the JSON**, not by noticing that bytes
  moved:

```
notes: 2 added on chapters/3_method.tex
checklist: ticked “figures at 300dpi” for gh#105
learning: 3 questions added on chapters/1_introduction.tex
```

The four data modules need no change for this and were not asked for one. The
describer reads their files as ordinary JSON and looks for the shape data has —
records with ids in a named container — and takes the noun from the container's
key, which is why it can say "3 questions added" without having heard of the
Learning module. A tick carries no words at all, so ids are indexed across the
whole file and a change borrows the label of the record with the same id.

**When it cannot describe something, it says something true and dull rather than
something invented.** `notes: notes.json changed` is a fine commit message. A
confidently wrong one is worse than no message at all, because the person reading
it in a hurry believes it. See `git/describe.ts`, and `test/describe.test.ts`
where the dull cases are asserted as carefully as the good ones.

### Recording deliberately

An agent that has just finished a piece of work knows what it did, in words,
better than any diff of the resulting JSON. The `record` MCP tool commits now,
under a message the agent chose. Nothing is lost by not calling it — the
automatic commit still happens — what is gained is a log line saying what the
work *was*.

---

## One committer, and only one

Four modules writing and one process committing is fine. **Two processes
committing to one repository is not**: they meet on `index.lock`, and what a
person sees is an operation that fails at the worst possible moment with a
message about a lock file. Worse, `git add` and `git commit` are two calls, so
two committers can interleave into a commit containing half of somebody else's
staging.

So there is a lock at two levels, because there are two ways to have two
committers:

- **In this process** — one committer per project path, with a single-flight
  guard so a commit already running is never started twice.
- **Across processes** — a lock file in the repository's own `.git`, written with
  an exclusive create so the write itself is the claim. A lock whose pid is no
  longer alive is stale and is taken over; the alternative is that one crash
  means a data folder is never committed again until somebody finds a file they
  have never heard of.

A second History process against the same project **does not commit**, and says
so on its own page. It still shows both histories — reading is safe from
anywhere.

### What happens if you run `git commit` in there by hand

Nothing bad, and it is worth being exact rather than reassuring.

The lock above is **advisory**: it is a file this module writes and this module
reads, and `git` has never heard of it. A `git commit` you make in `.kehikot` is
an ordinary commit, and this module will list it like any other. The only thing
you can collide with is git's own `index.lock`, which git handles itself — one of
the two gets "another git process seems to be running", and works a moment later.
The debounce means this module's commits happen in short bursts with seconds of
nothing in between, so even that is unlikely.

The one thing to avoid is leaving a long-running git operation open in there — a
rebase in progress, a merge with conflicts — because this module will keep trying
to `add` and `commit` on top of it. It will fail rather than do damage, and the
failure is shown on the pane.

---

## Derived data stays out of the history

`.kehikot/references/.gitignore` contains `*`, deliberately: that folder is a
cache rebuilt from GitHub, and a derived cache does not belong in a data history.
**Authored data is committed; derived data is not.**

This module does not touch that file and does not maintain a list of exceptions.
Staging is `git add -A`, and git reads nested ignore files as it descends, so the
whole of that folder is left out with no help from here. The module that owns a
derived folder says so in its own `.gitignore`, and git is what reads it.

---

## The dangerous parts, and what is done about them

This is a real git client in a 220-pixel pane, so the guards are the design
rather than a disclaimer.

**There is an allowlist of subcommands, and it is short.** `push`, `reset`,
`clean`, `rebase`, `filter-branch`, `gc`, `remote`, `fetch`, `pull` and `clone`
are not on it, and neither are the flags `--amend`, `--hard` and `--force`. This
module has **no network path at all**, which is a stronger guarantee than a
careful `push` would be and needs no care to keep. Nothing here can rewrite
history that already exists.

**A checkout over uncommitted work is refused, not warned about.** The brief said
to at least say that uncommitted changes exist. A warning is not something a
person can act on from inside a pane, and an agent may be mid-edit in the project
right now — checking out a branch under one takes the file out from under it
mid-write. So the working tree does not get checked out from under whoever is
using it. There is no override, no second press that forces it, and no `-f`
anywhere. Two ways forward are named in the refusal and both preserve the work:
commit it, or set it aside (`git stash`).

**A restore names what it would overwrite, first, by name.** Restoring over a file
with uncommitted changes destroys those changes and git says nothing about it.
So the changes are looked for and the restore is refused with the file named,
unless you have already been told and said so again.

**A detached HEAD is explained where you land in it.** Checking out a commit is
offered, because looking at what the data was yesterday is most of the point. The
answer then says, in sentences: you are not on a branch, here is what that means,
and here is the branch to press to get back.

**Destructive presses are a two-press arm, never `window.confirm()`.** The host's
sandbox has no `allow-modals`, so `confirm()` does not throw and does not open
anything — it silently returns `false`. A button guarded by one does nothing,
forever, with nothing in the console. The first press changes the button and says
what will happen in specifics; the second does it; a press anywhere else, or
eight seconds, disarms it. `test/render.test.tsx` asserts that no component here
calls `confirm`, `alert` or `prompt`.

**Nothing a request supplies reaches a command line.** `spawn` with an argument
array and `shell: false`, always — never a string. And because an array is only
half of it, every value is checked first: **an argument beginning with a dash is
an option, not a name**, and no shell is involved in that mistake. A leading `-`
is refused everywhere, `--` separators are used wherever git accepts one, and the
environment git inherits is stripped of `GIT_DIR`, `GIT_WORK_TREE`, editors,
pagers and credential helpers. Hooks are disabled with `-c core.hooksPath=` on
every call, because a module that commits on a timer must not be a module that
runs arbitrary code on a timer.

---

## The MCP door

Four tools: `history`, `record`, `show_commit`, `restore_file`.

**There is deliberately no tool that moves HEAD.** No `checkout`, no `branch`.
Checking out a different branch changes every file in the working tree, and an
agent doing that while another agent — or a person — is mid-edit is a genuinely
bad afternoon: files change under an open editor, a half-written change is lost
or committed to the wrong branch, and the symptom arrives minutes later as
something that makes no sense. A tool description saying "be careful" does not
prevent that; not having the tool does. Moving HEAD stays a press a person makes
on the page.

---

## Shape

```
manifest.ts        what a host reads. scope: 'global', and the argument for it
doors.ts           every door but the page: /healthz, /mcp, /api/*
vite.config.ts     the doors as middleware, and the missing server.cors
run.sh             PORT, exec, no build, no dist
register.ts        ~/.roadmap/modules/roadmap.history.json — url and dir

git/run.ts         the seam: spawn with an array, shell:false, an allowlist
git/names.ts       every string that reaches an argument, and the rules
git/repo.ts        finding, fencing, initialising, reading, moving, restoring
git/describe.ts    diffing JSON into a commit message
git/committer.ts   the watcher, the debounce, and the one-committer lock

src/               React 19, Tailwind v4 CSS-first, shadcn under components/ui
page/document.ts   the page, generated, carrying the write ticket
```

`scope: 'global'` is the odd one — every other module here is `epic`. An
epic-scoped tab follows the reader, which is right for a checklist held against a
paper. A history's subject does not move when somebody clicks a different epic:
there is one `.kehikot` repository per project and one project repository per
project. The thing this module follows is the project, and `projectPath` arrives
in `roadmap.context` for a global mode exactly as it does for an epic one.

`declares.storage: true` and **no `server.cors`** — the pair is load-bearing and
either half on its own is a bug. `test/manifest.test.ts` asserts the absence
against the source, because that is the mistake somebody makes at four in the
afternoon while chasing something else.

```
$ curl -sI -H 'Origin: https://evil.example' http://127.0.0.1:7960/app | grep -i access-control
$
```

Nothing. Which is the point.

---

## Sizing to the pane

This page's normal case is 220 to 400 pixels wide inside somebody's canvas, so
every responsive class is a `@container` class measuring the pane, and no
viewport breakpoint is used anywhere. Measured in a headless shell at 220, 280,
320, 400 and 1200px, in both themes, with every `<details>` open, a destructive
button armed and its warning showing:

```
light  220px  scrollWidth=  220 client=  220  commits=3 armed=true  ok
dark   220px  scrollWidth=  220 client=  220  commits=3 armed=true  ok
                              ...all ten ok
```

The trap this module had to survive is that shadcn's `Badge` ships
`whitespace-nowrap`, and a commit subject is exactly the long unbreakable string
that pattern cannot handle. Checklist hit this first, with a 407-character
authored string that set an 1187px min-content floor under a 220px pane. Here it
was measured again at 220px on an ordinary 83-character subject — `learning: a
question about mode scope, written while reading the background chapter`, which
an agent wrote through the MCP door while this was being tested:

```
wrapping, as this ships:    document.scrollWidth = 220px
nowrap, shadcn's default:   document.scrollWidth = 464px
```

Eighty-three characters is already twice the pane.

The symptom is not the badge — it is the whole pane scrolling sideways with
every other row cut off at the frame, while the badge looks perfectly normal. So
the default badge variant here wraps, and `nowrap` survives only on the `tag`
variant, whose content is short by construction: an eight-character object name,
a status letter, a branch name. `test/render.test.tsx` asserts that, because it
is the thing a future edit would undo without noticing.
