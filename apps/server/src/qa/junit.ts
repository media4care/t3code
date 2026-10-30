import { SaxesParser } from "saxes";
import type { QaReportSummary } from "@t3tools/contracts";

export function parseJunitReport(xml: string): QaReportSummary {
  const parser = new SaxesParser();
  const summary = { tests: 0, failures: 0, skipped: 0 };
  let current: { failed: boolean; skipped: boolean } | null = null;
  let root = false;
  let reportsFailures = false;
  parser.on("doctype", () => {
    throw new Error("JUnit reports must not declare a document type.");
  });
  parser.on("opentag", (tag) => {
    if (!root) {
      if (tag.name !== "testsuites" && tag.name !== "testsuite")
        throw new Error("Expected a JUnit report.");
      root = true;
    }
    if (tag.name === "testsuite" || tag.name === "testsuites") {
      reportsFailures ||=
        Number(tag.attributes.failures ?? 0) > 0 || Number(tag.attributes.errors ?? 0) > 0;
    }
    if (tag.name === "testcase") {
      if (current) throw new Error("Nested JUnit test cases are invalid.");
      current = { failed: false, skipped: false };
    } else if (current && (tag.name === "failure" || tag.name === "error")) {
      current.failed = true;
    } else if (current && tag.name === "skipped") {
      current.skipped = true;
    }
  });
  parser.on("closetag", (tag) => {
    if (tag.name !== "testcase" || current === null) return;
    summary.tests += 1;
    summary.failures += Number(current.failed);
    summary.skipped += Number(!current.failed && current.skipped);
    current = null;
  });
  parser.write(xml).close();
  if (!root) throw new Error("Expected a JUnit report.");
  if (reportsFailures && summary.failures === 0)
    throw new Error("JUnit suite errors have no matching test cases.");
  return summary;
}
