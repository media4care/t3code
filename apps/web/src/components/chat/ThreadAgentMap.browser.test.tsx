import { expect, it } from "vite-plus/test";
import "~/index.css";
import { projectedSubagentsToRuntime } from "@t3tools/client-runtime/state/subagentRuntime";
import type { ThreadAgentMapNode } from "@t3tools/client-runtime/state/thread-agent-map";
import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { render } from "../../../test/render";
import { ThreadAgentMap } from "./ThreadAgentMap";

function node(id: string, parentId: string | null = null): ThreadAgentMapNode {
  const [agent] = projectedSubagentsToRuntime([
    {
      id,
      title: id,
      prompt: "",
      model: "gpt-6.1",
      status: "completed",
      result: `Output from ${id}`,
      startedAt: null,
      completedAt: null,
      updatedAt: DateTime.makeUnsafe("2026-10-29T12:00:00.000Z"),
    },
  ]);
  return {
    id,
    parentId,
    agent: agent!,
    ownerThreadId: ThreadId.make("parent"),
    source: null,
    thread: null,
    target: null,
    kind: "Native",
    prompt: null,
  };
}

it("keeps the selected agent through live updates and collapses its branch without losing the inspector", async () => {
  const nodes = [node("Implement"), node("Test", "Implement"), node("Review")];
  const view = (items: ReadonlyArray<ThreadAgentMapNode>) => (
    <ThreadAgentMap
      title="Reconnect recovery"
      nodes={items}
      providerFor={() => undefined}
      renderInspector={(selected) => (
        <section aria-label="Selected agent">
          {selected.agent.title}: {selected.agent.result}
        </section>
      )}
    />
  );
  await using screen = await render(view(nodes));
  await screen.getByRole("button", { name: "Test, Done" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Selected agent" }))
    .toHaveTextContent("Test: Output from Test");
  await screen.rerender(
    view(
      nodes.map((entry) =>
        entry.id === "Test"
          ? { ...entry, agent: { ...entry.agent, result: "Updated result" } }
          : entry,
      ),
    ),
  );
  await expect
    .element(screen.getByRole("region", { name: "Selected agent" }))
    .toHaveTextContent("Test: Updated result");
  await screen.getByRole("button", { name: "1 child" }).click();
  await expect.element(screen.getByRole("button", { name: "Test, Done" })).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("region", { name: "Selected agent" }))
    .toHaveTextContent("Test: Updated result");
  await screen.getByRole("button", { name: "1 child" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Test, Done" }))
    .toHaveAttribute("aria-pressed", "true");
});
