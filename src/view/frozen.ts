/**
 * Why moving HEAD is off, in one sentence, in one place.
 *
 * ## Two controls, one rule
 *
 * Switching to another BRANCH and going to another COMMIT on this one are the
 * same act to git — `git checkout` — and it refuses both over uncommitted work
 * for the same reason. They were drawn as if they were different problems: the
 * branch select went grey with a paragraph under it, while "Go here" stayed
 * pressable and armed into a warning that the press was about to be refused.
 * A control that offers itself in order to explain that it will not work is a
 * control that wastes two presses to say what grey says for free.
 *
 * So both ask this, and both go grey with this attached. One sentence, one
 * definition, and no way for the two halves of "you cannot move HEAD right now"
 * to drift apart — which is the failure this workspace keeps meeting: two
 * places quietly disagreeing with nothing raising an error.
 *
 * ## It is not git's refusal rewritten
 *
 * `switchTo` in `git/repo.ts` refuses with git's own words, naming the files
 * that would be lost, and those arrive verbatim for the cases a page cannot see
 * coming. This is the other thing: the answer is already known from the same
 * read that drew the list, so the control does not offer the press at all. That
 * is the whole of "do not allow what git would not allow" as it applies here.
 */
export function frozenReason(dirty: number): string {
  const changes = dirty === 1 ? '1 change is' : `${dirty} changes are`
  return (
    `Moving to another branch or commit is off while ${changes} uncommitted — git will not check out over them. ` +
    'Commit or discard them in the Uncommitted tab first.'
  )
}
