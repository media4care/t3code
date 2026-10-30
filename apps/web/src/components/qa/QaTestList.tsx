import { useState } from "react";
import { CheckCircle2Icon, CircleMinusIcon, XCircleIcon } from "lucide-react";
import { QA_TEST_PAGE_SIZE, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { QA_TEST_FILTERS, qaTestDuration, type QaTestFilter } from "@t3tools/client-runtime/qa";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const RESULTS = {
  passed: { label: "Passed", variant: "success", icon: CheckCircle2Icon },
  failed: { label: "Failed", variant: "error", icon: XCircleIcon },
  skipped: { label: "Skipped", variant: "warning", icon: CircleMinusIcon },
} as const;

export function QaTestList({
  environmentId,
  projectId,
  runId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  runId: string;
}) {
  const [selection, setSelection] = useState({
    search: "",
    status: "all" as QaTestFilter,
    offset: 0,
  });
  const query = useEnvironmentQuery(
    serverEnvironment.qaTests({
      environmentId,
      input: {
        projectId,
        runId,
        search: selection.search,
        offset: selection.offset,
        ...(selection.status === "all" ? {} : { status: selection.status }),
      },
    }),
  );
  const data = query.data;
  return (
    <section aria-label="Individual tests" className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Tests</h3>
        <span className="text-xs text-muted-foreground">Results from this run</span>
      </div>
      {query.error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {query.error}
        </p>
      ) : null}
      {data?.unavailableReason ? (
        <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
          {data.unavailableReason}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-44 flex-1">
              <Input
                type="search"
                aria-label="Search tests"
                placeholder="Search test names, files, or groups…"
                maxLength={200}
                value={selection.search}
                onChange={(event) =>
                  setSelection({ ...selection, search: event.target.value, offset: 0 })
                }
              />
            </div>
            <div className="w-36">
              <Select
                value={selection.status}
                onValueChange={(status) => {
                  if (status) setSelection({ ...selection, status, offset: 0 });
                }}
              >
                <SelectTrigger aria-label="Filter tests">
                  <SelectValue>
                    {QA_TEST_FILTERS.find((filter) => filter.value === selection.status)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {QA_TEST_FILTERS.map((filter) => (
                    <SelectItem key={filter.value} value={filter.value}>
                      {filter.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          </div>
          {query.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading tests…
            </p>
          ) : null}
          {data ? (
            <>
              <p role="status" className="text-xs tabular-nums text-muted-foreground">
                {data.tests.length
                  ? `${data.offset + 1}–${data.offset + data.tests.length} of ${data.matched} tests`
                  : `0 of ${data.matched} tests`}
                {data.matched !== data.total ? ` · ${data.total} in report` : ""}
              </p>
              {data.tests.length ? (
                <div className="max-h-[32rem] overflow-auto rounded-xl border border-border">
                  <table aria-label="Test results" className="w-full table-fixed text-left text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="p-3 font-medium">Test</th>
                        <th className="w-24 p-3 font-medium">Result</th>
                        <th className="hidden w-24 p-3 text-right font-medium sm:table-cell">
                          Duration
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tests.map((test) => {
                        const { label, variant, icon: Icon } = RESULTS[test.status];
                        return (
                          <tr key={test.id} className="border-t border-border align-top">
                            <td className="p-3">
                              <p className="break-words font-medium">{test.name}</p>
                              {test.group ? (
                                <p className="mt-1 break-words text-xs text-muted-foreground">
                                  {test.group}
                                </p>
                              ) : null}
                              {test.file && test.file !== test.group ? (
                                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                  {test.file}
                                </p>
                              ) : null}
                              <p className="mt-1 text-xs text-muted-foreground sm:hidden">
                                Duration: {qaTestDuration(test)}
                              </p>
                              {test.details ? (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs text-primary">
                                    {test.status === "failed" ? "Failure details" : "Skip reason"}
                                  </summary>
                                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs">
                                    {test.details}
                                  </pre>
                                </details>
                              ) : null}
                              {test.truncated ? (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Some fields were shortened. See the full saved report below.
                                </p>
                              ) : null}
                            </td>
                            <td className="p-3">
                              <Badge variant={variant}>
                                <Icon />
                                {label}
                              </Badge>
                            </td>
                            <td className="hidden p-3 text-right font-mono text-xs tabular-nums text-muted-foreground sm:table-cell">
                              {qaTestDuration(test)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
                  {data.total
                    ? "No tests match these filters."
                    : "No individual tests were included in this report."}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                {selection.search || selection.status !== "all" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelection({ search: "", status: "all", offset: 0 })}
                  >
                    Clear test filters
                  </Button>
                ) : (
                  <span />
                )}
                {data.matched > QA_TEST_PAGE_SIZE || selection.offset > 0 ? (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selection.offset || query.isPending}
                      onClick={() =>
                        setSelection({
                          ...selection,
                          offset: Math.max(0, selection.offset - QA_TEST_PAGE_SIZE),
                        })
                      }
                    >
                      Previous tests
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={data.nextOffset === null || query.isPending}
                      onClick={() => {
                        if (data.nextOffset !== null)
                          setSelection({ ...selection, offset: data.nextOffset });
                      }}
                    >
                      Next tests
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
