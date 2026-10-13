"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Text that eases in when its value changes (totals, stats). The first render
 * is static so pages don't animate every number on load.
 */
export function AnimatedValue({ value, className }: { value: string; className?: string }) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  return (
    <span key={value} className={cn("inline-block", mounted.current && "animate-value", className)}>
      {value}
    </span>
  );
}
