import type {
  ReleaseBinary,
  ReleaseGate,
  ReleaseService,
  ReleaseStatusDocument,
} from "@t3tools/contracts";
import {
  releaseAge,
  type ReleaseAttention,
  type ReleaseTargetGroup,
  type ReleaseTargetRow,
  type ReleaseTone,
} from "@t3tools/client-runtime/releases";
import { ExternalLinkIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

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

function RolloutBar(props: { percent: number; tone: string }) {
  return (
    <span className="h-1 w-11 shrink-0 overflow-hidden rounded-full bg-muted-foreground/20">
      <span className={cn("block h-full", props.tone)} style={{ width: `${props.percent}%` }} />
    </span>
  );
}

function binaryPercent(binary: ReleaseBinary) {
  if (binary.audience !== "public") return null;
  return binary.rollout?.percent ?? 100;
}

function BinaryCell(props: { binary: ReleaseBinary | null; version: string }) {
  const binary = props.binary;
  if (!binary) return <span className="text-muted-foreground">No build</span>;
  const percent = binaryPercent(binary);
  const paused = binary.rollout?.state === "paused" || binary.rollout?.state === "halted";
  return (
    <span className="flex items-center gap-2">
      <RolloutBar
        percent={percent ?? 0}
        tone={paused ? "bg-warning" : percent === 100 ? "bg-success" : "bg-info"}
      />
      <span className="w-9 shrink-0 font-mono text-xs">
        {percent === null ? EMPTY : `${percent}%`}
      </span>
      <span className="truncate text-muted-foreground">
        <ExternalLink href={binary.url}>
          {binary.label}
          {binary.version !== props.version ? ` · ${binary.version}` : ""}
        </ExternalLink>
      </span>
    </span>
  );
}

function OtaCell(props: { row: ReleaseTargetRow }) {
  const ota = props.row.ota;
  if (!ota) return <span className="text-muted-foreground">{EMPTY}</span>;
  if (ota.state === "preview") return <span className="text-muted-foreground">Preview only</span>;
  const { update } = ota;
  const tone =
    props.row.check.tone === "error"
      ? "bg-warning"
      : update.percent === 100
        ? "bg-success"
        : "bg-info";
  return (
    <span className="flex items-center gap-2">
      <RolloutBar percent={update.percent} tone={tone} />
      <span className="font-mono text-xs">{update.percent}%</span>
      {ota.state === "other" ? (
        <span className="truncate text-xs text-muted-foreground">{update.version}</span>
      ) : null}
    </span>
  );
}

export function ReleaseTargetTable(props: {
  groups: ReadonlyArray<ReleaseTargetGroup>;
  version: string;
}) {
  if (props.groups.length === 0) return null;
  return (
    <Section title={`Where ${props.version} is`} meta="Store binary → runtime → OTA update">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Target</th>
              <th className="px-2 py-2 font-medium">Store binary</th>
              <th className="px-2 py-2 font-medium">Runtime</th>
              <th className="px-2 py-2 font-medium">OTA update</th>
              <th className="px-4 py-2 font-medium">Check</th>
            </tr>
          </thead>
          {props.groups.map((group) => (
            <tbody key={group.key}>
              <tr>
                <td colSpan={5} className="border-t border-border px-4 pt-2.5 pb-1 text-xs">
                  <span className="font-semibold">{group.group}</span>
                  {group.detail ? (
                    <span className="ml-2 text-muted-foreground">{group.detail}</span>
                  ) : null}
                </td>
              </tr>
              {group.rows.map((row) => (
                <tr
                  key={row.target.id}
                  className={cn(
                    "border-t border-border/50",
                    (row.check.tone === "error" || row.check.tone === "warning") && "bg-warning/8",
                  )}
                >
                  <td className="px-4 py-1.5 whitespace-nowrap">{row.target.name}</td>
                  <td className="max-w-64 px-2 py-1.5">
                    <BinaryCell binary={row.binary} version={props.version} />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {row.ota?.update.runtime ?? row.binary?.runtime ?? EMPTY}
                  </td>
                  <td className="px-2 py-1.5">
                    <OtaCell row={row} />
                  </td>
                  <td className={cn("px-4 py-1.5 whitespace-nowrap", TONE_TEXT[row.check.tone])}>
                    {row.check.label}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
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
