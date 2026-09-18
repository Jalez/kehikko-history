# kehikko-history

Both of a project's histories, side by side, and the one that did not exist
before this module.

A project's own git repository holds the work. `<project>/.kehikot/` — where the
Checklist, Notes, Learning and Journeys modules keep their data — **can be a git
repository of its own**, made and committed to by this module, when the project
ignores that folder or has no repository at all and its history would otherwise
not exist anywhere.

**When the project's own repository already keeps that folder, this module does
not make a second one.** It looks before it initialises, it says which of the
two situations it found and names the folder in the sentence, and it makes
nothing at all until somebody presses. See *Look before you init*, below, and
`git/enclosing.ts`.

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

Yes. So `.kehikot` can be a repository, this module is the one thing responsible
for making it one, and the pane shows both.

---

## Look before you init

This module got that last sentence wrong, in a way worth writing down at the top
of the file rather than in a changelog.

It ran `git init` inside `<project>/.kehikot/` the moment a pane learned which
project was open. It did that in two of the user's projects without being asked,
and one of them was the one that mattered: a thesis several levels inside a
repository that — earlier the same day, deliberately, through the host's
per-project "keep `.kehikot` in git" setting — had been made to **track** that
folder. Two repositories then claimed the same files. Git tolerated it only
because the outer one had them first.

It also said, on screen: *"Started a git history for this project's data folder.
It was not one before."* The person who read that owns a folder called `data/`,
which this module has never touched, and reasonably concluded a program had
started a repository in it.

Both faults have the same root, which is that this module acted where it should
have looked. The fix is a question with four answers.

### The test

Asked by `git`, not reimplemented — `.gitignore` has negations, directory-only
rules, `**`, per-directory files and `core.excludesFile`, and a hand-rolled
matcher that is right about eight of those is confidently wrong about the ninth
in somebody's thesis.

```
git -C <project> rev-parse --show-toplevel   # is it in a repository at all?
git -C <root>    ls-files -z -- <.kehikot>   # does that repository TRACK it?
git -C <root>    check-ignore --quiet -- <.kehikot>   # or does it IGNORE it?
```

Run from the **project**, never from `.kehikot` — run from inside the folder,
`--show-toplevel` answers the folder itself the moment this module has already
made it a repository, so the check would report "no enclosing repository"
precisely in the case it exists to catch. And **tracked is asked first**: a path
can be both tracked and covered by a rule, and in that state git keeps tracking
it and the rule does nothing.

| what git says | what this module does |
| --- | --- |
| **`alone`** — no repository above it | Offers to start one. A history of its own is the only history available. |
| **`declined`** — a `.gitignore` rule covers it | Offers to start one. That repository will never hold these files, so this is not a second history — it is the only one. |
| **`kept`** — that repository tracks files in it | **Never initialises.** Somebody already chose where this folder's history lives. Offers a commit *into that repository* instead, by press. |
| **`offered`** — inside a repository, no rule, nothing tracked yet | **Never initialises.** The enclosing repository has not declined it; `git status` there lists it as untracked and the next `git add` picks it up. Same offer as `kept`. |

The fourth row is the one a three-answer version misses, and it is exactly the
state the thesis was in for the minutes between the setting being flicked and the
first commit. It is also the state of every brand-new project before anybody has
decided anything.

### It asks, and it announces

Two separate decisions, both answered rather than defaulted.

**Nothing initialises without a press.** The page no longer POSTs a start on
mount; `GET /api/histories` reads the situation and creates nothing, and the pane
draws a sentence and a button. `POST /api/watch` initialises only when the body
carries `asked: true`, compared to the boolean rather than read as truthy. A
project whose `.kehikot` is already a repository resumes committing without
asking again — that press was already made once, and re-asking every page load
would be a dialog for a decision that exists.

**The sentence names the path.** What it says now:

> Started a git history in `/Users/you/Projects/thing/.kehikot` — the folder your
> modules keep this project's material in. The repository is inside that folder
> and holds nothing outside it; your project's own repository is untouched.

**And it no longer writes to your `.gitignore`.** It used to append `.kehikot`
to `<project>/.gitignore` whenever it created the folder, which was this module
deciding on somebody's behalf, without saying so, that their project should not
keep its own copy of this material. That decision has a switch of its own — the
host's per-project "keep `.kehikot` in git" — and this module now only reads the
answer.

### Committing into a repository this module did not make

For `kept` and `offered`, the pane offers one press: commit `.kehikot` into the
repository the project is already in.

**There is no automatic commit in that direction, ever.** No debounce, no timer,
no watcher, and no MCP tool that reaches it — `record` refuses and says where the
press is. The `.kehikot` repository this module makes gets a commit three seconds
after a write because nobody else reads it and the value there is recovery;
somebody's own repository gets a commit when they press, because the value there
is a log they read and forty machine-written commits a day is not one. Refusing
costs nothing either: in that stance their own repository is already keeping the
folder, so their next ordinary commit carries it.

The mechanics are `kehikko-paper`'s, reused rather than rediscovered — that
module worked this out against the same repository:

- **By pathspec, with `--only`**: `-- :(literal,top)<.kehikot>`. Git builds the
  commit from HEAD plus the working-tree state of those paths alone, so work
  staged anywhere else is neither consulted nor recorded and is still staged
  afterwards. Asserted in `test/enclosing.test.ts` against a real repository with
  an unrelated file staged.
- **`git add` with the same pathspec first**, because a folder never committed is
  untracked and pathspec-mode commit refuses it. Never `git add -A`, never
  `git add .`.
- **Refusals rather than guesses**: detached HEAD, a merge or rebase in progress,
  no configured identity. Each names what to do about it. The `kehikot@localhost`
  identity fallback this module uses for its own repository is *not* used here —
  git invents `someone@their-laptop.local` when `user.email` is unset, and a
  commit in somebody's thesis attributed to an address that does not exist is a
  wrong answer to "who wrote this" written into a history that keeps it.
- **No `--no-verify`**, and hooks are re-enabled for that one call. Every other
  call in this module passes `-c core.hooksPath=`, because a module that commits
  on a timer must not run arbitrary code on a timer; nothing in that direction is
  on a timer, and the repository is theirs with their hooks in it.

### `.git.disabled` is a stop sign

The two nested repositories found on this machine were disabled by renaming
`.git` to `.git.disabled`, so what was committed into them is still recoverable.
This module treats a `.git.disabled` beside the folder as neither a repository
nor an empty space: it refuses to start a history there, names the path, and
leaves the file alone. Rename it back or move it, and then press.

---

## The safety property this rests on, and the one flag that breaks it

A git repository nested inside an **ignored** folder of another repository sounds
fragile. (Inside a *tracked* one it is not merely fragile, it is the fault above,
and this module no longer makes one.) The specific worry is `git clean`, which is
what people run when they want a checkout back to a known state. It was checked
before this design was
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
allowlist of subcommands this module will pass to git, along with `reset`,
`rebase` and everything else that rewrites or discards — but a person with a
terminal can. If that history matters, give the `.kehikot` repository a remote
(`git remote add` in a terminal; this module does not edit remotes) and the
push button on its branch row sends it there.

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

It commits **only to a repository inside `.kehikot`, and it never starts one.**
Where the project's own repository is the one keeping that folder, `record`
refuses and says where the press is. An agent writing a line into somebody's own
history, in their name, is not something a tool description saying "be careful"
prevents; not having the tool is.

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

**There is an allowlist of subcommands, and it is short.** `reset`, `clean`,
`rebase`, `filter-branch`, `gc`, `remote`, `fetch` and `clone` are not on it, and
neither are the flags `--amend`, `--hard`, `--force`, `--force-with-lease`,
`--mirror`, `--delete`, `--prune`, `--rebase`, `--exec`, `--upload-pack` and
`--receive-pack`, in either spelling git accepts. Nothing here can rewrite
history that already exists.

**`push` and `pull` ARE on it, and only ever forward.** This module used to
have no network path at all, and said so as a guarantee stronger than a careful
push. That was traded for two buttons on the branch row, and what replaced it
is narrower and stated in full in `git/run.ts`: a push from here can only
fast-forward a remote branch — every flag and every refspec spelling that
forces or deletes is refused, and a push the remote cannot fast-forward comes
back as "somebody pushed first, pull" rather than as a fault; a pull from here
is `--ff-only`, so it either moves the branch cleanly onto what was fetched or
refuses and changes nothing, because a half-done merge is a state this pane
cannot draw or get out of — that belongs in a terminal, and the refusal says
so. No `pre-push` of yours is skipped in your own repository. And nothing here
can wait on a prompt: every way git and ssh have of asking for a password, a
passphrase or a host key is turned off, so a missing credential is a sentence
in under a second rather than a pane that says "pushing" until it times out.

The buttons say what they will do before you press. `push 3` is three commits
the remote-tracking ref does not have — local knowledge, and current. `pull 1`
is one commit behind **as of the last fetch**, which the tooltip says in so
many words, and the pull button is never greyed for "nothing to pull" because
that would be a claim about a server this machine has not asked. Push is grey
with a reason when there is nothing to push, no remote, no upstream and no
clear remote to publish to, or HEAD is detached; pull is grey when there is
no remote, no upstream, or HEAD is detached. A branch with no upstream gets a
**publish** button instead: a first push that also sets the upstream.

**Uncommitted work is a caveat on pull, not a bar to it.** It used to grey the
button, by the rule that freezes the branch select. That was wrong twice over.
Something is uncommitted on a working project nearly all the time — the modules
write to `.kehikot` as you use them — so pull was not occasionally off, it was
off, including on the one screen that tells you to press it: the refusal of a
push the remote rejected, whose advice is "pull to bring their commits in, then
push again". And a fast-forward is not a checkout of the whole tree. Git refuses
one exactly when it would write over a file you have edited, it names that file,
and it refuses the whole pull, so there is no half-done state to be got into.
So git decides. The tooltip carries the caveat, and the refusal names the files.

**Every answer this pane gives can be dismissed.** The green box and the red one
carry a × . They used to be cleared only by the next press, which on a refusal
whose advice you could not follow meant four lines of red pinned above the
branch row with nothing to do about it.

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
git/enclosing.ts   look before you init: the four answers, and the one commit
                   this module makes into a repository it did not make
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
