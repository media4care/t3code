import { describe, expect, it } from "vite-plus/test";
import { closestCenter, type CollisionDetection } from "@dnd-kit/core";
import type { SortingStrategy } from "@dnd-kit/sortable";
import { createSidebarCollisionDetection, createSidebarSortingStrategy } from "./Sidebar.drag";
import {
  sidebarListItemId,
  sidebarMarkerId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

const thread = (key: string, section: SidebarSection): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const marker = (marker: SidebarListMarker): SidebarListItem => ({ kind: "marker", marker });
const pinnedHeader = marker("pinned-header");
const pinnedPlaceholder = marker("pinned-placeholder");
const settledHeader = marker("settled-header");
const stationary = { x: 0, y: 0, scaleX: 1, scaleY: 1 };

function layout(
  items: readonly SidebarListItem[],
  active: string,
  over: string,
  scale = 1,
  cardHeight = 82,
) {
  // The Pinned header collapses to a zero-height drop anchor while there are no pins.
  const hasPins = items.some((item) => item.kind === "thread" && item.section === "pinned");
  let top = 100;
  const rects = items.map((item) => {
    const height =
      item.kind === "thread"
        ? (item.section === "pinned" || item.section === "active" ? cardHeight : 36) * scale
        : item.marker.endsWith("placeholder") || (item.marker === "pinned-header" && !hasPins)
          ? 0
          : 32 * scale;
    const rect = { top, height, bottom: top + height, left: 0, right: 260, width: 260 };
    // Zero-height markers cancel the list gap with -mb-px.
    top += height === 0 ? 0 : height + 1;
    return rect;
  });
  const activeIndex = items.findIndex((item) => sidebarListItemId(item) === active);
  return {
    activeIndex,
    overIndex: items.findIndex((item) => sidebarListItemId(item) === over),
    activeNodeRect: rects[activeIndex]!,
    rects,
    index: 0,
  } satisfies Parameters<SortingStrategy>[0];
}

function preview(
  input: Parameters<typeof createSidebarSortingStrategy>[0],
  active: string,
  over: string,
  scale = 1,
) {
  const strategy = createSidebarSortingStrategy(input);
  const args = layout(input.items, active, over, scale);
  return new Map(
    input.items.map((item, index) => [sidebarListItemId(item), strategy({ ...args, index })]),
  );
}

describe("sidebar collision detection", () => {
  function collisionArgs(blockedAboveSource = false) {
    const rows = [thread("source", "active"), thread("blocked", "active")];
    const items = [
      marker("active-placeholder"),
      ...(blockedAboveSource ? rows.toReversed() : rows),
      pinnedHeader,
      pinnedPlaceholder,
      settledHeader,
      marker("settled-placeholder"),
    ];
    const { rects, activeIndex, overIndex } = layout(items, "source", "blocked");
    const collisionRect = rects[overIndex]!;
    return {
      active: {
        id: "source",
        data: { current: {} },
        rect: { current: { initial: rects[activeIndex]!, translated: collisionRect } },
      },
      collisionRect,
      droppableRects: new Map(items.map((item, index) => [sidebarListItemId(item), rects[index]!])),
      droppableContainers: items.map((item, index) => ({
        id: sidebarListItemId(item),
        key: sidebarListItemId(item),
        disabled: false,
        data: { current: {} },
        node: { current: null },
        rect: { current: rects[index]! },
      })),
      pointerCoordinates: null,
    } satisfies Parameters<CollisionDetection>[0];
  }

  it.each([
    [false, sidebarMarkerId("pinned-header")],
    [true, sidebarMarkerId("active-placeholder")],
  ] as const)(
    "rejects unsupported Active instead of selecting %s / %s",
    (blockedAboveSource, nearbyTarget) => {
      const args = collisionArgs(blockedAboveSource);
      const detector = createSidebarCollisionDetection((id) => id !== "blocked");
      const filtered = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) => container.id !== "blocked",
        ),
      });
      expect(filtered[0]?.id).toBe(nearbyTarget);
      expect(detector(args).map((collision) => collision.id)).toEqual(["source"]);
    },
  );

  it("returns no collision if an unsupported target has no source fallback", () => {
    const args = collisionArgs();
    const detector = createSidebarCollisionDetection(() => false);
    expect(
      detector({
        ...args,
        droppableContainers: args.droppableContainers.filter(
          (container) => container.id !== "source",
        ),
      }),
    ).toEqual([]);
  });
});

describe("sidebar drag projection", () => {
  it.each([
    ["a2", "a1"],
    ["p", "a1"],
    ["s", sidebarMarkerId("pinned-placeholder")],
    ["z", sidebarMarkerId("settled-header")],
  ])("restores every row and marker when dragging %s out after hovering %s", (active, over) => {
    const items = [
      marker("active-placeholder"),
      thread("a1", "active"),
      thread("a2", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      marker("settled-placeholder"),
      thread("s", "settled"),
    ];
    const input = {
      items,
      settledOrder: ["z", "s"],
      settledExpanded: true,
      snoozedThreadCount: 1,
    };
    const reordered = preview(input, active, over);
    expect([...reordered.values()].some((transform) => transform?.y !== 0)).toBe(true);

    const restored = preview({ ...input, enabled: false }, active, over);
    for (const transform of restored.values()) expect(transform).toEqual(stationary);

    expect(preview({ ...input, enabled: true }, active, over)).toEqual(reordered);
  });

  it.each([
    ["a1", "a2"],
    ["a1", sidebarMarkerId("settled-header")],
    ["z", "a2"],
  ])("keeps sparse shelves at the bottom when dragging %s over %s", (active, over) => {
    const items = [
      thread("a1", "active"),
      thread("a2", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      pinnedHeader,
      thread("p", "pinned"),
      settledHeader,
      thread("s", "settled"),
    ];
    const strategy = createSidebarSortingStrategy({
      items,
      settledOrder: over === sidebarMarkerId("settled-header") ? ["a1", "s"] : ["s"],
      settledExpanded: true,
      snoozedThreadCount: 1,
    });
    const args = layout(items, active, over);
    for (const rect of args.rects.slice(2)) {
      rect.top += 400;
      rect.bottom += 400;
    }
    const lastIndex = items.length - 1;
    expect(strategy({ ...args, index: lastIndex })).toEqual(stationary);
  });

  const pinned = [
    thread("a1", "active"),
    pinnedHeader,
    pinnedPlaceholder,
    thread("p1", "pinned"),
    thread("p2", "pinned"),
    settledHeader,
    thread("s1", "settled"),
  ];

  it("reorders pins under a stationary Pinned header", () => {
    const result = preview({ items: pinned, settledOrder: [], settledExpanded: true }, "p2", "p1");
    expect(result.get("a1")).toEqual(stationary);
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual(stationary);
    expect(result.get("p1")?.y).toBe(83);
    expect(result.get(sidebarMarkerId("settled-header"))).toEqual(stationary);
  });

  it("opens the empty Pinned target when an active thread is lifted", () => {
    const items = [
      thread("a1", "active"),
      thread("a2", "active"),
      pinnedHeader,
      pinnedPlaceholder,
      settledHeader,
      thread("s", "settled"),
    ];
    const result = preview({ items, settledOrder: ["s"], settledExpanded: true }, "a1", "a1");
    expect(result.get(sidebarMarkerId("pinned-placeholder"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(37);
    const pinning = preview(
      { items, settledOrder: ["s"], settledExpanded: true },
      "a1",
      sidebarMarkerId("pinned-placeholder"),
    );
    expect(pinning.get(sidebarMarkerId("pinned-placeholder"))?.scaleY).toBe(0);
    expect(pinning.get("a2")?.y).toBe(-83);
    expect(pinning.get(sidebarMarkerId("settled-header"))).toEqual(stationary);
  });

  it("preserves settled order while opening the zero-height Active and Pinned targets", () => {
    const items = [
      marker("active-placeholder"),
      pinnedHeader,
      pinnedPlaceholder,
      settledHeader,
      thread("first", "settled"),
      thread("second", "settled"),
    ];
    const result = preview(
      { items, settledOrder: ["first", "second"], settledExpanded: true },
      "second",
      "first",
    );
    expect(result.get(sidebarMarkerId("active-placeholder"))).toEqual(stationary);
    expect(result.get(sidebarMarkerId("pinned-placeholder"))).toEqual({ ...stationary, y: 37 });
    expect(result.get(sidebarMarkerId("settled-header"))).toEqual({ ...stationary, y: 74 });
    expect(result.get("first")).toEqual({ ...stationary, y: 74 });
    expect(result.get("second")).toEqual(stationary);
  });

  it.each([
    ["a1", 83, 83],
    ["a2", 0, 83],
  ] as const)(
    "opens the active slot over %s when the only pin rises out of its shelf",
    (over, a1Offset, a2Offset) => {
      const items = [
        thread("a1", "active"),
        thread("a2", "active"),
        pinnedHeader,
        pinnedPlaceholder,
        thread("p", "pinned"),
        settledHeader,
        thread("s", "settled"),
      ];
      const result = preview({ items, settledOrder: [], settledExpanded: true }, "p", over);
      expect(result.get("a1")?.y).toBe(a1Offset);
      expect(result.get("a2")?.y).toBe(a2Offset);
      expect(result.get(sidebarMarkerId("pinned-placeholder"))?.scaleY).toBe(1);
    },
  );

  it("uses the canonical settled rank and the destination's slim height", () => {
    const items = [
      thread("a", "active"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      thread("s1", "settled"),
      thread("s2", "settled"),
    ];
    const result = preview(
      { items, settledOrder: ["s1", "a", "s2"], settledExpanded: true },
      "a",
      "s2",
    );
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(-46);
    expect(result.get("s1")?.y).toBe(-46);
    expect(result.get("s2")?.y).toBe(-9);
  });

  it.each([
    ["a1", 83],
    ["a2", 0],
  ] as const)(
    "reserves a full card at the pointer slot over %s when a slim row enters Active",
    (over, firstOffset) => {
      const items = [
        thread("a1", "active"),
        thread("a2", "active"),
        pinnedHeader,
        pinnedPlaceholder,
        thread("p", "pinned"),
        settledHeader,
        thread("s", "settled"),
      ];
      const result = preview({ items, settledOrder: [], settledExpanded: true }, "s", over);
      expect(result.get("a1")?.y).toBe(firstOffset);
      expect(result.get("a2")?.y).toBe(83);
      expect(result.get(sidebarMarkerId("pinned-header"))?.y).toBe(83);
      expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(83);
    },
  );

  it("removes the snoozed header when its last row leaves", () => {
    const items = [
      thread("a", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      thread("s", "settled"),
    ];
    const result = preview({ items, settledOrder: [], settledExpanded: true }, "z", "a");
    expect(result.get(sidebarMarkerId("snoozed-header"))?.scaleY).toBe(0);
    expect(result.get(sidebarMarkerId("pinned-header"))?.y).toBe(13);
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(13);
  });

  it("keeps a collapsed settled target without inserting a hidden row", () => {
    const items = [
      thread("a1", "active"),
      thread("a2", "active"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const result = preview(
      { items, settledOrder: [], settledExpanded: false },
      "a2",
      sidebarMarkerId("settled-placeholder"),
    );
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(-83);
    expect(result.get(sidebarMarkerId("settled-placeholder"))).toEqual({ ...stationary, y: -83 });
  });

  it("previews a time-ordered inbox drop at its time slot, above the Working shelf", () => {
    const items = [
      thread("a1", "active"),
      thread("a2", "active"),
      marker("working-header"),
      thread("w", "working"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const input = { items, settledOrder: [], settledExpanded: false };
    expect(preview(input, "p", "a2").get("a1")?.y).toBe(0);
    const byTime = preview({ ...input, activeOrder: ["p", "a1", "a2"] }, "p", "a2");
    expect(byTime.get("a1")?.y).toBe(83);
    expect(byTime.get(sidebarMarkerId("working-header"))?.y).toBe(83);
    expect(byTime.get("w")?.y).toBe(83);
  });

  it("updates the projection when the target or measured geometry changes", () => {
    const strategy = createSidebarSortingStrategy({
      items: pinned,
      settledOrder: [],
      settledExpanded: true,
    });
    const args = layout(pinned, "p2", "p2");
    expect(strategy({ ...args, index: 3 })?.y).toBe(0);
    expect(strategy({ ...args, index: 3, overIndex: 3 })?.y).toBe(83);
    const smaller = layout(pinned, "p2", "a1", 0.75);
    expect(strategy({ ...smaller, index: 0 })?.y).toBe(62.5);
  });

  it.each(["active", "pinned", "settled"] as const)(
    "reveals the mounted empty %s target when its last row leaves and hides it on return",
    (section) => {
      const items = [
        marker("active-placeholder"),
        thread("a", "active"),
        marker("snoozed-header"),
        thread("z", "snoozed"),
        pinnedHeader,
        pinnedPlaceholder,
        thread("p", "pinned"),
        settledHeader,
        marker("settled-placeholder"),
        thread("s", "settled"),
      ];
      const active = section === "active" ? "a" : section === "pinned" ? "p" : "s";
      const input = { items, settledOrder: ["s"], settledExpanded: true, snoozedThreadCount: 1 };
      const placeholderId = sidebarMarkerId(`${section}-placeholder`);
      const resting = preview(input, active, active);
      expect(resting.get(placeholderId)?.scaleY).toBe(0);
      const leaving = preview(
        input,
        active,
        section === "active" ? sidebarMarkerId("pinned-placeholder") : "a",
      );
      expect(leaving.get(placeholderId)?.scaleY).toBe(1);
      const returning = preview(input, active, active);
      expect(returning.get(placeholderId)?.scaleY).toBe(0);
    },
  );

  it("uses shelf height for empty target sizing when card height differs from its default", () => {
    const items = [
      thread("a", "active"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const strategy = createSidebarSortingStrategy({
      items,
      settledOrder: [],
      settledExpanded: false,
    });
    const args = layout(items, "a", sidebarMarkerId("settled-placeholder"), 1, 78);
    expect(strategy({ ...args, index: 4 })?.y).toBe(-42);
  });

  it("keeps the route row visible after a settled drop pushes it beyond the page", () => {
    const items = [
      thread("a", "active"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      thread("s", "settled"),
    ];
    const input = {
      items,
      settledOrder: ["a", "s", "hidden"],
      settledExpanded: true,
      settledVisibleCount: 1,
    };
    const withRoute = preview({ ...input, routeThreadKey: "s" }, "a", "s");
    const withoutRoute = preview(input, "a", "s");
    expect(withRoute.get("s")).toEqual({ ...stationary, y: -9 });
    expect(withoutRoute.get("s")?.scaleY).toBe(0);
  });

  it("reserves the next page row when a visible settled thread leaves", () => {
    const items = [
      thread("a", "active"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      thread("s1", "settled"),
      thread("route", "settled"),
    ];
    const result = preview(
      {
        items,
        settledOrder: ["s1", "hidden", "route"],
        settledExpanded: true,
        settledVisibleCount: 1,
        routeThreadKey: "route",
      },
      "s1",
      "a",
    );
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(83);
    expect(result.get("route")?.y).toBe(83);
  });

  it("keeps the dropped route thread visible in a collapsed settled shelf", () => {
    const items = [
      thread("a", "active"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      marker("settled-placeholder"),
    ];
    const result = preview(
      {
        items,
        settledOrder: ["a", "hidden"],
        settledExpanded: false,
        settledVisibleCount: 1,
        routeThreadKey: "a",
      },
      "a",
      sidebarMarkerId("settled-placeholder"),
    );
    expect(result.get(sidebarMarkerId("settled-placeholder"))?.scaleY).toBe(0);
    expect(result.get(sidebarMarkerId("settled-header"))?.y).toBe(-46);
  });

  it("moves the pinned projects shelf and the Pinned header with the rows above Settled", () => {
    const result = preview(
      {
        items: [
          thread("a1", "active"),
          thread("a2", "active"),
          marker("pinned-projects"),
          pinnedHeader,
          pinnedPlaceholder,
          thread("p", "pinned"),
          settledHeader,
          thread("s", "settled"),
        ],
        settledOrder: ["a1", "s"],
        settledExpanded: true,
      },
      "a1",
      sidebarMarkerId("settled-header"),
    );
    expect(result.get(sidebarMarkerId("pinned-projects"))).toEqual({ ...stationary, y: -83 });
    expect(result.get(sidebarMarkerId("pinned-header"))).toEqual({ ...stationary, y: -83 });
  });

  it("preserves hidden snoozed membership when the only rendered route row leaves", () => {
    const items = [
      thread("a", "active"),
      marker("snoozed-header"),
      thread("z", "snoozed"),
      pinnedHeader,
      pinnedPlaceholder,
      thread("p", "pinned"),
      settledHeader,
      thread("s", "settled"),
    ];
    const result = preview(
      {
        items,
        settledOrder: ["s"],
        settledExpanded: true,
        snoozedThreadCount: 2,
      },
      "z",
      "a",
    );
    expect(result.get(sidebarMarkerId("snoozed-header"))).toEqual({ ...stationary, y: 83 });
    expect(result.get(sidebarMarkerId("pinned-header"))?.y).toBe(46);
  });
});
