import { PlusIcon, TrayIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function ViewEmpty({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Empty className="animate-rise py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TrayIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {actionLabel && onAction ? (
        <EmptyContent>
          <Button size="sm" onClick={onAction}>
            <PlusIcon data-icon="inline-start" />
            {actionLabel}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
