import type { LegendListRef } from "@legendapp/list/react";
import { useId, useRef, type KeyboardEvent } from "react";

export function useGitExplorerListNavigation({
  count,
  selectedIndex,
  rowHeight,
  onSelect,
}: {
  count: number;
  selectedIndex: number;
  rowHeight: number;
  onSelect: (index: number) => void;
}) {
  const listRef = useRef<LegendListRef | null>(null);
  const id = useId();
  const optionId = (index: number) => `${id}-${index}`;
  const select = (index: number) => {
    // Focus stays on the list so recycling an offscreen row cannot strand the keyboard.
    listRef.current?.getScrollableNode().focus({ preventScroll: true });
    onSelect(index);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      count === 0
    )
      return;
    const pageSize = Math.max(1, Math.floor(event.currentTarget.clientHeight / rowHeight));
    let index: number;
    switch (event.key) {
      case "ArrowDown":
        index = selectedIndex < 0 ? 0 : selectedIndex + 1;
        break;
      case "ArrowUp":
        index = selectedIndex < 0 ? 0 : selectedIndex - 1;
        break;
      case "Home":
        index = 0;
        break;
      case "End":
        index = count - 1;
        break;
      case "PageDown":
        index = selectedIndex < 0 ? 0 : selectedIndex + pageSize;
        break;
      case "PageUp":
        index = selectedIndex < 0 ? 0 : selectedIndex - pageSize;
        break;
      case "Enter":
      case " ":
        index = Math.max(0, selectedIndex);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    index = Math.max(0, Math.min(count - 1, index));
    select(index);
    void listRef.current?.scrollIndexIntoView({ index, animated: false });
  };
  return {
    listProps: {
      ref: listRef,
      role: "listbox",
      tabIndex: 0,
      "aria-activedescendant": selectedIndex >= 0 ? optionId(selectedIndex) : undefined,
      onKeyDown,
    },
    optionProps: (index: number) => ({
      id: optionId(index),
      role: "option",
      tabIndex: -1,
      "aria-selected": index === selectedIndex,
      "aria-posinset": index + 1,
      "aria-setsize": count,
      onClick: () => select(index),
    }),
  };
}
