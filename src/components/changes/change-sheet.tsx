"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChangePlanner } from "./change-planner";

export function ChangeSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-[560px]">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-[16px] font-semibold">Ask for a change</SheetTitle>
          <SheetDescription>
            Say it in your own words. You'll review the plan before anything changes.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {open ? <ChangePlanner autoFocus onDone={() => onOpenChange(false)} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
