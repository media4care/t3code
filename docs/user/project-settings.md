# Settings and project overrides

T3 Code separates **device preferences** (saved locally per browser/device, like Appearance and Confirmations) from **server settings** (stored on each environment, like Threads, Worktrees, and Source control).

## Scope and inheritance

Use the **"Applying settings for …"** selector at the top of Settings (web/desktop) or the header filter (mobile) to choose which **environment(s)** and **project** you are editing:

- **All environments**: Bulk-edits every currently connected environment (offline environments keep their values). Controls show **Mixed** where environments disagree.
- **Project scope**: Creates a project override for that setting without changing environment defaults. Settings that cannot be overridden appear read-only.
- **Inheritance order**: `Project override` → `Environment setting` → `t3.json` in the repo → `Built-in default`. Leave a setting on **Inherit** to defer to the next tier.
- Click the **layers icon** beside a server setting to inspect its inheritance chain, jump to overriding projects, or **Reset all** back to the environment default.
- **Per-project providers**: With a project selected in **Settings → Providers**, toggling a provider enables or disables it for that project only (in either direction). Running turns finish; no new turns start on a disabled provider.

## Pin and archive projects

- **Pin**: Pinned projects sort first in project pickers, the command palette, the sidebar filter, and mobile (`mod+shift+p` on a highlighted row, or **Settings → Projects**).
- **Pinned projects section**: The sidebar, and the thread list on mobile, also list pinned projects in a collapsible **Pinned projects** section. Click or tap a project to show only its threads, do it again to show all projects, and use its pen button to start a thread there. In the boring sidebar, pinned projects get the top folders instead, even with no active threads.
- **Archive**: Archive finished projects in **Settings → Projects** (mobile: **Settings → Projects → Organize**). Archived projects leave pickers while keeping their threads, settings, and files; unarchive anytime from Settings.
- Pinning or archiving a project that exists on multiple machines requires all of those machines to be connected.

## Project icons and multi-repo projects

- **Icons**: In **Settings → Projects**, set an icon, emoji, monogram, or image (applies across checkouts). Without one, T3 Code generates a two-character monogram (or single CJK character) from the project name.
- **Multiple repositories**: See [Projects with several repositories](./multi-repo-projects.md).

## QA test suites

Open **QA** and choose a repository to run its test suites and inspect previous runs.
Clones and worktrees of one remote share their QA, so a repository appears once per
environment. For a fork, that is its `origin`, not the upstream it tracks. Only
environments with **Run QA here** on list their repositories.
On mobile, QA is in the tab bar; use **Settings → Navigation** to reorder it. Web and desktop also offer **Open QA** in the command
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
To group suites by the apps you ship, list them in `qa.apps` and name them on each suite:

```json
{
  "qa": {
    "apps": [{ "id": "web", "name": "Storefront", "icon": "web/public/icon.png" }],
    "suites": [{ "id": "web-e2e", "apps": ["web"], "...": "..." }]
  }
}
```

An `icon` is a PNG, JPEG or WebP file of at most 16 KB, relative to `t3.json`. Each app
gets its own group, suites that test several apps share one, and suites without an app
go under **Other**. Without apps, suites are grouped by component. **On the latest
commit** sums up each app, and **Needs attention** lists failed suites and devices,
ones that could not run, and passed ones whose inputs changed. Search the catalog,
switch to test-type groups, or filter suites by their latest result. Open a suite's row
for its devices, failure output, freshness and command.

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
client does not stop it. While a suite runs, its card lists the run's steps, with
the current one marked, and follows the newest output, setup script included;
**View run** shows the whole log. Cancel stops the command and its
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
default `any`), a `defaultDevice` name such as an AVD name, an `id`, and `os`, the
major OS versions it must run, such as `["13", "15"]`. Up to twelve
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

A suite with several devices can run each device on its own with `"runPer": "device"`.
**Run all** then runs the command once per device, one after another in the order of
`devices`, each with only that device and its variables. A device that fails or isn't
available doesn't stop the next one. The other devices' `T3_QA_DEVICE_ID_<ID>` are unset,
so the command must cope with them being empty.

To also run each device in several ways, such as with and without hardware, add
`variants`. Each runs on every device, or only on the device `id`s it lists, and the
command reads its `id` from `T3_QA_VARIANT`:

```json
{
  "runPer": "device",
  "devices": [
    { "id": "tablet", "platform": "android", "formFactor": "tablet" },
    { "id": "ios", "platform": "ios", "formFactor": "tablet" }
  ],
  "variants": [
    { "id": "swOnly", "name": "SW only" },
    { "id": "swAndHw", "name": "SW + HW", "devices": ["tablet"] }
  ]
}
```

Each device with `os` runs once per version, such as on Android 13 and on Android 15;
QA picks a device on that version. The suite lists each device and version under its
variant, with the device it ran on and whether that was an emulator, a simulator or a
physical device. Each keeps its own result and output. Rerun one with its button, or
select several and run them with the suite's **Run** button. Each app also shows the OS
versions its suites ran on, with the latest result on virtual and physical devices,
including runs on devices someone chose by hand.

To let [Simlock](https://incubator.callstack.com/simlock/) hand out the devices, run a
Simlock worker on the QA machine and set **Settings → Devices → QA → QA devices** to
**Simlock on this machine**. T3 Code does not install Simlock; the `simlock` command
must be on the server's `PATH`. Each run then leases its devices with
`simlock --local lease`, using the requirement's `platform`, its `defaultDevice` as the
model or else its `formFactor` as the class, and `--physical` for a `physical` type.
Simlock queues the request while every device is busy, for up to 30 minutes. Simlock
cannot lease by OS version, so a device with `os` that Simlock leases on another
version is recorded as not run; use this machine's devices for those. The run
returns its devices when it ends, and Simlock wipes them. Commands receive the same
variables, with the simulator's UDID or the emulator's serial as the device ID, plus
the variables Simlock provides, such as `SIMLOCK_IOS_DEVICE_SET`. Simlock keeps its
simulators in that device set, so pass it to tools that look for simulators, for
example `xcrun simctl --set "$SIMLOCK_IOS_DEVICE_SET"`. The device pool and per-suite
device choices do not apply in this mode. If Simlock is missing or cannot lease a
device, the run is recorded as not run with Simlock's reason.

On web and desktop, QA's device inventory shows the selected machine's enrolled
devices and Android connections, including unauthorized and offline devices.
Unlock an unauthorized device and accept its USB debugging prompt; a connected
device must also be enrolled before Simlock can lease it. Refresh after fixing a
connection. The collapsed model catalogue describes simulators and emulators
that can be created; it is separate from device instances and deleted history.

**Run affected suites** rechecks freshness and runs changed, expired, unknown,
untested, and unsuccessful suites sequentially on the selected environment.
Closing the client leaves the queue running. **Stop queued run** cancels the active
command and clears the queue; cancelling its active suite also stops the queue.
A server restart interrupts the active run and discards pending suites, which stay
eligible for a rerun. Recurring schedules are not configured by this action.

To run tests regularly, use **Recurring runs → Add schedule** in QA. Choose all
suites, affected suites, or one suite, then set an interval or a time and weekdays.
Turn on **Physical devices only** to leave out every run that would use an emulator
or simulator: a suite run per device keeps the devices marked `"type": "physical"`,
and a suite that needs any other device is skipped. Suites without devices still run.
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
up, it shows every project. Releases is at the top of **Settings** on web and
desktop, and in the navigation overflow on mobile. Web and desktop also offer
**Open Releases** in the command palette and the configurable `releases.open`
keyboard command.

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
you** with the store's message and puts a badge on **Settings** in the sidebar
and on the mobile tab bar (on Releases itself when it has its own mobile tab).
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

## Worktree settings

Configure worktrees in **Settings → Worktrees** (environment default or project override):

- **Branch naming**: Choose a static prefix (default `t3/`), model-selected semantic prefix (`feat/`, `fix/`), or custom instructions. Falls back to the temporary branch name if generation fails or collides.
- **Submodules** (under Advanced): Defaults to recursive checkout; set to **Top level only** or **Skip** (or `"worktreeSubmodules"` in `t3.json`) for repos with heavy nested submodules.
- **Sparse checkout**: Set `"worktreeSparsePatternsPath"` in `t3.json` to a repo-relative file of Git sparse-checkout patterns (non-cone syntax; requires Git 2.35+; enables `extensions.worktreeConfig`). Set Submodules to **Skip** if you don't want submodules initialized under excluded paths.
- **Worktree location** (per machine): Set an absolute path (e.g. `D:\worktrees` or `~/worktrees`) to store new worktrees elsewhere. Existing worktrees stay where they are; cleanup covers both folders.
- **Fast worktree checkout (macOS beta)**: Enable **Settings → Labs → Fast worktree checkout** (Git 2.42+) to clone new worktrees via APFS copy-on-write from a local cache. Falls back to normal checkout for cross-drive paths, sparse checkouts, or Git LFS/filter repos.

### Storage cleanup

Enable automatic cleanup in **Settings → Worktrees → Cleanup** (off by default; runs on startup, on change, and hourly). Projects can set **Automatic worktree cleanup** to **Inherit**, **Off**, or **Custom**.

- **Triggers**: Inactive days, days after settlement (`0` = next cleanup), merged PRs (including GitHub squash/rebase merges into the default branch), or settled/archived threads with no commits beyond the default branch.
- **Safety**: Active sessions and shared worktrees are never removed. **Keep worktrees with local changes** defaults to **Uncommitted changes** (protects tracked edits and untracked files; removes ignored files like `.env`/build output). Choose **Any local files** (also protects ignored files except `node_modules`) or **Edited tracked files** (protects tracked edits only).
- **Delete with deleted threads**: Enable **Delete worktrees with deleted threads** to automatically clean up safe worktrees once their last thread is deleted.
- **Scratch folders**: Inactive and settled rules also apply to [no-project scratch folders](./thread-sidebar.md#start-without-a-project) (skipped if they contain a Git repo or enabled scheduled task). Because scratch files aren't in Git, deleted files cannot be recovered.
- **Manual run**: Click **Delete now** to run rules immediately and inspect what was removed, kept, or orphaned (untracked folders are listed but never auto-deleted).
- **Captures and logs**: Browser captures and rotated logs have separate machine-wide retention periods.

## Keep the default branch current

Enable **Settings → Source control & issues → Automatically pull** to fast-forward clean default-branch checkouts from their configured upstream. Skips checkouts with local changes, untracked files, local commits, other branches, or no upstream.

## Scheduled tasks and webhooks

Create and manage scheduled tasks in **Settings → Scheduled tasks** (web, desktop, and mobile).

- **Schedules**: Recurring fixed-time schedules use the target environment's time zone. **Once** uses your local time zone (runs on reconnect if offline).
- **Destination**: Choose **New thread each run**, **One thread (continue conversation)**, or **One thread (fresh session each run)**. Deleting a target thread deletes tasks bound to it; archiving a target thread causes runs to fail (settle it instead).
- **Controls**: Edit, pause, resume, run now (except webhook tasks), or delete from the list.

### Webhook automations

Choose **On webhook** as a task's schedule to trigger runs from external services (e.g., GitHub PR or CI events). A public URL requires a [T3 Connect](./remote-access.md) tunnel; click **Rotate** to invalidate and replace the URL.

- **Prompt placeholders**: Insert `{{body.path}}`, `{{headers.name}}`, `{{query.name}}`, `{{body}}`, or `{{request}}`. Missing values render empty.
- **Untrusted input protection**: Placeholder values are wrapped in `<webhook-data-…>` tags, and `$`/`@`/leading `/` tokens are neutralized so untrusted payloads can't invoke skills or commands.
- **Signatures** (web/desktop setup): Enable **Require signature** to verify HMAC signatures (for GitHub, keep `x-hub-signature-256`, hex, and `sha256=` prefix with the same secret and `application/json`).
- **Filters**: Add conditions (using paths without braces, e.g. `headers.x-github-event` equals `pull_request`, or `body.action` is one of `opened, reopened`). All filters must match; non-matching requests are logged as **Filtered**.
- **Deduplication & coalescing**: Set a **Duplicate request key** (e.g. `{{headers.delivery-id}}`; ignores repeats for 7 days) or a **Coalesce key** with a 10–3600s window (default 120s; runs once with the latest payload when the window closes). Coalesced updates are rate-limited to 60/min (`HTTP 429`).
- **Offline delivery**: By default, offline environments return an error. Enable **Settings → Sharing & access → Hold webhooks while offline** to buffer T3 Connect webhooks for up to 24 hours, and optionally set **Skip requests older than** on the task.
- **Debugging**: Open **Deliveries** from a task's menu (web/desktop) to inspect recent payloads and rendered prompts.
