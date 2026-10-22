import type { AsyncResult, Atom } from "effect/reactivity";
import { useState, useSyncExternalStore } from "react";

import { useEnvironmentQuery } from "~/state/query";

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function readVisibility() {
  return document.visibilityState === "visible";
}

function serverVisibility() {
  return false;
}

export function useGitExplorerQuery<A, E>(atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null) {
  const visible = useSyncExternalStore(subscribeVisibility, readVisibility, serverVisibility);
  const query = useEnvironmentQuery(visible ? atom : null);
  const [kept, setKept] = useState<{
    atom: typeof atom;
    data: A;
    updatedAt: number;
  } | null>(null);
  if (
    query.data !== null &&
    (kept?.atom !== atom || kept.data !== query.data || kept.updatedAt !== query.dataUpdatedAt)
  ) {
    setKept({ atom, data: query.data, updatedAt: query.dataUpdatedAt });
  }
  // Keeping the rendered snapshot lets the query subscriptions expire while
  // another browser tab is active without discarding the user's review position.
  return {
    ...query,
    data: query.data ?? (kept?.atom === atom ? kept.data : null),
    dataUpdatedAt: query.dataUpdatedAt || (kept?.atom === atom ? kept.updatedAt : 0),
  };
}
