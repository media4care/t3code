import { describe, expect, it } from "@effect/vitest";
import { parseJunitReport } from "./junit.ts";
import type { QaTestCase } from "@t3tools/contracts";

describe("JUnit report evidence", () => {
  it("counts cases once across nested suites and treats errors as failures", () => {
    const tests: QaTestCase[] = [];
    expect(
      parseJunitReport(
        `<testsuites tests="99"><testsuite name="Backend" file="api.test.ts" tests="99"><testsuite name="Auth">
      <testcase name="signs in &amp; redirects" classname="Login" time="0.012"/><testcase name="later" time="invalid"><skipped message="requires device"/></testcase>
      <testcase name="rejects expired token" time="-1"><failure type="AssertionError" message="expected 401"><![CDATA[expected < actual]]></failure><error message="connection closed"/></testcase>
    </testsuite></testsuite></testsuites>`,
        (test) => tests.push(test),
      ),
    ).toEqual({ tests: 3, failures: 1, skipped: 1 });
    expect(tests).toEqual([
      {
        id: 0,
        name: "signs in & redirects",
        group: "Login",
        file: "api.test.ts",
        status: "passed",
        durationMs: 12,
        details: null,
        truncated: false,
      },
      {
        id: 1,
        name: "later",
        group: "Backend › Auth",
        file: "api.test.ts",
        status: "skipped",
        durationMs: null,
        details: "Skipped: requires device",
        truncated: false,
      },
      {
        id: 2,
        name: "rejects expired token",
        group: "Backend › Auth",
        file: "api.test.ts",
        status: "failed",
        durationMs: null,
        details:
          "Failure (AssertionError): expected 401\nexpected < actual\n\nError: connection closed",
        truncated: false,
      },
    ]);
    expect(parseJunitReport(`<testsuite><testcase><error/></testcase></testsuite>`)).toEqual({
      tests: 1,
      failures: 1,
      skipped: 0,
    });
    const duplicates: QaTestCase[] = [];
    parseJunitReport(
      `<testsuite><testcase name="same" time="Infinity"/><testcase name="same" time="0"><skipped/><failure>${"x".repeat(9000)}</failure></testcase><testcase/></testsuite>`,
      (test) => duplicates.push(test),
    );
    expect(duplicates.map((test) => [test.id, test.name, test.status, test.durationMs])).toEqual([
      [0, "same", "passed", null],
      [1, "same", "failed", 0],
      [2, "Unnamed test 3", "passed", null],
    ]);
    expect(duplicates[1]?.details).toHaveLength(8192);
    expect(duplicates[1]?.truncated).toBe(true);
  });
  it("rejects malformed or unrelated reports and document types", () => {
    for (const xml of [
      "",
      "<html/>",
      "<testsuite>",
      '<!DOCTYPE testsuite [<!ENTITY x "test">]><testsuite/>',
      '<testsuite errors="1"><testcase name="passed"/></testsuite>',
      `<testsuite>${"<testsuite>".repeat(128)}${"</testsuite>".repeat(128)}</testsuite>`,
      "<testsuite><testcase><testcase/></testcase></testsuite>",
    ]) {
      expect(() => parseJunitReport(xml)).toThrow();
    }
    expect(parseJunitReport("<testsuites/>")).toEqual({ tests: 0, failures: 0, skipped: 0 });
  });
});
