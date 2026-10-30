import { describe, expect, it } from "@effect/vitest";
import { parseJunitReport } from "./junit.ts";

describe("JUnit report evidence", () => {
  it("counts cases once across nested suites and treats errors as failures", () => {
    expect(
      parseJunitReport(`<testsuites tests="99"><testsuite tests="99"><testsuite>
      <testcase name="pass"/><testcase name="skip"><skipped/></testcase>
      <testcase name="fail"><failure><![CDATA[expected < actual]]></failure><error/></testcase>
    </testsuite></testsuite></testsuites>`),
    ).toEqual({ tests: 3, failures: 1, skipped: 1 });
    expect(parseJunitReport(`<testsuite><testcase><error/></testcase></testsuite>`)).toEqual({
      tests: 1,
      failures: 1,
      skipped: 0,
    });
  });
  it("rejects malformed or unrelated reports and document types", () => {
    for (const xml of [
      "",
      "<html/>",
      "<testsuite>",
      '<!DOCTYPE testsuite [<!ENTITY x "test">]><testsuite/>',
      '<testsuite errors="1"><testcase name="passed"/></testsuite>',
    ]) {
      expect(() => parseJunitReport(xml)).toThrow();
    }
    expect(parseJunitReport("<testsuites/>")).toEqual({ tests: 0, failures: 0, skipped: 0 });
  });
});
