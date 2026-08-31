#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell.
#   - No port, and no `--strictPort`. Both used to be here, and the number 7960
#     was written twice — once on this line and once in `register.ts` — which is
#     why moving a module meant editing two files and then remembering that the
#     file in `~/.roadmap/modules` still named the old address. It is now stated
#     once, in `vite.config.ts`, beside the id: `serves({ id: ID, prefer: 7960 })`.
#     $PORT is still honoured, because a host that starts this passes the port
#     from the registration and the module should prefer the address the host is
#     about to look at; the plugin reads it.
#
#     What `--strictPort` bought was a module that DIED on a taken port —
#     `Error: Port 7960 is already in use`, exit 1 — rather than one answering
#     somewhere nobody was looking. That was the only honest option while nothing
#     handled a collision. Now `serves()` handles it: a free 7960 is taken in
#     silence, this module already answering there ends the start cleanly instead
#     of making a second copy, and anything else is a loud move with the
#     registration rewritten to the port actually bound.
#   - `exec`, and the foreground. A script that forks and returns leaves whoever
#     started it holding a pid that stops nothing, and Stop is only ever offered
#     for what a host started.
#   - `cd` to this script's own directory, so `bunx vite` finds this app's own
#     config and its `node_modules` however the script was invoked.
#
# ## Nothing here says which project, and that is the whole shape of this module
#
# There is no variable to export. The two repositories this app shows are found
# from `projectPath`, which arrives in `roadmap.context` from whichever host
# framed the page — this script cannot know which project that will be, and a
# script that exported a default would be handing this app a folder to run `git
# init` in that nobody chose. See `git/repo.ts`: a silently wrong location is
# worse than a loud absent one, and here it would mean making a repository
# somewhere a person will never look.
#
# It does not register a module that had none. Adoption is a deliberate act by a
# person — `bun run register`, see `register.ts`, and that essay stands. What the
# Vite plugin now writes on every start is the module's ADDRESS, which is a
# different sentence: the person decided to be framed, they did not decide to be
# framed at 7960 in particular, and a registration still naming a port this
# module has drifted off is one the host sweeps to find nothing.
#
# ## There is no build here, and no `dist`
#
# What `dist` actually buys is a STALE page served with a 200, every symptom of a
# working app and none of the changes, and that failure has cost this codebase
# whole afternoons three separate times in three different programs. A missing
# build announces itself. A stale one does not.
#
# So Vite serves the page. The manifest, the health check, the MCP door and this
# app's own `/api` are middleware in front of the same server — see `doors()` in
# `vite.config.ts` — because a module is one origin or it is nothing.
#
# ## The committer lives in this process
#
# The file watcher and the debounce that make the automatic commits are started
# by the page asking for them, inside the Vite process this script execs. So
# stopping this script stops the committing, which is correct: exactly one
# process commits to a `.kehikot` repository, and a committer that outlived the
# program it belongs to would be one nobody could see or stop.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "installing…" >&2
  bun install >&2
fi

exec bunx vite
