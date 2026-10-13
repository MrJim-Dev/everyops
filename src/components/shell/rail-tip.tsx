"use client";

import type { ReactElement, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** In the collapsed rail, labels move into a tooltip to the right of each icon. */
export function RailTip({
  rail,
  label,
  children,
}: {
  rail: boolean;
  label: ReactNode;
  children: ReactElement;
}) {
  if (!rail) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
