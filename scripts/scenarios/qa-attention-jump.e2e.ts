/// <reference lib="dom" />
import { expect } from "e2e";
import { test, WEB } from "./t3.ts";

test(
  "Attention entries reveal their suite below the dashboard",
  WEB,
  async ({ t3, screen, browser, app }) => {
    await t3.project("QA navigation fixture", {
      "t3.json": JSON.stringify({
        qa: {
          suites: [
            { id: "backend", name: "Backend sample tests", component: "Backend", command: "false" },
            { id: "web", name: "Web sample tests", component: "Web", command: "true" },
          ],
        },
      }),
    });
    await t3.open("/qa");
    const suite = screen.getByRole("rowgroup", "Backend sample tests");
    await suite.getByRole("button", "Run", { exact: true }).tap();
    const attention = screen.getByRole("region", "Needs attention");
    await expect(attention).toBeVisible();
    await screen.getByRole("searchbox", "Search suites").fill("Web");
    const jump = attention.getByRole("button", /Backend · Backend sample tests/);
    await app.screenshot("attention-entry");
    await expect(jump).toBeVisible();
    await jump.tap();
    await expect(suite.getByRole("button", "Show details of Backend sample tests")).toBeFocused();
    await expect
      .poll(() =>
        browser.evaluate(() => {
          const row = document.querySelector('[data-suite-id="backend"]');
          const bounds = row?.getBoundingClientRect();
          return !!bounds && bounds.top >= 56 && bounds.top < window.innerHeight;
        }),
      )
      .toBe(true);
    await app.screenshot("revealed-suite");
  },
);
