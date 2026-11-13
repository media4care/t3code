# Settings and project overrides

On web and desktop, the "Applying settings for …" sentence at the top of Settings pages picks
the project and environment a change applies to. Pages that only hold device preferences, such as
Appearance, don't show it. They start at **All projects** and **All environments**
and stay selected as you move between categories or search for a setting.

Preferences saved on this device, such as appearance, confirmations and browser profiles, always
show and ignore the selection. Everything else is stored on a server. Choose one environment to
edit its settings, or leave **All environments** to edit every connected environment at once.
Offline environments keep their current values; this is a bulk edit, not a synced global default.

Choose a project to override settings for it on the selected environments. A layers icon beside
each server row's title shows where the value comes from: the built-in default, the environment,
or a project override. Click it to see that chain on every selected environment. An override can
be reset to inherit again. Settings that cannot be overridden by a project are shown read-only
while a project is selected.

When the selected environments disagree, the control shows **Mixed** in place of a value and the
layers icon turns amber. Picking a value applies it to every selected environment.

Changing an environment value never touches a project's own override. When projects override the
setting you are editing, the layers icon counts them and the chain lists each one with its value:
click a project to jump to it, or **Reset all** to make those projects follow the environment
again.

Providers and diagnostics are per machine: they show one environment at a time, the primary
one until you pick another. Every other setting fans out to the selection.

With a project selected, a provider's switch in **Settings → Providers** turns it on or off for
that project only, in either direction: a provider off on the machine can be used in one project,
and one on everywhere can be kept out of another. That project's model pickers follow the switch,
and no new turn there can start on a provider it turned off, including queued messages and
follow-ups from delegated tasks. A turn already running when the switch flips finishes. A delegated
task's result still lands in its parent thread, which sees it on its next turn. Reset returns the project to the
machine's setting. Every other provider setting stays per machine.

On mobile, open **Settings** and use the filter in its header to choose connected environments
and a project. The filter stays available in server-setting pages. With **All projects** selected,
the server-setting pages, such as Threads, Source control and Worktrees, edit the selected
environments' defaults. Choosing a project edits its overrides on the selected
environments. Use **Use defaults** in a page to remove that page's project overrides.
Open **Settings → Projects** to rename the project across its selected
connected checkouts and see where those checkouts live.
Settings that are environment-wide stay read-only while a project is selected. When selected
targets disagree, a control shows **Mixed** until you choose one value. Appearance, keyboard,
and other phone-only settings ignore the filter.

## Pin and archive projects

Pinned projects come first in the project pickers: the project picker on a new thread, the
new-thread list, the command palette, the sidebar project filter, and mobile. The sidebar, and the thread list on
mobile, also list them in a collapsible **Pinned projects** section: click or tap a project to show only its threads,
do it again to show all projects, and use its pen button to start a thread there. In the boring sidebar, pinned projects
get the top folders instead, even with no active threads. Pin or unpin a project from its row in any of those lists,
or press the thread pin shortcut (`mod+shift+p` by default) on the highlighted row. **Pin
project** in the command palette and **Settings → Projects** work too. A list keeps its order
while it is open, so a new pin moves up the next time you open it.

Archive a project you are done with in **Settings → Projects**. It leaves the project pickers.
Its threads, settings, and files stay as they are, and archived projects still show in the
Settings project list, marked **Archived**. Choose one there and select **Unarchive** to bring it
back. On mobile, both are in **Settings → Projects → Organize**.

A project on several machines must have every machine connected to pin or archive it.

## QA test suites

Open **QA** and choose a repository to run its test suites and inspect previous runs.
Clones and worktrees of one remote share their QA, so a repository appears once per
environment. For a fork, that is its `origin`, not the upstream it tracks. Only
environments with **Run QA here** on list their repositories.
On mobile, QA is available in the navigation overflow; use **Settings → Navigation**
to move it into the tab bar. Web and desktop also offer **Open QA** in the command
palette and the configurable `qa.open` keyboard command.

Add suites to the project's checked-in `t3.json`, preserving its other settings:

```json
{
  "qa": {
    "suites": [
      {
        "id": "backend-unit",
        "name": "Backend unit tests",
        "component": "Backend",
        "kind": "unit",
        "cwd": "backend",
        "command": "npm test -- --run",
        "inputs": ["backend", "shared"],
        "maxAgeHours": 24
      }
    ]
  }
}
```

Use your existing non-interactive test command. On macOS and Linux, commands use
the environment's login shell; on Windows they use the system command shell.
`cwd` is optional and relative to
the project root. Each suite needs a unique, stable `id`; changing its name keeps
its history. Refresh the catalog after editing the configuration.

Add `component` labels such as Backend or Mobile, and a `kind` such as `unit`,
`integration`, `playwright`, `maestro`, `e2e`, or `tooling` to organize the dashboard.
Switch between component and test-type groups, search the catalog, or select a
health total to filter suites by their latest result. **Needs attention** includes
failed, incomplete, cancelled, and interrupted runs; **Never run** means no QA history.

For a repository with a remote, QA tests pushed code in its own checkout, separate
from your projects and agent worktrees. Pick a branch or tag next to the repository;
it starts on the default branch, and **Other branch or tag…** opens any other, such
as a release tag. Before each run QA fetches the remote, moves its checkout of that
ref to the latest commit and runs the ref's `t3.json` setup script (the one marked
`runOnWorktreeCreate`) when the commit changed. Each run records the exact commit it
tested. Results, freshness and history are kept per ref, and **Compare branches and
tags** shows each suite's latest result on every ref side by side. QA keeps one
checkout per ref so dependencies are reused; **Delete checkout** removes one and
keeps its history, and checkouts unused for 14 days are removed automatically.

A project without a remote is tested in its current checkout, including uncommitted
changes. Prepare the test database, browser, or installed app as your command
requires. One suite runs at a time per repository; closing QA or disconnecting the
client does not stop it. Cancel stops the command and its
child processes. A server interruption is recorded separately from test failure.

When several machines share your projects, pick the one that runs QA. On each other
environment, turn off **Settings → Devices → QA → Run QA here**. QA then lists each
project only on the environment that tests it, and the other environments refuse runs
and new schedules. Their existing schedules wait until QA is turned back on.

For test counts and a saved report, add `"report": "junit"` and configure the
command to write JUnit XML to the `T3_QA_REPORT_PATH` environment variable. For
example, a Vitest command can end with
`--reporter=junit --outputFile="$T3_QA_REPORT_PATH"`; Playwright can use
`PLAYWRIGHT_JUNIT_OUTPUT_FILE="$T3_QA_REPORT_PATH" playwright test --reporter=junit`.
Use your shell's environment-variable syntax on Windows. The path is unique to
each run. A missing, invalid, empty, or entirely skipped report cannot produce
a passing result. Reports are limited to 2 MiB.

Without a report, a zero exit code is labelled **Command passed**, with no inferred
test count. Run details retain the command, working directory, starting Git revision,
uncommitted-change indicator, timestamps, exit status, and up to 131,072 characters of recent output.
Full history, output and reports stay on the execution environment.
Choose **View tests** on a suite to browse individual names, pass/fail/skipped
results, durations, and expandable failure or skip details. Search by name, group,
or file, filter by result, and page through large reports. The list also works for
older runs and imported CI results. Existing saved reports work without rerunning;
runs without JUnit reports cannot show individual tests. **Run output** keeps the
command log available below the list.

QA shows each suite's latest run and the project's 50 most recent runs. Freshness
is separate from the result: a pass can need a rerun, and an unchanged input set
does not hide a failed attempt. Suites also retain the time of their last pass.

Declare `inputs` as project-relative files or directories, including shared code,
fixtures, test configuration, and scripts the suite uses. Paths are relative to the
project root even when `cwd` is set; glob patterns are not supported. Directories
include Git-tracked and unignored files, plus generated sources, declarations and
environment files recognized by the push-check cache. Explicit file paths can
include other ignored configuration. Root package manifests, common lockfiles,
test configuration and dependency installation state are included automatically.
Optional `maxAgeHours` makes old results need a rerun.

For a package in a pnpm or npm/Yarn workspace, set `workspacePackage` to its package
name to include its dependencies. Additional `inputs` extend that selection. T3's
own catalog uses the same package-impact rules as its push checks and CI, including
test-only dependencies and cross-package reads. Other repositories use their
workspace dependency graph and conservatively include files with no known owner.

Refresh QA after editing files. QA compares file contents, including uncommitted
edits, additions and deletions, against the saved run. It checks again at completion;
inputs that changed during a run cannot be treated as verified. Older runs without
input evidence and inputs that cannot be read show unknown freshness.

To share results with other developers, add `"sharedResults": true` beside `suites`
in `qa`. Completed manual and scheduled runs in a project's own checkout then save a
small summary per suite in `t3.qa-results/`; runs in QA's checkout do not. Cancellation, server interruption and launch failures stay in local
history and leave the last shared result intact. Commit these files with the tested changes and share the commit
through your normal Git workflow. QA reads them after another developer pulls;
**Repository result** identifies a summary from the checkout. Refresh QA after pulling.
The summaries contain the outcome, counts, times, starting revision, branch name, run ID,
uncommitted-change flag and a combined input fingerprint. Changes to summary files alone
do not set the uncommitted-change flag. Summaries exclude command output, individual test reports, file contents
and local paths. Opening the original execution environment provides the full details.

A shared pass can be reused only when the configured inputs match, stayed stable
during execution and have not expired. Declare complete `inputs` or `workspacePackage`
coverage first; missing input or external-environment evidence still requires a rerun.
Lockfiles and local configuration can differ across machines and make a shared result
stale. QA also compares pnpm installation metadata when present. Local configuration
includes ignored `.env*` files within declared inputs
and root `.env*` files: their presence and contents must match too. Their hashes contribute
to the combined fingerprint, but their contents and individual hashes are not published.
A matching Git revision alone does not establish an equivalent test environment. The
combined fingerprint can detect a mismatch without identifying the changed file.
A newer failed local run remains visible and needs a rerun.
The summary directory is excluded from test inputs, so committing results does not
invalidate them. Keep it out of `.gitignore`. Resolve merge conflicts by retaining a
complete summary from one run; QA checks its fingerprint against the resulting files.
Set `sharedResults` to `false` to stop writing and using repository results. Existing
files remain in Git until you remove them. Imported CI reports remain separate.

Set `environment: "external"` when a suite tests a deployed service or an installed
app; this is the default for `maestro` and `e2e` suites. Set `environmentFile` to a
project-relative file maintained by your deployment/device tooling that identifies
the actual target build and environment. Missing identity means unknown freshness.
Use `environment: "workspace"` only when the test builds and controls its targets
from the current checkout. Unchanged inputs are guidance about the declared files,
not a guarantee about untracked external state or complete test coverage.

QA also shows the environment's **Device pool**: the iOS simulators and Android
emulators it can start and the Android devices connected over ADB. Turn on device
support there to list them. A physical device that has connected before stays listed
as offline, with the time it was last seen, until you forget it. A device open in a
Device panel shows **In use**; one a QA run holds shows which suite holds it.

When a suite needs a device, list it under `devices`:

```json
{
  "id": "tablet-flows",
  "name": "Tablet flows",
  "kind": "maestro",
  "command": "maestro --device \"$T3_QA_DEVICE_ID\" test flows/tablet",
  "devices": [{ "platform": "android", "formFactor": "tablet" }]
}
```

Each device has a `platform`, `ios` or `android`. Optionally set a `formFactor`
(`phone`, `tablet`, `tv`, `watch` or `other`), a `type` (`virtual`, `physical`, or the
default `any`), a `defaultDevice` name such as an AVD name, and an `id`. Up to four
devices can be listed; each gets a different device. QA picks a running emulator or
simulator first, then one it can start, then a connected physical device. Choose
another on the suite to keep using it on this environment. If a chosen device is
offline, runs use QA's pick until it is back. A suite with no device available shows
**Blocked**. A blocked suite that runs anyway, for example on a schedule, is recorded
as incomplete without starting its command.

A run holds its devices from before they start until it ends, so two suites never use
the same device at once. QA's pick skips a device another suite's run holds. When the
chosen device, or the only one that fits, is held, the suite shows **Waiting for** the
device, and a run waits up to 30 minutes for it before it is recorded as not run.
Devices open in a Device panel are not held: a run can still use them, and the suite
says so.

Before the command starts, QA starts a stopped emulator or simulator and waits until
it has finished booting; devices keep running afterwards. The command receives
`T3_QA_DEVICE_ID`, `T3_QA_DEVICE_NAME` and `T3_QA_DEVICE_PLATFORM` for the first
device, `ANDROID_SERIAL` for the first Android device, `T3_QA_DEVICE_ID_<ID>` for each
device with an `id`, and `T3_QA_DEVICES` as JSON describing them all. Run details
record the devices used. Commands run on the environment's machine, so only its own
devices can be used.

To let [Simlock](https://incubator.callstack.com/simlock/) hand out the devices, run a
Simlock worker on the QA machine and set **Settings → Devices → QA → QA devices** to
**Simlock on this machine**. T3 Code does not install Simlock; the `simlock` command
must be on the server's `PATH`. Each run then leases its devices with
`simlock --local lease`, using the requirement's `platform`, its `defaultDevice` as the
model or else its `formFactor` as the class, and `--physical` for a `physical` type.
Simlock queues the request while every device is busy, for up to 30 minutes. The run
returns its devices when it ends, and Simlock wipes them. Commands receive the same
variables, with the simulator's UDID or the emulator's serial as the device ID, plus
the variables Simlock provides, such as `SIMLOCK_IOS_DEVICE_SET`. Simlock keeps its
simulators in that device set, so pass it to tools that look for simulators, for
example `xcrun simctl --set "$SIMLOCK_IOS_DEVICE_SET"`. The device pool and per-suite
device choices do not apply in this mode. If Simlock is missing or cannot lease a
device, the run is recorded as not run with Simlock's reason.

**Run affected suites** rechecks freshness and runs changed, expired, unknown,
untested, and unsuccessful suites sequentially on the selected environment.
Closing the client leaves the queue running. **Stop queued run** cancels the active
command and clears the queue; cancelling its active suite also stops the queue.
A server restart interrupts the active run and discards pending suites, which stay
eligible for a rerun. Recurring schedules are not configured by this action.

To run tests regularly, use **Recurring runs → Add schedule** in QA. Choose all
suites, affected suites, or one suite, then set an interval or a time and weekdays.
Fixed times use the time zone you enter. Each branch or tag has its own schedule,
so you can run `main` and a release tag nightly. Schedules stay on that environment
across restarts; they are not copied with the repository. The environment's server
must be running.

A schedule fetches its ref and tests it in QA's checkout. For a project without a
remote, it uses the current working files only when the checkout is on the branch
you selected, and does not pull or switch branches. Manual work takes priority;
scheduled work waits while a suite is active. Fixed-time runs missed by more than
10 minutes are recorded as missed, and interval schedules resume once without
replaying a backlog. Next and last execution are shown alongside the result.
You can edit, pause, resume, or remove a schedule. Pause and remove affect future
runs; use **Stop queued run** to cancel work already underway.

Use **CI results → Import CI report** to import JSON containing JUnit XML and the
runner's revision, branch, environment, completion times, and exit code. Web and
desktop accept a JSON file or pasted JSON; mobile accepts pasted JSON. The import
form includes an example. Use the suite ID from `qa.suites` and a unique run ID
for each CI attempt. Importing the same report again is safe; a different report
with the same provider, run ID, and suite is rejected.

CI can send the same report to the environment's authenticated
`POST /api/qa/import` endpoint. Wrap it as `{ "projectId": "…", "report": { … } }`
and use an environment bearer token with `terminal:operate` permission. For
example, with the request saved in `qa-result.json`:

```sh
curl --fail-with-body "$T3_URL/api/qa/import" \
  -H "Authorization: Bearer $T3_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @qa-result.json
```

Store the token in your CI secret store. The environment must be reachable from
the runner. Imported results appear under CI results and in run history. They
do not mark the local checkout's inputs as current: CI and local execution may
use different files, dependencies, and target environments.

## Releases

Open **Releases** and choose a project to see what each app has right now: per
iOS and Android build, the store version and rollout, the OTA update on top of
it, and the tester build, plus approvals waiting in its pipeline and the version
deployed to each environment. Pick a release to highlight it and see which
builds carry it. The project list shows only projects with a `releases` command,
marks those with a rejected store review, and opens on the first; with none set
up, it shows every project. On mobile,
Releases is in the navigation overflow. Web and desktop also offer **Open Releases** in the command
palette and the configurable `releases.open` keyboard command.

The project supplies this status itself. Add a command to its `t3.json` that
prints a release status document as JSON on stdout:

```json
{
  "releases": {
    "command": "yarn --silent release:status --json",
    "refreshMinutes": 15
  }
}
```

The document format is `ReleaseStatusDocument` in
[`packages/contracts/src/releases.ts`](../../packages/contracts/src/releases.ts):
releases per environment, pipeline gates, targets with their store binaries and
OTA channel, and deployed services. Set a binary's `store` (`app-store`,
`testflight`, `play`, `firebase` or `direct`) to show its store icon. Set its
`review` (`waiting`, `in-review`, `approved` or `rejected`, with an optional
`message`) when the store reports one; Google Play does not expose review state
to its API. The Apps
table nests targets by `group` (the app), `name` (the build) and an optional
`variant`, such as managed or in-app, with a row per platform. List each app in
`groups` with its store `name` and an `icon`: a small PNG, JPEG or WebP copy of
the app icon (at most 16 KB, such as 96 px), relative to `t3.json`. An icon that
is missing, too large or not one of those formats is skipped. A source the command cannot read goes in `sources`
with its error, so the rest still shows.

The command runs in the project root (or `cwd`) on the environment, with the
same shell as QA suites, so it can read credentials from files there. You can
also enter its credentials (CircleCI and Expo tokens, App Store Connect and
Google Play keys) under **Settings → Projects → Releases**, or with
**Credentials** on the Releases page. They apply to every checkout of the same
repository on that environment, and tokens can come from a secret provider.
Saving or removing one runs the command again and shows what each source
reported under the fields, so a rejected token shows up there. While any
client is connected, T3 Code runs it in the background once the last result is
older than `refreshMinutes` (default 15), whether or not Releases is open;
**Refresh** runs it immediately. If a run fails,
the page keeps the last status and shows the error.

**Apps** shows a build that is waiting for review, in review, approved or
rejected under the live store build. A rejected review is listed in **Waiting on
you** with the store's message and puts a badge on **Releases** in the sidebar
and on the mobile tab bar (on **Settings** while Releases is in the overflow).
The badge clears when the store state changes, such as after you resubmit.

**Waiting on you** lists pipeline approvals, failed steps, rejected store
reviews, builds left on an internal or testing track, paused store rollouts, and
live OTA updates of the
current prod release whose runtime no public build has. An OTA update only reaches installs of a binary with the
same runtime, so an update live at 100% on a runtime that is only in TestFlight
reaches testers only. Each live OTA update says who it reaches: **Reaches
users**, **Testers only**, **Reaches no one**, or **Store build is newer** when
the public store build already supersedes it. When no build reports its
runtime, the line shows no reach and a note under **Apps** says so. Releases is read-only: approve, promote, or roll back in
your pipeline, store console, or release tooling. Agents can read the same
status with the `t3_releases` tool.

## Worktree branch names

In **Settings → Worktrees → Worktree branch naming**, choose a static prefix,
a model-selected semantic prefix such as `feat/` or `fix/`, or custom instructions
for the complete name. The static prefix defaults to `t3/`; a trailing slash is
optional, and an empty prefix adds nothing. Invalid characters in a static prefix
are replaced with hyphens. Custom instructions are appended to
the naming prompt and can specify issue IDs, namespaces, and casing.

These settings apply to automatically named new worktree branches. Select a project
to override its environment defaults. Worktree directories keep their original names.
If generation fails, or a custom name is invalid or already taken, the temporary
branch name remains.

## Scheduled tasks on mobile

Open **Settings → Scheduled tasks** to create scheduled tasks or manage existing
ones across your connected environments. Use the settings filter to narrow the
list by environment or project. Each task runs on the environment you choose,
using its project, model, and workspace settings. Fixed-time schedules use that
environment's time zone, which may differ from your phone's. Choose **Once**
to run a task a single time at a date and time in your own time zone. If the
environment is offline then, the task runs when it is back.

Under **Destination**, choose where runs go. **New thread each run** keeps every
run separate. The two one-thread choices start a thread on the first run and post
later runs there: one continues the same conversation, the other starts each run
in a fresh session that doesn't see earlier runs, so the thread stays readable
without the agent's context growing. To move a one-thread task, pick another
thread in its project under **Destination**. Moving such a task to another
project starts a new thread there on its next run.

Deleting a thread also deletes tasks that post into that thread. Tasks that start
a new thread on each run survive deletion of their previous threads.

You can edit, pause, resume, run immediately, or delete a task from the list.
Webhook tasks only run when their URL is called, so they can't be run
immediately.
Leaving an edited form asks before discarding unsaved changes.

## Webhook automations

In **Settings → Scheduled tasks**, choose **On webhook**
as a task's schedule to run it whenever another service calls its URL, such as
GitHub on a new pull request or a CI job that failed. A public URL needs a
[T3 Connect](remote-access.md) managed tunnel; after you save the task, copy
its URL from the editor. Without one, the editor shows only the URL's path.
**Rotate** replaces the URL and the old one stops working.

The prompt decides what the agent sees. Placeholders pull values out of the
request: `{{body.path}}` for a JSON or form field, `{{headers.name}}`,
`{{query.name}}`, `{{body}}` for the raw body, and `{{request}}` for everything.
For example, `Review this PR: {{body.pull_request.html_url}}` sends only the
pull request link. A placeholder with no value is left empty.

Each value reaches the agent wrapped in `<webhook-data-…>` tags and marked as
untrusted request data. This helps the agent tell it apart from your
instructions, but it doesn't guarantee the agent ignores what the text says.
Inside a value, every `$`, other currency sign and `@`, and a `/` that starts
a lone word, gets an invisible character after it, so mentions like `$skill`,
`@file` and `/command` don't act. Text copied from a value, such as an email
address or a command, carries that character too. Without a signature, anyone
with the URL can start a run with any content. A signature only proves which
service sent the request: a GitHub payload still carries text written by any
GitHub user.

For GitHub, turn on **Require signature**, keep the header
`x-hub-signature-256`, hex encoding and the `sha256=` prefix, and enter the
same secret in the repository's webhook settings with content type
`application/json`. Requests without a valid signature are rejected. Set this
up on desktop or web; mobile keeps an existing signature check but can't turn
one on.

To run only for some requests, add **Filters**. Each one tests a value named
like a placeholder, without the braces, such as `headers.x-github-event` equals
`pull_request` or `body.action` is one of `opened, reopened`. A task runs only
when every filter matches; other requests are answered normally, logged as
**Filtered** with the first filter that failed, and start nothing. Values
compare as text, and a value that is an object or a list only passes
**exists**. Separate **is one of** values with commas; a value can't contain
a comma or start or end with a space.

To suppress repeated deliveries, set a **Duplicate request key** template, such as
`{{headers.delivery-id}}`. The same key is ignored for seven days per task.
To combine a burst, set a **Coalesce key**, such as `{{body.id}}`, and a window
of 10–3600 seconds (120 by default). One run uses the latest body, headers,
and query when the window from the first delivery closes; later requests
do not extend it. Pending windows survive a server restart. Keys must contain
request placeholders; if any placeholder is missing, or the render is empty,
that key's rule is skipped. Clear the templates to turn dedupe off.

Duplicate and coalesced log entries share a limit of 10 per task per minute.
Additional deliveries are accepted without a log entry, and coalesced deliveries
always replace the persisted payload. Coalesced updates count toward a separate
60-per-minute validation limit; exceeding it receives HTTP 429.

On desktop and web, pick **Deliveries** from a task's menu to see recent
requests and the prompt each one produced.

If the environment is offline, the sender gets an error and nothing runs;
redeliver from the sender, such as GitHub's **Recent Deliveries**, once it is
back. To have T3 Connect keep requests instead, turn on **Hold webhooks while
offline** in **Settings → Sharing & access**. T3 Connect then stores requests to a
T3 Connect URL for up to 24 hours and delivers them when the environment
returns. Leave it off if you don't want request bodies stored outside your
machine. To skip requests that waited too long, set **Skip requests older
than** on the task.

## Defaults and inheritance

Threads contains the model and workspace for new threads. Browser controls agent browser
access. Source control contains automatic pull, the default pull request merge method and text
generation. The same rows edit environment defaults or project overrides depending on the
project crumb.

The Projects category, under Code, holds the project's name, icon, actions,
checkouts and removal. Actions belong to a project: editing them creates the project's own list
on each selected environment, and reset returns to the environment's shared list. A project's
`t3.json` actions can be imported there.

Settings a repository can also declare in `t3.json`, such as the workspace for new threads,
resolve in one order: a project override, then the environment setting, then `t3.json`, then the
built-in default. Leave a setting on **Inherit** to let the next tier decide.
Browser access changes apply when an agent session next starts.

New worktrees initialize git submodules recursively. If that step is slow because the repository
declares many nested submodules, set **Submodules** in **Settings → Worktrees** under Advanced (with the project
selected to override it there) to **Top level only** to stop at the ones the repository declares
itself, or **Skip** to leave them for a setup script. It resolves in the same order as the
workspace default: a `"worktreeSubmodules"` value in the `t3.json` of the branch being checked out
applies when the project and environment are both on **Inherit**.

## Worktree location

New worktrees go in the `worktrees` folder of the T3 home directory. To put them somewhere else,
such as another drive, set **Settings → Worktrees → Worktree location** to an absolute path like
`D:\worktrees` or `~/worktrees`. The setting is per machine. Existing worktrees stay where they
are, and cleanup covers both the default folder and the custom one.

## Fast worktree checkout on macOS

Fast worktree checkout is a beta. Turn it on for each Mac in **Settings → Labs → Fast worktree
checkout**. T3 Code then keeps a few recent checkouts of each repository in the `caches` folder of
the T3 home directory. A new worktree is cloned from one of them with APFS copy-on-write, which is
about twice as fast as writing every file and makes the first `git status` in it fast as well.
Turning it off deletes the cache.

The first worktree of a repository uses Git's normal checkout and fills the cache. It needs Git 2.42
or newer. Git's normal checkout is also used for worktrees on a different drive from the T3 home
directory, sparse checkouts, repositories whose attributes use filters such as Git LFS, and
repositories whose checkout settings changed.

## Storage cleanup

Open **Settings → Worktrees → Cleanup** to enable automatic cleanup on one machine or all connected
environments. Policies are off by default and run on the server at startup, when changed, and
hourly. Offline machines keep their existing policies.

Select a project to set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.
Inherit follows each machine's rules; Off keeps that project's worktrees until you remove them
manually. Custom applies separate worktree rules to the selected project or checkout. Browser
captures and log retention remain machine-wide.

Worktrees can be removed after a chosen number of inactive days, after a thread settles, after
merging, or when they have no commits beyond the default branch. Set settled retention to 0 days
to remove a worktree at the next cleanup after settlement. In repositories without remotes,
unchanged-worktree cleanup compares against the branch checked out in the project workspace;
if that checkout has a detached HEAD, the worktree is kept. Only T3-managed worktrees are eligible.
Active sessions and shared worktrees prevent removal. **Keep worktrees with local changes** defaults
to **Uncommitted changes**, which protects tracked edits and untracked files but deletes ignored
files such as `.env` and build output. **Any local files** also protects ignored files other than
`node_modules`. **Edited tracked files** protects only tracked edits and allows untracked and
ignored files to be deleted. Branches and thread history stay; starting another turn recreates the checkout.
Merge cleanup requires a merged pull request whose commits are included in the remote default
branch. A squash or rebase merge on GitHub also counts when the pull request targeted the default
branch and the worktree is still at the pull request's last commit.

Enable **Delete worktrees with deleted threads** to remove safe worktrees after their last
thread is deleted, including archived threads and worktrees left by earlier deletions. The
server waits for sessions and terminals to stop and retries skipped worktrees after restart.
Existing prompts for deleting a worktree manually remain available when this policy is off.

Choose **Delete now** to run the enabled rules immediately. The latest results show which
worktrees were removed or kept and why, plus any failures.
Results also list folders in the worktree folder that no thread uses, with their sizes; cleanup never removes them, so remove them manually if you want.

Browser captures and rotated logs have separate retention periods. Expired capture links stop
working. Current logs, message attachments, and browser profiles are kept.

## Project icons

Select the project and open Project to choose an icon, emoji, monogram, or image. The choice applies to
every checkout in the project group and appears on connected clients. Choose **Automatic** to let
T3 Code detect an icon again.

Choose **Monogram** in the icon picker to set one or two letters or numbers and a color.

When no image is found, web and desktop show a two-character monogram with a color
from the icon palette, derived from the saved project name. For example, `Nebula` becomes `NA`,
`Silver Orchard` becomes `SO`, and `M7 Forge` becomes `M7`.

## Keep the default branch current

In Source control, enable **Automatically pull** to keep the default-branch checkout up to date
with its configured upstream. Choose an environment to set the default or a project to override it.
On mobile, use **Settings → Source control** to change selected environment defaults or project overrides.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume.
