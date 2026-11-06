import type {
  EnvironmentId,
  GitExplorerOverviewInput,
  GitExplorerOverviewResult,
} from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useGitExplorerAction } from "./useGitExplorerAction";

export interface GitExplorerTagRequest {
  action: "create" | "push" | "delete";
  revision: string;
  tagName?: string;
}

export function GitExplorerTagAction(
  props: GitExplorerTagRequest & {
    environmentId: EnvironmentId;
    input: GitExplorerOverviewInput;
    overview: GitExplorerOverviewResult;
    refresh: () => void;
    onBusyChange: (busy: boolean) => void;
    onClose: () => void;
  },
) {
  const [overview] = useState(props.overview);
  const [name, setName] = useState(props.tagName ?? "");
  const [message, setMessage] = useState("");
  const remotes = overview.remotes ?? [];
  const [remote, setRemote] = useState(remotes.includes("origin") ? "origin" : (remotes[0] ?? ""));
  const [push, setPush] = useState(false);
  const [created, setCreated] = useState(false);
  const [unexpectedError, setUnexpectedError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const { execute, pending, allowed, failureMessage } = useGitExplorerAction({
    ...props,
    overview,
  });
  const creating = props.action === "create" && !created;
  const deleting = props.action === "delete";
  const needsRemote = !deleting && (!creating || push);
  const submit = async () => {
    if (inFlight.current || !allowed || !name.trim() || (needsRemote && !remote)) return;
    inFlight.current = true;
    setUnexpectedError(null);
    try {
      const target = { tagName: name.trim(), revision: props.revision };
      const ready = !creating || (await execute({ action: "create-tag", ...target, message }));
      if (creating && ready) setCreated(true);
      if (ready && creating && !push) props.onClose();
      else if (
        ready &&
        (await execute({
          action: deleting ? "delete-tag" : "push-tag",
          ...target,
          ...(deleting ? {} : { remote }),
        }))
      )
        props.onClose();
    } catch (error) {
      setUnexpectedError(error instanceof Error ? error.message : "Refresh and try again.");
    }
    inFlight.current = false;
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogPopup>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {deleting ? "Delete local tag" : creating ? "Add tag" : "Push tag"}
            </DialogTitle>
            <DialogDescription>
              {deleting
                ? "Remove this tag from the local repository. A tag already pushed to a remote is kept there."
                : creating
                  ? "Tag the selected commit. Add an annotation to create an annotated tag."
                  : "Push this tag to the selected remote."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-6 py-4 text-xs">
            <p className="break-all text-muted-foreground">{overview.selectedWorktreePath}</p>
            <p>
              Commit <span className="font-mono">{props.revision.slice(0, 12)}</span>
            </p>
            <Input
              aria-label="Tag name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!creating || pending}
              maxLength={1024}
              autoFocus={creating}
            />
            {creating ? (
              <>
                <Input
                  aria-label="Annotation (optional)"
                  placeholder="Annotation (optional)"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  disabled={pending}
                  maxLength={10000}
                />
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={push}
                    onCheckedChange={(checked) => setPush(checked === true)}
                    disabled={pending || remotes.length === 0}
                  />
                  Push tag to remote
                </label>
              </>
            ) : null}
            {needsRemote ? (
              <Select
                value={remote || null}
                onValueChange={(value) => {
                  if (value) setRemote(value);
                }}
                disabled={pending}
              >
                <SelectTrigger aria-label="Remote">
                  <SelectValue placeholder="Choose a remote" />
                </SelectTrigger>
                <SelectPopup>
                  {remotes.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
            {!deleting && remotes.length === 0 ? (
              <p className="text-muted-foreground">Configure a Git remote to push tags.</p>
            ) : null}
            {created && !pending ? (
              <p role="status">Tag created locally. Retry the push, or close to keep it local.</p>
            ) : null}
            {failureMessage || unexpectedError ? (
              <p role="alert" className="text-destructive">
                {failureMessage ?? unexpectedError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={props.onClose}>
              {pending || created ? "Close" : "Cancel"}
            </Button>
            <Button
              type="submit"
              variant={deleting ? "destructive" : "default"}
              disabled={!allowed || pending || !name.trim() || (needsRemote && !remote)}
            >
              {pending
                ? "Working…"
                : deleting
                  ? "Delete local tag"
                  : creating
                    ? push
                      ? "Add and push tag"
                      : "Add tag"
                    : "Push tag"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
