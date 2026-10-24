import type { GitExplorerHistoryInput } from "@t3tools/contracts";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export interface GitExplorerHistoryFilters {
  historyScope: "all" | "current";
  searchField: NonNullable<GitExplorerHistoryInput["searchField"]>;
  search: string;
}

export function GitExplorerHistoryFilters({
  filters,
  onChange,
}: {
  filters: GitExplorerHistoryFilters;
  onChange: (filters: GitExplorerHistoryFilters) => void;
}) {
  const { historyScope, searchField, search: query } = filters;
  return (
    <div className="flex min-w-96 flex-1 items-center gap-1" aria-label="History filters">
      <Select
        value={historyScope}
        onValueChange={(value) => {
          if (value) onChange({ ...filters, historyScope: value });
        }}
      >
        <SelectTrigger size="compact" variant="ghost" aria-label="History scope">
          <SelectValue>{historyScope === "all" ? "All branches" : "Current branch"}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="all">All branches</SelectItem>
          <SelectItem value="current">Current branch</SelectItem>
        </SelectPopup>
      </Select>
      <Select
        value={searchField}
        onValueChange={(value) => {
          if (value) onChange({ ...filters, searchField: value });
        }}
      >
        <SelectTrigger size="compact" variant="ghost" aria-label="Search field">
          <SelectValue>
            {
              { message: "Message", author: "Author", hash: "Commit hash", path: "File path" }[
                searchField
              ]
            }
          </SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value="message">Message</SelectItem>
          <SelectItem value="author">Author</SelectItem>
          <SelectItem value="hash">Commit hash</SelectItem>
          <SelectItem value="path">File path</SelectItem>
        </SelectPopup>
      </Select>
      <div className="min-w-36 flex-1">
        <Input
          size="compact"
          type="search"
          aria-label="Search history"
          maxLength={256}
          value={query}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          placeholder={
            searchField === "path"
              ? "Relative file or directory path"
              : searchField === "hash"
                ? "Commit hash (at least 4 characters)"
                : `Search by ${searchField}`
          }
        />
      </div>
      {query ? (
        <Button size="xs" variant="ghost" onClick={() => onChange({ ...filters, search: "" })}>
          Clear
        </Button>
      ) : null}
    </div>
  );
}
