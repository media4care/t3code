import { useState } from "react";
import { GitBranchIcon, Trash2Icon } from "lucide-react";
import type { QaCheckout, QaRefSummary } from "@t3tools/contracts";
import { QA_RUN_STATUS_LABELS, qaCheckoutLabel } from "@t3tools/client-runtime/qa";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { QaStatusBadge } from "./QaDashboard";

const OTHER_REF = "\u0000other";

/** Picks the branch or tag QA shows and runs: one QA knows, or any other by name. */
export function QaRefPicker({
  value,
  refs,
  onChange,
}: {
  value: string;
  refs: ReadonlyArray<QaRefSummary>;
  onChange: (ref: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const known = refs.some((summary) => summary.ref === value) ? refs : [{ ref: value }, ...refs];
  if (typing)
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const ref = draft.trim();
          if (ref) onChange(ref);
          setTyping(false);
          setDraft("");
        }}
      >
        <Input
          autoFocus
          aria-label="Branch or tag"
          placeholder="Branch or tag, such as v26.10"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          Show
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setTyping(false)}>
          Cancel
        </Button>
      </form>
    );
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === OTHER_REF) setTyping(true);
        else if (next) onChange(next);
      }}
    >
      <SelectTrigger aria-label="Branch or tag">
        <SelectValue>
          <GitBranchIcon /> {value}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {known.map(({ ref }) => (
          <SelectItem key={ref} value={ref}>
            {ref}
            {refs.find((summary) => summary.ref === ref)?.isDefault ? " · default" : ""}
          </SelectItem>
        ))}
        <SelectItem value={OTHER_REF}>Other branch or tag…</SelectItem>
      </SelectPopup>
    </Select>
  );
}

/** Where QA's own checkout of the ref stands, and the way to remove it. */
export function QaCheckoutStatus({
  gitRef,
  checkout,
  canDelete,
  onDelete,
}: {
  gitRef: string;
  checkout: QaCheckout;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span
        role="status"
        className={checkout.state === "failed" ? "text-destructive-foreground" : ""}
      >
        {qaCheckoutLabel(gitRef, checkout)}
      </span>
      {checkout.state === "ready" || checkout.state === "failed" ? (
        <Button variant="ghost" size="xs" disabled={!canDelete} onClick={onDelete}>
          <Trash2Icon /> Delete checkout
        </Button>
      ) : null}
      {checkout.error ? (
        <pre className="w-full overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
          {checkout.error}
        </pre>
      ) : null}
    </div>
  );
}

/** Each suite's latest result on every ref QA has tested, side by side. */
export function QaRefComparison({
  refs,
  selected,
  onSelect,
}: {
  refs: ReadonlyArray<QaRefSummary>;
  selected: string;
  onSelect: (ref: string) => void;
}) {
  const tested = refs.filter((summary) => summary.results.length > 0);
  if (tested.length < 2) return null;
  const suites = new Map<string, string>();
  for (const summary of tested)
    for (const result of summary.results)
      if (!suites.has(result.suiteId)) suites.set(result.suiteId, result.suiteName);
  return (
    <details>
      <summary className="mb-3 cursor-pointer text-sm font-semibold">
        Compare branches and tags{" "}
        <span className="text-sm font-normal text-muted-foreground">
          · Latest result of each suite
        </span>
      </summary>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="p-3">Suite</th>
              {tested.map(({ ref }) => (
                <th key={ref} className="p-3">
                  <Button
                    variant={ref === selected ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={ref === selected}
                    onClick={() => onSelect(ref)}
                  >
                    <span className="font-mono">{ref}</span>
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...suites].map(([suiteId, name]) => (
              <tr key={suiteId} className="border-t border-border">
                <td className="p-3">{name}</td>
                {tested.map(({ ref, results }) => {
                  const result = results.find((candidate) => candidate.suiteId === suiteId);
                  return (
                    <td key={ref} className="p-3">
                      <QaStatusBadge
                        status={result?.status}
                        label={result ? QA_RUN_STATUS_LABELS[result.status] : "Never run"}
                      />
                      {result?.commit ? (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {result.commit.slice(0, 8)}
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
    </details>
  );
}
