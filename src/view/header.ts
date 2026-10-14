import { LIMITS, type HeaderItemInput } from 'kehikot-module-protocol'

import type { Which } from '@/store/ask.ts'

/**
 * What this page declares for the container's header (`kehikot.header`).
 *
 * The host draws these in the View menu of the row a container already has, so the page spends
 * no row of its own on the Commits / Uncommitted tabs or the Repository chooser: neither is drawn
 * in the page. (The branch row, push and pull stay in the page; they are state as much as controls.)
 *
 * A pure function of what the page has read. The page declares the list again only when its JSON
 * differs, and the poll that re-reads both histories every four seconds finds the same thing
 * almost every time — a commit message being typed is not in here at all, so typing and idle
 * declare nothing; a file that changed, which moves the Uncommitted count, does.
 *
 * Ids: `tab` and `repo`; the options are the words the page already keeps.
 */
export type Tab = 'commits' | 'uncommitted'

export interface HeaderState {
  /** Which half of the repository is in front; null where there is no repository drawn, and nothing to switch. */
  tab: Tab | null
  /** How many changes are uncommitted: said on the option, which is where the tab used to say it. */
  uncommitted: number
  /** Which history is in front, when there are two to choose between; null when there is one. */
  repository: Which | null
}

export function headerOf(state: HeaderState): HeaderItemInput[] {
  const items: HeaderItemInput[] = []
  if (state.tab) {
    items.push({
      kind: 'switch',
      id: 'tab',
      label: 'Show',
      icon: 'history',
      /* A view: which half of the history is in front changes nothing, so an agent may press it. */
      agents: true,
      value: state.tab,
      options: [
        { id: 'commits', label: 'Commits' },
        { id: 'uncommitted', label: `Uncommitted (${state.uncommitted})`.slice(0, LIMITS.HEADER_LABEL) },
      ],
    })
  }
  if (state.repository) {
    items.push({
      kind: 'switch',
      id: 'repo',
      label: 'Repository',
      icon: 'git-branch',
      agents: true,
      value: state.repository,
      options: [
        { id: 'project', label: 'Project' },
        { id: 'kehikot', label: '.kehikot' },
      ],
    })
  }
  return items
}
