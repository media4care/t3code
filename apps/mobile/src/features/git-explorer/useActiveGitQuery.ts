import { useIsFocused } from "@react-navigation/native";
import { useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import type { AsyncResult, Atom } from "effect/reactivity";

import { useEnvironmentQuery } from "../../state/query";

function subscribeToAppState(onChange: () => void) {
  const listener = AppState.addEventListener("change", onChange);
  return () => listener.remove();
}
const appIsActive = () => AppState.currentState === "active";

export function useGitExplorerActive() {
  const focused = useIsFocused();
  const foreground = useSyncExternalStore(subscribeToAppState, appIsActive, appIsActive);
  return focused && foreground;
}

export function useActiveGitQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
  active: boolean,
) {
  const query = useEnvironmentQuery(active ? atom : null);
  const [cached, setCached] = useState({ atom, data: query.data });
  if (atom !== cached.atom || (query.data !== null && query.data !== cached.data))
    setCached({ atom, data: query.data });
  return {
    ...query,
    data: query.data ?? (atom === cached.atom ? cached.data : null),
  };
}
