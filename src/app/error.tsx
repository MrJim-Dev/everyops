"use client";

import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/** Something broke while rendering. Offer a retry and a way home instead of a blank screen. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-shell p-6">
      <Empty className="animate-rise">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WarningIcon />
          </EmptyMedia>
          <EmptyTitle>Something went wrong</EmptyTitle>
          <EmptyDescription>
            This page hit an unexpected error. Your data is safe; try again, or go back to your workspaces.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
          <Button onClick={reset}>
            <ArrowClockwiseIcon data-icon="inline-start" />
            Try again
          </Button>
          <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
            Your workspaces
          </Button>
        </EmptyContent>
        {error.digest ? <p className="text-[12px] text-muted-foreground">Reference {error.digest}</p> : null}
      </Empty>
    </div>
  );
}
