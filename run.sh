#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell.
#   - $PORT from the environment. Whoever starts this chose the port; a script
#     that picked its own would answer somewhere nobody is looking. 7960 is the
#     default and it is the number in the registration too — 7820 through 7950
#     belong to the other modules on this machine.
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
# It does NOT register. Registration is a deliberate act by a person — see
# `register.ts` — and a start script that quietly wrote into somebody's home
# directory would be doing it on their behalf.
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

exec bunx vite --host 127.0.0.1 --port "${PORT:-7960}" --strictPort
