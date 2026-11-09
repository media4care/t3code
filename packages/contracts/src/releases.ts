import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const Text = Schema.String.check(Schema.isMaxLength(4000));
const Url = TrimmedNonEmptyString.check(Schema.isMaxLength(2048), Schema.isPattern(/^https?:\/\//));
const Percent = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(100),
);
const RelativePath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^(?!\/|[A-Za-z]:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\*?[\]{}\x00]+$/),
);

/** The `releases` section of a project's `t3.json`. */
export const ReleasesConfiguration = Schema.Struct({
  /** Prints a `ReleaseStatusDocument` as JSON on stdout. */
  command: TrimmedNonEmptyString.check(Schema.isMaxLength(8000)),
  cwd: Schema.optionalKey(RelativePath),
  /** How old a document may get before an open Releases page refreshes it. */
  refreshMinutes: Schema.optionalKey(
    Schema.Number.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(1440)),
  ),
});
export type ReleasesConfiguration = typeof ReleasesConfiguration.Type;

export const RELEASES_DEFAULT_REFRESH_MINUTES = 15;
export const RELEASE_ICON_MAX_BYTES = 16 * 1024;
const RELEASE_ICON_DATA_URL_MAX = Math.ceil(RELEASE_ICON_MAX_BYTES / 3) * 4 + 64;

export const ReleaseSource = Schema.Struct({
  id: ShortText,
  name: ShortText,
  status: Schema.Literals(["ok", "error", "unconfigured"]),
  message: Schema.optionalKey(Text),
  fetchedAt: Schema.optionalKey(IsoDateTime),
});
export type ReleaseSource = typeof ReleaseSource.Type;

/** A version that exists in an environment, newest first per environment. */
export const ReleaseVersion = Schema.Struct({
  version: ShortText,
  environment: ShortText,
  ref: Schema.optionalKey(ShortText),
  commit: Schema.optionalKey(ShortText),
  createdAt: Schema.optionalKey(IsoDateTime),
  url: Schema.optionalKey(Url),
});
export type ReleaseVersion = typeof ReleaseVersion.Type;

export const ReleaseUnreleased = Schema.Struct({
  since: ShortText,
  commits: NonNegativeInt,
  url: Schema.optionalKey(Url),
});

export const ReleaseGateStepState = Schema.Literals([
  "done",
  "running",
  "waiting",
  "failed",
  "pending",
  "skipped",
]);
export type ReleaseGateStepState = typeof ReleaseGateStepState.Type;

/** A pipeline's approval chain; `waiting` marks a step someone has to approve. */
export const ReleaseGate = Schema.Struct({
  id: ShortText,
  name: ShortText,
  version: ShortText,
  url: Schema.optionalKey(Url),
  steps: Schema.Array(
    Schema.Struct({
      label: ShortText,
      state: ReleaseGateStepState,
      since: Schema.optionalKey(IsoDateTime),
      url: Schema.optionalKey(Url),
    }),
  ).check(Schema.isMaxLength(40)),
});
export type ReleaseGate = typeof ReleaseGate.Type;

/** Who can install a binary: everyone, enrolled testers, or the team's internal track. */
export const ReleaseAudience = Schema.Literals(["public", "testers", "internal"]);
export type ReleaseAudience = typeof ReleaseAudience.Type;

export const ReleaseRolloutState = Schema.Literals([
  "draft",
  "active",
  "paused",
  "halted",
  "completed",
]);
export type ReleaseRolloutState = typeof ReleaseRolloutState.Type;

/** Where a binary is distributed; `direct` covers downloads outside any store. */
export const ReleaseStore = Schema.Literals([
  "app-store",
  "testflight",
  "play",
  "firebase",
  "direct",
]);
export type ReleaseStore = typeof ReleaseStore.Type;

export const ReleaseBinary = Schema.Struct({
  /** Where it is installed from, such as "Play production" or "TestFlight". */
  label: ShortText,
  store: Schema.optionalKey(ReleaseStore),
  audience: ReleaseAudience,
  version: ShortText,
  build: Schema.optionalKey(ShortText),
  /** The OTA runtime baked into the binary; updates only reach binaries with the same one. */
  runtime: Schema.optionalKey(ShortText),
  rollout: Schema.optionalKey(Schema.Struct({ percent: Percent, state: ReleaseRolloutState })),
  updatedAt: Schema.optionalKey(IsoDateTime),
  url: Schema.optionalKey(Url),
});
export type ReleaseBinary = typeof ReleaseBinary.Type;

export const ReleaseOtaUpdate = Schema.Struct({
  version: ShortText,
  runtime: ShortText,
  percent: Percent,
  group: Schema.optionalKey(ShortText),
  publishedAt: Schema.optionalKey(IsoDateTime),
  url: Schema.optionalKey(Url),
});
export type ReleaseOtaUpdate = typeof ReleaseOtaUpdate.Type;

/** One installable app variant, with its store binaries and its OTA channel. */
export const ReleaseTarget = Schema.Struct({
  id: ShortText,
  /** The app, matching a `groups` entry for its store name and icon. */
  group: ShortText,
  /** Parts joined by " · "; targets sharing binaries merge and keep the parts that differ. */
  detail: Schema.optionalKey(ShortText),
  /** The build within the app, such as "swOnly"; `platform` says which platform. */
  name: ShortText,
  /** Splits a build's platforms, such as "managed" or "in-app". */
  variant: Schema.optionalKey(ShortText),
  platform: Schema.optionalKey(Schema.Literals(["android", "ios", "web"])),
  binaries: Schema.Array(ReleaseBinary).check(Schema.isMaxLength(40)),
  ota: Schema.optionalKey(
    Schema.Struct({
      channel: ShortText,
      live: Schema.optionalKey(ReleaseOtaUpdate),
      preview: Schema.optionalKey(ReleaseOtaUpdate),
    }),
  ),
});
export type ReleaseTarget = typeof ReleaseTarget.Type;

export const ReleaseDeploymentState = Schema.Literals([
  "deployed",
  "waiting",
  "running",
  "failed",
  "retired",
]);
export type ReleaseDeploymentState = typeof ReleaseDeploymentState.Type;

const ReleaseDeploymentChange = Schema.Struct({
  version: ShortText,
  state: ReleaseDeploymentState,
  url: Schema.optionalKey(Url),
});

/** A service deployed per environment, such as a backend on ECS or a web app on S3. */
export const ReleaseService = Schema.Struct({
  id: ShortText,
  name: ShortText,
  host: Schema.optionalKey(ShortText),
  deployments: Schema.Array(
    Schema.Struct({
      environment: ShortText,
      version: Schema.optionalKey(ShortText),
      state: ReleaseDeploymentState,
      at: Schema.optionalKey(IsoDateTime),
      url: Schema.optionalKey(Url),
      /** A newer version that has not replaced `version` yet. */
      pending: Schema.optionalKey(ReleaseDeploymentChange),
    }),
  ).check(Schema.isMaxLength(20)),
});
export type ReleaseService = typeof ReleaseService.Type;

export const ReleaseGroup = Schema.Struct({
  id: ShortText,
  /** The app's store name, shown instead of the group id. */
  name: Schema.optionalKey(ShortText),
  /** A PNG, JPEG or WebP file of at most 16 KB, relative to the folder holding `t3.json`. */
  icon: Schema.optionalKey(RelativePath),
});
export type ReleaseGroup = typeof ReleaseGroup.Type;

/** What a project's release command prints. */
export const ReleaseStatusDocument = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  generatedAt: IsoDateTime,
  title: Schema.optionalKey(ShortText),
  groups: Schema.optionalKey(Schema.Array(ReleaseGroup).check(Schema.isMaxLength(50))),
  sources: Schema.Array(ReleaseSource).check(Schema.isMaxLength(20)),
  releases: Schema.Array(ReleaseVersion).check(Schema.isMaxLength(100)),
  unreleased: Schema.optionalKey(ReleaseUnreleased),
  gates: Schema.Array(ReleaseGate).check(Schema.isMaxLength(100)),
  targets: Schema.Array(ReleaseTarget).check(Schema.isMaxLength(300)),
  services: Schema.Array(ReleaseService).check(Schema.isMaxLength(100)),
});
export type ReleaseStatusDocument = typeof ReleaseStatusDocument.Type;

export const ReleasesSnapshot = Schema.Struct({
  configured: Schema.Boolean,
  /** The `releaseEnvironments` setting the command runs with; clones of one repository share it. */
  environmentKey: TrimmedNonEmptyString,
  configurationError: Schema.NullOr(Schema.String),
  refreshMinutes: Schema.Number,
  running: Schema.Boolean,
  lastRun: Schema.NullOr(
    Schema.Struct({
      startedAt: IsoDateTime,
      finishedAt: IsoDateTime,
      error: Schema.NullOr(Schema.String),
    }),
  ),
  /** The last document the command produced, kept when a later run fails. */
  document: Schema.NullOr(ReleaseStatusDocument),
  /** Group icons from `groups`, as data URLs by group id. */
  icons: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.String.check(Schema.isMaxLength(RELEASE_ICON_DATA_URL_MAX)),
    ),
  ),
});
export type ReleasesSnapshot = typeof ReleasesSnapshot.Type;

export const ReleasesProjectInput = Schema.Struct({ projectId: ProjectId });
export type ReleasesProjectInput = typeof ReleasesProjectInput.Type;
export const ReleasesRefreshInput = Schema.Struct({
  projectId: ProjectId,
  /** Without it, a document younger than the configured refresh interval is kept. */
  force: Schema.optionalKey(Schema.Boolean),
});
export type ReleasesRefreshInput = typeof ReleasesRefreshInput.Type;

export class ReleasesError extends Schema.TaggedError<ReleasesError>()("ReleasesError", {
  reason: Schema.Literals(["project-not-found", "workspace", "not-configured"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "project-not-found":
        return "The project no longer exists.";
      case "workspace":
        return "The project folder could not be opened.";
      case "not-configured":
        return 'This project has no "releases" command in t3.json.';
    }
  }
}
