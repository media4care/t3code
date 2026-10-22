import type { ReactNode } from "react";
import { FolderGit2Icon } from "lucide-react";

import { Button } from "../ui/button";

export function GitExplorerNotice({
  title,
  children,
  retry,
}: {
  title: string;
  children?: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <FolderGit2Icon className="size-7 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium" role="status">
        {title}
      </p>
      {children ? (
        <div className="max-w-sm break-words text-xs text-muted-foreground">{children}</div>
      ) : null}
      {retry ? (
        <Button size="sm" variant="outline" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
