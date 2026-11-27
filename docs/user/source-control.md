# Source control

T3 Code integrates with GitHub, GitLab, Forgejo, Gitea, Bitbucket, Azure DevOps, GitCafe, Cursor Origin, and Linear to clone/publish repos, review and merge pull requests, manage issues, and watch CI.

## Connect an account

Install Git and authenticate on the machine running your T3 Code server (for remote environments, do this on the remote machine), then click **Rescan** in **Settings → Source control & issues**.

| Host                               | Setup                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GitHub**                         | 1) Save a token in **Settings → Source control & issues → GitHub**, 2) set `GH_TOKEN` (`GH_ENTERPRISE_TOKEN` + `GH_HOST` for Enterprise), or 3) sign in with [GitHub CLI](https://cli.github.com/) 2.81.0+ (`gh auth login`; use `--hostname` for Enterprise). Pick accounts or disable hosts in Settings when multiple `gh` logins exist.                                                                                |
| **GitLab**                         | Install [GitLab CLI](https://gitlab.com/gitlab-org/cli) and run `glab auth login`.                                                                                                                                                                                                                                                                                                                                        |
| **Forgejo / Gitea**                | Install [`fj`](https://codeberg.org/forgejo-contrib/forgejo-cli) (`fj --host https://your-server auth add-token`) or [`gt`](https://gitea.com/gitea/cli) 2.0+ (`gt auth login --host https://your-server`; it replaces the archived `tea`, so sign in again). Prefers `fj`, falls back to `gt` (use `gt` for subpath-hosted servers). Use full URLs when multiple servers exist.                                          |
| **Bitbucket**                      | Save a repo/project/workspace **Access token** or **Atlassian email + API token** (with repo/PR read-write, `read:user:bitbucket`, `read:workspace:bitbucket`) in **Settings → Source control & issues → Bitbucket**, or set `T3CODE_BITBUCKET_ACCESS_TOKEN` / `T3CODE_BITBUCKET_EMAIL` + `T3CODE_BITBUCKET_API_TOKEN` in the server env (or [`service.env`](./background-service.md#configure-the-service-environment)). |
| **Azure DevOps**                   | Install [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/), run `az extension add --name azure-devops`, then `az login`.                                                                                                                                                                                                                                                                                           |
| **GitCafe**                        | Save a token in Settings, set `CAFE_TOKEN` (+ `CAFE_HOST`), or install `@gitcafe/cli` and run `cafe auth login --host https://git.cafe/api`. Line comments are not yet supported; stack merges/updates are native.                                                                                                                                                                                                        |
| **Cursor Origin**                  | Install [Origin CLI](https://cursor.com/docs/origin/cli) and run `origin auth login` (`origin auth setup-git` if push prompts for credentials). Uses private HTTPS repos; GitHub-mirrored PRs stay on GitHub.                                                                                                                                                                                                             |
| **TanStack Source** (private beta) | Set `T3CODE_FEATURE_FLAGS=tanstack_source` and restart the server. Save a token in Settings, set `SRC_TOKEN`, or run `src auth login --web`. Supports live CI logs, private PRs on public repos, and issues.                                                                                                                                                                                                              |

> Note: Git `push` and `clone` still require Git SSH/HTTPS credentials on the server, separate from API tokens.

> Note: With several `gt` servers and no `fj` login, `owner/repo` and newly published repositories go to `gt`'s default server (`gt config set default_host https://your-server`). With several `gt` accounts on one server, pick one with `gt auth switch <user> --host https://your-server`. If an SSH remote uses a different host name than the server's web address, run `gt config set ssh_host <ssh-host> --host https://your-server`.

## Start, clone, or publish a project

- **New project**: Run **New project** from the command palette (`Cmd/Ctrl+K`) or **Add Project** to initialize a new Git repo in `~/.t3/projects/<slug>` with a README, icon, and first commit (optionally creating a private GitHub repo).
- **Clone**: Use **Add Project** to pick a host (enable non-GitHub hosts in **Settings → Source control & issues**) or paste a Git URL or web page URL. Cloning runs in the background so you can draft your first prompt immediately; falls back to HTTPS if SSH auth fails. Enable **Clone into host folders** (**Settings → Threads**, or **Source control** on mobile) for `ghq`-style `<host>/<owner>/<repo>` paths.
- **Publish**: For a local repo without a remote, **Publish Repository** creates the remote, adds `origin`, and pushes commits.

## Review turn changes

A turn's diff shows only that turn's own edits, commits, and conflict fixes—excluding unrelated files brought in by a pull, merge, or rebase. Use the branch comparison to view everything changed against your base branch.

- **Commits view** (web/desktop): Switch the Diff pane source picker to **Commits** to inspect the latest 100 local commits one by one.
- **Commit links**: Links to local commits open in the Diff pane (follows **Settings → Diffs → Open pull requests in T3 Code**; `Cmd/Ctrl+Click` opens in browser).
- **Multi-repo projects**: Use the repository picker in the Diff pane and expand per-repo rows in thread details. See [Projects with several repositories](./multi-repo-projects.md).

## Explore repository history

Open **Git Explorer** from the sidebar on web or desktop, or the workspace toolbar on mobile,
and choose a project. The graph includes local branches, remote-tracking branches, tags, and worktree
HEADs. Select a commit to review its files and diffs; merge commits compare with their first
parent. Select **Working Tree** to review staged, unstaged, and untracked files. Changing the
review worktree does not check out a branch or change any files.

On web and desktop, double-click a local branch to switch to it, or use its context menu to
switch or rename it. Switching keeps local edits and stops if Git would overwrite them.
Branches checked out in another worktree cannot be switched to or renamed here.

In **Working Tree** on web and desktop, stage or unstage whole files, then commit the staged
content. Unstaged edits stay out of the commit. **Amend latest commit** replaces the latest
commit, including its hash. **Discard** restores the selected files' unstaged changes while
keeping staged content; discarding an untracked file deletes it after confirmation.
**Discard all** does the same for every unstaged and untracked file. Discarding a submodule
checks it out at the commit the repository records, and is refused while the submodule has
uncommitted changes of its own. On web and desktop, Cmd-click (Ctrl-click on Windows and Linux)
or Shift-click working-tree files to select several, then use the toolbar or right-click them
to stage, unstage, or discard them together.

On web and desktop, search branches and tags by name, or search history by message, author,
commit hash, or a repository-relative file or directory path. History search includes commits
that have not loaded into the list yet. Choose **Current branch** to restrict results to the
checked-out branch's ancestry. Right-click commits or branches to copy their hash or name.
Right-click a changed file to copy its path, open its current worktree version in an editor,
or reveal it in the environment's file manager.

Right-click a commit and choose **Reset _branch_ to this commit…** to move the checked-out
branch to it. On mobile, select a commit and use **Reset branch…**. Choose **Soft** to keep
staged changes and working files, **Mixed** to keep files and unstage changes, or **Hard** to
discard staged and tracked working changes. Hard reset may also delete untracked files that
obstruct tracked paths. Remote branches are unaffected. The previous branch tip remains in
Git's reflog; discarded file changes cannot be recovered by moving the branch back.

Use **Tag** on web and desktop, or **Add tag** on mobile, to tag the selected commit or HEAD.
On web and desktop you can also right-click a commit and choose **Tag…**. An optional annotation
creates an annotated tag. Enable **Push tag to remote** to publish it to a configured remote.
A failed push keeps the local tag so you can retry. To push an existing tag or delete it locally,
right-click the tag on web and desktop, or select its commit and use **Manage tags** on mobile.
Deleting a local tag keeps any published copy on the remote.

In repositories that release from `vX.Y` branches, right-click the tip of `master` (or `main`)
or of a release branch and choose **Release → Beta…** or **Production…**. On mobile, long-press
the commit or the branch. Production tags the next `X.Y.N`, and beta tags that same version with
the next `-beta`, `-beta1`, … suffix. Releasing `master` first merges it into the newest release
branch. The branch and the tag are pushed to `origin` together, and the dialog shows each step
before anything runs. Release is unavailable when the commit is already on `origin`, because
pushing only a tag doesn't start CI builds that run on branch pushes. If the merge conflicts
while the release branch is checked out, an agent resolves it and nothing is tagged. Release
again afterwards.

Select a tag to review its commit, or a stash to inspect its saved changes against the stash's
base commit, including saved untracked files. Stashes are listed separately from the graph.
Reviewing a stash does not apply or remove it.

On web and desktop, select a stash and use its toolbar or context menu. **Apply stash** restores
its changes and keeps the saved entry. **Pop stash** removes the entry only after applying it
successfully; conflicts keep the stash. Clear **Restore staged files** to restore everything as
unstaged changes. **Delete stash** removes the saved entry after confirmation without changing
working files.

Ahead and behind counts compare each branch with its configured upstream using locally stored
refs. The last recorded fetch time, when available, describes local fetch information; it does
not confirm the remote's current state. **Refresh** rereads local Git data. Use **Fetch** on web
or desktop, or ask an agent to fetch, if you need newer remote-tracking information.
**No upstream** means no tracking branch is configured. **Missing upstream** means one is
configured but its ref is absent from the locally fetched data; that does not prove a merge.

Local branches also show whether they are merged into their comparison base, usually the
remote's default branch. **Equivalent** means their commit patches already exist on that base;
squashed or edited changes may not be recognized. Hover the indicator, or long-press the branch
on mobile, to see its comparison. Tracked branches separately show **Upstream merged**,
**Upstream equivalent**, **Upstream unmerged**, or **Upstream unknown** against that same base.
This identifies a rebased remote branch that was merged while the local branch still points at
the older commits. Local changes are checked separately before deletion. Both comparisons use
locally stored refs, so fetch before relying on them for recent remote merges.

To clean up a local branch, use **Delete** on its row and confirm. On touch devices, use the
branch menu. Unmerged branches and branches whose merge status cannot be verified require
explicit force-deletion confirmation. This can lose commits that are not saved on another
branch. To delete several branches together, choose **Select** on web or desktop, or
**Select branches** on mobile, choose the local branches, then **Delete selected**. You can select
all branches; on web and desktop, searching first limits **All matching** to the search results.
Review the list before confirming. On web and desktop, deleting a branch folder reviews all
branches inside it. Select **Force delete unmerged or unverified branches** in the review to
include those branches. If a deletion fails, earlier deletions remain completed and the remaining
branches are kept; close the review and select them again to retry. Base branches and
branches checked out in the main checkout or the worktree you are viewing are protected. A
branch checked out in another worktree can be deleted when that worktree is unlocked and has no
changes or untracked files. Deleting the branch removes that worktree folder too, including
ignored files such as dependencies and build output. Remote branches are never deleted.
Branch-specific Git configuration is retained.

## Create, review, and merge pull requests

- **Create**: Commit, push, and open PRs from a thread's Git actions. Configure AI-generated commit/PR writing style in **Settings → Source control & issues → Commits & pull requests** (**Repository conventions** or **Custom instructions**).
- **Review**: Open **Pull requests** to inspect diffs, comments, checks, commits, and request reviewers. Draft line comments stay local until submitted. If new commits are pushed while you review, click **Load new commits** before merging or submitting.
- **Saved views**: Save and update filter/sort setups under **Views → Save current view** (stored per device).
- **Mark files viewed**: Check off files in the **Code** tab to collapse them (reopens as **Changed** on new pushes). Syncs natively with GitHub; stored on your T3 Code server for other hosts.
- **Mobile**: Open **Pull requests** across environments (cached lists, details, guides, and diffs stay readable offline). Tap **Work on PR** to start a worktree thread on the PR's branch.
- **Quick actions & options**:
  - Enable **Remove agent credits when merging** in **Settings → Source control & issues** to strip recognized agent co-author/generated-by trailers on GitHub merge/squash commits (keeps human co-authors).
  - Hold `Shift` in the GitHub PR list (web/desktop) to drag-close multiple PRs (`Esc` cancels).
  - GitHub, GitLab, and Azure DevOps support auto-merge; GitHub also supports approving fork workflows and opening revert PRs.
  - Azure DevOps comments must be edited on the host site; Bitbucket cannot reopen declined PRs.

A pull request merges only once its branch is rebased onto its base. While it is behind, **Rebase**
replaces Merge and auto-merge, and GitHub merges are refused from every client. GitHub rebases a
clean branch itself. When the branch conflicts or GitHub cannot rebase it, an agent (Claude Opus 5.5,
high effort) rebases it in its own worktree, resolves the conflicts, runs the checks, and
force-pushes. If the repository has a `smart-review` skill, the agent reviews only the conflict
resolutions and merges when the review finds nothing blocking. Otherwise it stops after the push.

### Review guides (beta)

Turn on **Settings → Source control & issues → Review guides** to add a **Guide** tab to pull requests. Click **Write guide** to have Claude or Codex read the PR in a temporary read-only checkout and produce an ordered tour of the change (highlighting **Look closely** spots and grouping mechanical changes at the end).

- Customize emphasis/ordering via **Review guide instructions** in **Settings → Source control & issues** (project-overridable).
- On web, select lines in any stop to add review comments or ask an agent about that stop.
- Agents can also generate guides for multiple PRs when asked. Choose **Rewrite guide** from the PR's **⋯** menu after new pushes.

### Pull request sharing across environments

Disabled by default. In **Settings → Environments → Pull request sharing** (**Pull request routing** on mobile), opt in trusted environments to **Read PRs** or **Read and act** so review reads/actions can route through another connected environment signed into the same account on the same host (credentials never leave their machines). Enable on both source and target environments; only grant **Read and act** to environments you control.

## Linked pull requests and watching

Threads can link multiple PRs (even across repos on the same host). Creating a PR via Git actions, `gh pr create`, `glab mr create`, or an agent's `link_pull_request` links it automatically; manage links from **Linked items** or the command palette.

- **Agent PR tools**: Agents can read, open, update, comment on, and merge PRs in the thread's repo using your configured sign-in (refusing merges if the head moved since last read).
- **Watch / babysit a PR**: Ask an agent to watch or babysit a PR (or toggle it in **Linked items** / click the eye icon in thread details). The server polls every 2 minutes and wakes the agent on failed checks, passed required checks, new comments/reviews from others, conflicts, merge-queue drops, or merge/close.
  - Watched threads stay in the **Working** section while checks run (or until merge/close if the agent is waiting to act) and never auto-settle.
  - Watching stops automatically on merge/close, Stop, settle/archive, 10 comment-only wakes in a row, or 8 consecutive read failures. Subagents cannot watch PRs—the parent thread watches instead.

When a thread settles after a merge, T3 also stops and removes its branch's m4c sandbox
containers. It uses the branch and Compose project saved in `sandboxes/<name>/sandbox.env`
and confirms that the sandbox's branch merged. An active thread sharing the branch or worktree
keeps the sandbox running. Protected sandboxes are skipped; volumes and images are retained.
Manual settlement, inactivity, and closing an unmerged PR do not trigger this cleanup.
Docker cleanup failures are logged without undoing settlement.

## GitHub stacks

The Pull requests page displays stack layer positions and navigation:

- **Merge stack**: Merges the selected PR and every open layer below it together, respecting branch rules and merge queues.
- **Rebase stack**: Updates remote branches bottom-to-top without modifying your local checkout (may rewrite history and restart checks).

## Issues

Open **Issues** from the sidebar utility row or **Open issues** in the command palette to browse, filter, search, save views, comment, edit, and transition issues across GitHub, GitLab, Azure DevOps, Forgejo, and Linear.

- **Linear**: Connect an API key in **Settings → Source control & issues** and bind one or more teams per project (supports multiple Linear accounts). Agents file new issues in the first bound team unless another is named.
- **Link to threads**: Click **Link to this thread** on an issue beside a thread (or let agents call `link_issue`) to track it in **Linked items**.
- Remote issue writes require the `source-control:write` scope.

## Troubleshooting

- **Not authenticated**: Run the host's CLI login on the server and click **Rescan** (for Bitbucket/tokens, verify Settings or server env vars).
- **GitHub verification fails**: Upgrade `gh` to 2.81.0+ or save a token in Settings.
- **Push fails**: Check Git SSH/HTTPS credentials separately from API auth.
- **Fork PR badge missing**: Set upstream with `git branch --set-upstream-to=<remote>/<branch>`.
- **A fork lists the original repository's pull requests**: a remote named `upstream` takes precedence over `origin`. Run `gh repo set-default <owner>/<fork>` in the checkout, then rescan.
