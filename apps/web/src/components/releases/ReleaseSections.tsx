import type {
  ReleaseBinary,
  ReleaseGate,
  ReleaseReview,
  ReleaseService,
  ReleaseStatusDocument,
  ReleaseStore,
} from "@t3tools/contracts";
import {
  releaseAge,
  RELEASE_REACH,
  RELEASE_REVIEW,
  type ReleaseApp,
  type ReleaseAppRow,
  type ReleaseAttention,
  type ReleasePlatformSummary,
  type ReleaseTone,
} from "@t3tools/client-runtime/releases";
import { CloudDownloadIcon, ExternalLinkIcon, GlobeIcon, SmartphoneIcon } from "lucide-react";
import { Fragment, type ComponentType, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import {
  AndroidIcon,
  AppleIcon,
  AppStoreIcon,
  FirebaseIcon,
  GooglePlayIcon,
  TestFlightIcon,
} from "../Icons";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const TONE_TEXT: Record<ReleaseTone, string> = {
  ok: "text-success-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive-foreground",
  muted: "text-muted-foreground",
};
const EMPTY = "–";
const TONE_DOT = {
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-destructive",
} as const;

function Section(props: { title: string; meta?: ReactNode; count?: number; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold">{props.title}</h3>
        {props.count ? (
          <span className="rounded-full bg-warning/10 px-1.5 text-xs text-warning-foreground">
            {props.count}
          </span>
        ) : null}
        {props.meta ? (
          <span className="ml-auto text-xs text-muted-foreground">{props.meta}</span>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {props.children}
      </div>
    </section>
  );
}

function ExternalLink(props: { href: string | undefined; children: ReactNode }) {
  if (!props.href) return <>{props.children}</>;
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 hover:underline"
    >
      {props.children}
      <ExternalLinkIcon className="size-3 shrink-0 opacity-60" />
    </a>
  );
}

export function ReleaseAttentionList(props: {
  items: ReadonlyArray<ReleaseAttention>;
  now: number;
}) {
  if (props.items.length === 0) return null;
  return (
    <Section title="Waiting on you" count={props.items.length}>
      <ul className="divide-y divide-border">
        {props.items.map((item) => {
          const age = releaseAge(item.since, props.now);
          return (
            <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TONE_DOT[item.tone])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  <ExternalLink href={item.url}>{item.title}</ExternalLink>
                  <span className="ml-2 text-3xs font-medium tracking-wide text-muted-foreground uppercase">
                    {item.source}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.detail}
                  {age ? ` · ${age} ago` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const STEP_STYLES = {
  done: "bg-success/15 text-success-foreground",
  running: "bg-info/15 text-info-foreground",
  waiting: "border-warning/50 bg-warning/10 font-semibold text-warning-foreground",
  failed: "bg-destructive/15 text-destructive-foreground",
  pending: "border-dashed border-border text-muted-foreground",
  skipped: "text-muted-foreground line-through",
} as const;

export function ReleaseGateList(props: { gates: ReadonlyArray<ReleaseGate>; version: string }) {
  if (props.gates.length === 0) return null;
  return (
    <Section title="Rollout gates" meta={`Pipeline for ${props.version}`}>
      <ul className="divide-y divide-border">
        {props.gates.map((gate) => (
          <li key={gate.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
            <span className="w-40 shrink-0 text-sm">
              <ExternalLink href={gate.url}>{gate.name}</ExternalLink>
            </span>
            <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {gate.steps.map((step, index) => (
                <li key={step.label} className="flex items-center gap-1">
                  {index > 0 ? <span aria-hidden className="h-px w-3 bg-border" /> : null}
                  <span
                    className={cn(
                      "rounded-full border border-transparent px-2 py-0.5 text-xs",
                      STEP_STYLES[step.state],
                    )}
                  >
                    {step.state === "waiting" ? `${step.label} · approve` : step.label}
                    <span className="sr-only"> ({step.state})</span>
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </Section>
  );
}

type IconComponent = ComponentType<{ className?: string }>;

const PLATFORM: Record<ReleasePlatformSummary["platform"], { label: string; icon: IconComponent }> =
  {
    ios: { label: "iOS", icon: AppleIcon },
    android: { label: "Android", icon: AndroidIcon },
    web: { label: "Web", icon: GlobeIcon },
  };

const STORE_ICON: Record<ReleaseStore, IconComponent> = {
  "app-store": AppStoreIcon,
  testflight: TestFlightIcon,
  play: GooglePlayIcon,
  firebase: FirebaseIcon,
  direct: CloudDownloadIcon,
};

function PlatformIcon(props: { platform: ReleaseAppRow["platform"]; className?: string }) {
  const Icon = props.platform ? PLATFORM[props.platform].icon : SmartphoneIcon;
  return <Icon className={cn("size-4 shrink-0", props.className)} />;
}

function StoreIcon(props: { binary: ReleaseBinary }) {
  const Icon = props.binary.store ? STORE_ICON[props.binary.store] : null;
  return Icon ? <Icon className="size-3.5 shrink-0" /> : null;
}

function Version(props: { version: string; selected: string }) {
  return (
    <span
      className={cn(
        "font-mono text-xs font-semibold",
        props.version === props.selected && "rounded bg-primary/15 px-1 text-primary",
      )}
    >
      {props.version}
    </span>
  );
}

function RolloutBar(props: { percent: number; tone: string }) {
  return (
    <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-muted-foreground/20">
      <span className={cn("block h-full", props.tone)} style={{ width: `${props.percent}%` }} />
    </span>
  );
}

function rolloutText(binary: ReleaseBinary) {
  const rollout = binary.rollout;
  if (!rollout || rollout.state === "completed") return `${rollout?.percent ?? 100}%`;
  if (rollout.state === "active") return `staged ${rollout.percent}%`;
  return `${rollout.state} ${rollout.percent}%`;
}

function ReviewLabel(props: { review: ReleaseReview }) {
  const status = RELEASE_REVIEW[props.review.state];
  if (!props.review.message) return <span className={TONE_TEXT[status.tone]}>{status.label}</span>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={TONE_TEXT[status.tone]} />}>
        {status.label}
      </TooltipTrigger>
      <TooltipPopup>{props.review.message}</TooltipPopup>
    </Tooltip>
  );
}

function ReviewEntry(props: {
  binary: ReleaseBinary;
  review: ReleaseReview;
  version: string;
  now: number;
}) {
  const { binary, review } = props;
  const age = releaseAge(review.since ?? binary.updatedAt, props.now);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
      <StoreIcon binary={binary} />
      <ExternalLink href={review.url ?? binary.url}>
        <Version version={binary.version} selected={props.version} />
      </ExternalLink>
      <span className="truncate">
        {binary.build && binary.build !== binary.version ? `(${binary.build}) ` : ""}
        <ReviewLabel review={review} />
        {age ? ` · ${age}` : ""}
      </span>
    </div>
  );
}

function StoreCell(props: { binary: ReleaseBinary | null; version: string; now: number }) {
  const binary = props.binary;
  if (!binary) return <span className="text-xs text-muted-foreground">{EMPTY}</span>;
  const percent = binary.audience === "public" ? (binary.rollout?.percent ?? 100) : null;
  const stopped = binary.rollout?.state === "paused" || binary.rollout?.state === "halted";
  const age = releaseAge(binary.updatedAt, props.now);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <StoreIcon binary={binary} />
        <ExternalLink href={binary.url}>
          <Version version={binary.version} selected={props.version} />
        </ExternalLink>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
        {percent !== null ? (
          <RolloutBar
            percent={percent}
            tone={stopped ? "bg-warning" : percent === 100 ? "bg-success" : "bg-info"}
          />
        ) : null}
        <span className="truncate">
          {binary.label}
          {percent !== null ? ` · ${rolloutText(binary)}` : ""}
          {binary.audience !== "public" && binary.build ? ` · ${binary.build}` : ""}
          {binary.review ? (
            <>
              {" · "}
              <ReviewLabel review={binary.review} />
            </>
          ) : null}
          {age ? ` · ${age}` : ""}
        </span>
      </div>
    </div>
  );
}

function OtaCell(props: { row: ReleaseAppRow; version: string }) {
  const { row } = props;
  if (row.ota.length === 0)
    return (
      <span className="text-xs text-muted-foreground">
        {row.hasOtaChannel ? "No live update" : EMPTY}
      </span>
    );
  const labelled = row.ota.some((lane) => lane.label);
  return (
    <div
      className={cn(
        "grid min-w-0 items-center gap-x-2 gap-y-1",
        labelled ? "grid-cols-[max-content_minmax(0,1fr)]" : "grid-cols-1",
      )}
    >
      {row.ota.map((lane) => {
        // Unknown reach is said once under the table, not on every line.
        const reach = lane.reach && lane.reach !== "unknown" ? RELEASE_REACH[lane.reach] : null;
        return (
          <Fragment key={lane.key}>
            {labelled ? (
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {lane.label ?? EMPTY}
              </span>
            ) : null}
            <div className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
              {lane.live ? (
                <>
                  <ExternalLink href={lane.live.url}>
                    <Version version={lane.live.version} selected={props.version} />
                  </ExternalLink>
                  <RolloutBar
                    percent={lane.live.percent}
                    tone={
                      reach?.tone === "error"
                        ? "bg-warning"
                        : lane.live.percent === 100
                          ? "bg-success"
                          : "bg-info"
                    }
                  />
                  <span>{lane.live.percent}%</span>
                </>
              ) : null}
              {reach && lane.live ? (
                <Tooltip>
                  <TooltipTrigger render={<span className={TONE_TEXT[reach.tone]} />}>
                    {reach.label}
                  </TooltipTrigger>
                  <TooltipPopup>
                    Runtime <span className="font-mono">{lane.live.runtime}</span>
                  </TooltipPopup>
                </Tooltip>
              ) : null}
              {lane.preview ? (
                <span className="truncate">preview {lane.preview.version}</span>
              ) : null}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export function ReleaseSourceList(props: {
  sources: ReleaseStatusDocument["sources"];
  onConnect: (() => void) | undefined;
}) {
  if (props.sources.length === 0) return null;
  return (
    <ul aria-label="Release sources" className="flex flex-wrap gap-1.5">
      {props.sources.map((source) => (
        <li
          key={source.id}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
            source.status === "ok"
              ? "border-border"
              : "border-dashed border-border text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              source.status === "ok"
                ? "bg-success"
                : source.status === "error"
                  ? "bg-destructive"
                  : "bg-muted-foreground/50",
            )}
          />
          {source.name}
          {source.status === "error" ? " failed" : ""}
          {source.status !== "ok" && props.onConnect ? (
            <button
              type="button"
              onClick={props.onConnect}
              className="font-medium text-info-foreground hover:underline"
            >
              {source.status === "error" ? "Fix" : "Connect"}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function SummaryLine(props: {
  label: string;
  items: ReadonlyArray<{ version: string; binary?: ReleaseBinary }>;
  selected: string;
}) {
  const first = props.items[0];
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{props.label}</span>
      {first?.binary ? <StoreIcon binary={first.binary} /> : null}
      {first ? (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
          {props.items.slice(0, 3).map((item) => (
            <Version key={item.version} version={item.version} selected={props.selected} />
          ))}
          {props.items.length > 3 ? (
            <span className="text-xs text-muted-foreground">+{props.items.length - 3}</span>
          ) : null}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{EMPTY}</span>
      )}
    </div>
  );
}

export function ReleasePlatformCards(props: {
  summaries: ReadonlyArray<ReleasePlatformSummary>;
  version: string;
}) {
  if (props.summaries.length === 0) return null;
  return (
    <section aria-label="Live now" className="grid gap-3 sm:grid-cols-2">
      {props.summaries.map((summary) => (
        <div
          key={summary.platform}
          className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <PlatformIcon platform={summary.platform} />
            {PLATFORM[summary.platform].label}
          </h3>
          <SummaryLine
            label="Store"
            items={summary.store.map((binary) => ({ version: binary.version, binary }))}
            selected={props.version}
          />
          <SummaryLine label="OTA update" items={summary.ota} selected={props.version} />
          <SummaryLine
            label="Testers"
            items={summary.testers.map((binary) => ({ version: binary.version, binary }))}
            selected={props.version}
          />
        </div>
      ))}
    </section>
  );
}

function AppRow(props: { row: ReleaseAppRow; nested: boolean; version: string; now: number }) {
  const { row } = props;
  return (
    <tr
      className={cn(
        "align-top",
        (row.tone === "error" || row.tone === "warning") && "bg-warning/8",
      )}
    >
      <td className={cn("py-1.5 pr-2", props.nested ? "pl-11" : "pl-8")}>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <PlatformIcon platform={row.platform} className="text-muted-foreground" />
          <span>{row.platform ? PLATFORM[row.platform].label : row.name}</span>
          {row.detail ? <span className="text-xs text-muted-foreground">{row.detail}</span> : null}
        </div>
      </td>
      <td className="max-w-56 px-2 py-1.5">
        <div className="flex flex-col gap-1">
          {row.store || !row.review?.review ? (
            <StoreCell binary={row.store} version={props.version} now={props.now} />
          ) : null}
          {row.review?.review ? (
            <ReviewEntry
              binary={row.review}
              review={row.review.review}
              version={props.version}
              now={props.now}
            />
          ) : null}
        </div>
      </td>
      <td className="max-w-80 px-2 py-1.5">
        <OtaCell row={row} version={props.version} />
      </td>
      <td className="max-w-56 px-4 py-1.5">
        <StoreCell binary={row.testers} version={props.version} now={props.now} />
      </td>
    </tr>
  );
}

export function ReleaseAppTable(props: {
  apps: ReadonlyArray<ReleaseApp>;
  version: string;
  now: number;
}) {
  if (props.apps.length === 0) return null;
  const rows = props.apps.flatMap((app) => app.rows);
  const attention = rows.filter((row) => row.tone === "error" || row.tone === "warning").length;
  const unknownReach = rows.some((row) => row.ota.some((lane) => lane.reach === "unknown"));
  return (
    <Section
      title="Apps"
      meta={`${rows.length} builds${attention ? ` · ${attention} need attention` : ""}`}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">App</th>
              <th className="px-2 py-2 font-medium">Store</th>
              <th className="px-2 py-2 font-medium">OTA update</th>
              <th className="px-4 py-2 font-medium">Testers</th>
            </tr>
          </thead>
          {props.apps.map((app) => (
            <tbody key={app.key} className="border-t border-border first-of-type:border-t-0">
              <tr className="bg-muted/40">
                <td colSpan={4} className="px-4 py-2">
                  <div className="flex items-center gap-2.5">
                    {app.icon ? (
                      <img src={app.icon} alt="" className="size-6 shrink-0 rounded-md" />
                    ) : null}
                    <span className="font-semibold">{app.name}</span>
                  </div>
                </td>
              </tr>
              {app.builds.map((build) => {
                const single = build.variants.length === 1;
                return (
                  <Fragment key={build.key}>
                    <tr>
                      <td colSpan={4} className="px-4 pt-2.5 pb-0.5 text-xs">
                        <span className="font-semibold">{build.name}</span>
                        {single && build.variants[0]?.name ? (
                          <span className="ml-1.5 text-muted-foreground">
                            {build.variants[0].name}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                    {build.variants.map((variant) => (
                      <Fragment key={variant.key}>
                        {single ? null : (
                          <tr>
                            <td
                              colSpan={4}
                              className="pt-1.5 pb-0 pl-8 text-xs text-muted-foreground"
                            >
                              {variant.name ?? EMPTY}
                            </td>
                          </tr>
                        )}
                        {variant.rows.map((row) => (
                          <AppRow
                            key={row.key}
                            row={row}
                            nested={!single}
                            version={props.version}
                            now={props.now}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {unknownReach ? (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          OTA reach is unknown where it isn't shown: those store builds don't report their runtime.
        </p>
      ) : null}
    </Section>
  );
}

const DEPLOYMENT_TONE = {
  deployed: "",
  waiting: TONE_TEXT.warning,
  running: TONE_TEXT.info,
  failed: TONE_TEXT.error,
  retired: TONE_TEXT.muted,
} as const;

function environmentsOf(services: ReadonlyArray<ReleaseService>) {
  const environments: string[] = [];
  for (const service of services)
    for (const deployment of service.deployments)
      if (!environments.includes(deployment.environment)) environments.push(deployment.environment);
  return environments;
}

export function ReleaseServiceTable(props: {
  services: ReleaseStatusDocument["services"];
  now: number;
}) {
  if (props.services.length === 0) return null;
  const environments = environmentsOf(props.services);
  return (
    <Section title="Services" meta="Deployed version per environment">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Service</th>
              {environments.map((environment) => (
                <th key={environment} className="px-2 py-2 font-medium">
                  {environment}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.services.map((service) => (
              <tr key={service.id} className="border-t border-border/50">
                <td className="px-4 py-1.5 whitespace-nowrap">
                  {service.name}
                  {service.host ? (
                    <span className="text-muted-foreground"> · {service.host}</span>
                  ) : null}
                </td>
                {environments.map((environment) => {
                  const deployment = service.deployments.find(
                    (candidate) => candidate.environment === environment,
                  );
                  if (!deployment)
                    return (
                      <td key={environment} className="px-2 py-1.5 text-muted-foreground">
                        {EMPTY}
                      </td>
                    );
                  const age = releaseAge(deployment.at, props.now);
                  return (
                    <td
                      key={environment}
                      className={cn(
                        "px-2 py-1.5 whitespace-nowrap",
                        DEPLOYMENT_TONE[deployment.state],
                      )}
                    >
                      <ExternalLink href={deployment.url}>
                        <span className="font-mono text-xs">
                          {deployment.state === "retired"
                            ? "Retired"
                            : (deployment.version ?? deployment.state)}
                        </span>
                      </ExternalLink>
                      {age ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">{age}</span>
                      ) : null}
                      {deployment.pending ? (
                        <span
                          className={cn(
                            "ml-1.5 text-xs",
                            DEPLOYMENT_TONE[deployment.pending.state],
                          )}
                        >
                          → {deployment.pending.version} {deployment.pending.state}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
