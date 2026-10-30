import { SaxesParser } from "saxes";
import type { QaReportSummary, QaTestCase } from "@t3tools/contracts";

export function parseJunitReport(
  xml: string,
  onTest?: (test: QaTestCase) => void,
): QaReportSummary {
  const parser = new SaxesParser();
  const summary = { tests: 0, failures: 0, skipped: 0 };
  const suites: Array<{ group: string; file: string; truncated: boolean }> = [];
  let depth = 0;
  let detailDepth = 0;
  let current: {
    failed: boolean;
    skipped: boolean;
    test:
      | (Omit<QaTestCase, "details" | "truncated"> & { details: string | null; truncated: boolean })
      | null;
  } | null = null;
  let root = false;
  let reportsFailures = false;
  const appendDetail = (text: string) => {
    if (!current?.test) return;
    const previous = current.test.details ?? "";
    const available = 8192 - previous.length;
    current.test.details = previous + text.slice(0, available);
    current.test.truncated ||= text.length > available;
  };
  parser.on("doctype", () => {
    throw new Error("JUnit reports must not declare a document type.");
  });
  parser.on("opentag", (tag) => {
    depth += 1;
    if (depth > 128) throw new Error("JUnit report nesting is too deep.");
    if (!root) {
      if (tag.name !== "testsuites" && tag.name !== "testsuite")
        throw new Error("Expected a JUnit report.");
      root = true;
    }
    if (tag.name === "testsuite" || tag.name === "testsuites") {
      reportsFailures ||=
        Number(tag.attributes.failures ?? 0) > 0 || Number(tag.attributes.errors ?? 0) > 0;
    }
    if (tag.name === "testsuite" && onTest) {
      const parent = suites.at(-1);
      const group = [parent?.group, String(tag.attributes.name ?? "").trim()]
        .filter(Boolean)
        .join(" › ");
      const file = String(tag.attributes.file ?? parent?.file ?? "");
      suites.push({
        group: group.slice(0, 2048),
        file: file.slice(0, 2048),
        truncated: !!parent?.truncated || group.length > 2048 || file.length > 2048,
      });
    }
    if (tag.name === "testcase") {
      if (current) throw new Error("Nested JUnit test cases are invalid.");
      let truncated = false;
      const text = (value: string, max: number) => {
        truncated ||= value.length > max;
        return value.slice(0, max);
      };
      const durationText = String(tag.attributes.time ?? "").trim();
      const duration = durationText ? Number(durationText) * 1000 : NaN;
      const test: QaTestCase | null = onTest
        ? {
            id: summary.tests,
            name: text(
              String(tag.attributes.name ?? "").trim() || `Unnamed test ${summary.tests + 1}`,
              1024,
            ),
            group:
              text(
                String(tag.attributes.classname ?? "").trim() || suites.at(-1)?.group || "",
                2048,
              ) || null,
            file: text(String(tag.attributes.file ?? suites.at(-1)?.file ?? ""), 2048) || null,
            status: "passed",
            durationMs: Number.isFinite(duration) && duration >= 0 ? duration : null,
            details: null,
            truncated: truncated || !!suites.at(-1)?.truncated,
          }
        : null;
      current = { failed: false, skipped: false, test };
    } else if (current && (tag.name === "failure" || tag.name === "error")) {
      current.failed = true;
    } else if (current && tag.name === "skipped") {
      current.skipped = true;
    }
    if (current && (tag.name === "failure" || tag.name === "error" || tag.name === "skipped")) {
      detailDepth = depth;
      appendDetail(
        `${current.test?.details ? "\n\n" : ""}${tag.name === "failure" ? "Failure" : tag.name === "error" ? "Error" : "Skipped"}${tag.attributes.type ? ` (${tag.attributes.type})` : ""}${tag.attributes.message ? `: ${tag.attributes.message}` : ""}\n`,
      );
    }
  });
  parser.on("text", (text) => {
    if (detailDepth) appendDetail(text);
  });
  parser.on("cdata", (text) => {
    if (detailDepth) appendDetail(text);
  });
  parser.on("closetag", (tag) => {
    if (depth === detailDepth) detailDepth = 0;
    if (tag.name === "testsuite" && onTest) suites.pop();
    if (tag.name === "testcase" && current !== null) {
      if (current.test && onTest)
        onTest({
          ...current.test,
          status: current.failed ? "failed" : current.skipped ? "skipped" : "passed",
          details: current.test.details?.trim() || null,
        });
      summary.tests += 1;
      summary.failures += Number(current.failed);
      summary.skipped += Number(!current.failed && current.skipped);
      current = null;
    }
    depth -= 1;
  });
  parser.write(xml).close();
  if (!root) throw new Error("Expected a JUnit report.");
  if (reportsFailures && summary.failures === 0)
    throw new Error("JUnit suite errors have no matching test cases.");
  return summary;
}
