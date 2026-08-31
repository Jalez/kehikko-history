/**
 * The screen for "nothing said which project this is", which is not an error.
 *
 * ## Why this screen exists at all
 *
 * Both of the histories this module shows are found from
 * `roadmap.context.projectPath`, which is nullable and is null in two perfectly
 * ordinary situations: nothing is framing this page, or a host knows the
 * project's NAME and has no folder on this machine to point at.
 *
 * The alternatives to saying so were both available and both worse:
 *
 * - **An empty pane.** "No project is open" and "this project has no commits
 *   yet" would look identical, and the second has buttons on it.
 * - **A guess** — this module's own directory, the working directory, the last
 *   project somebody looked at. That is not merely showing the wrong thing here.
 *   This module CREATES a repository, so a guess means running `git init` inside
 *   a folder nobody chose, and then committing to it every few seconds.
 *   `git/repo.ts` refuses to have a fallback for exactly that reason, and this
 *   component is the other half of that refusal.
 *
 * ## It offers nothing to press
 *
 * Deliberately. A picker here — "which project did you mean?" — would be this
 * page deciding where it is standing, which is the thing it has just said it
 * cannot know.
 */
export function Nowhere({ unhosted, project }: { unhosted: boolean; project: string | null }) {
  return (
    <section data-nowhere="yes" className="flex min-w-0 flex-col gap-1.5">
      <h2 className="text-[0.8rem] font-semibold">{unhosted ? 'Nothing is framing this page' : 'No project is open'}</h2>
      <p className="text-[0.7rem] leading-4 text-muted-foreground">
        {unhosted
          ? 'Opened directly, this page has no canvas to tell it which project it is standing in. Both of the '
            + 'histories it shows — the project’s own repository and its .kehikot data folder — are found from that '
            + 'path, so there is nothing to read and nothing to commit until a host says where the project is.'
          : project
            ? `This canvas says the project is called “${project}” but did not say where it is on this machine. A `
              + 'name is not a path, and this pane will not guess — a guess here would mean making a git repository '
              + 'inside a folder nobody chose and then committing to it every few seconds.'
            : 'Nothing on this canvas says which project is open. This pane shows two histories that belong to a '
              + 'project — its own repository, and the .kehikot folder the modules keep their data in — so there is '
              + 'nothing to show until one is.'}
      </p>
      <p className="text-[0.65rem] leading-4 text-muted-foreground">
        Nothing has been created and nothing has been committed. Open a project and both histories appear.
      </p>
    </section>
  )
}
