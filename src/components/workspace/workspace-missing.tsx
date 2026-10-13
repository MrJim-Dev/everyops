import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function WorkspaceMissing({ kind = "workspace" }: { kind?: "workspace" | "system" }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-shell p-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MagnifyingGlassIcon />
          </EmptyMedia>
          <EmptyTitle>{kind === "workspace" ? "Workspace not found" : "System not found"}</EmptyTitle>
          <EmptyDescription>
            {kind === "workspace"
              ? "It may have been created in another browser. Workspaces are saved on this device for now."
              : "This community system may have been removed."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<Link href={kind === "workspace" ? "/" : "/community"} />} nativeButton={false}>
            {kind === "workspace" ? "Go to your workspaces" : "Browse community systems"}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
