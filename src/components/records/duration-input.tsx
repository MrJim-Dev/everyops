"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { formatDuration, parseDuration } from "@/lib/format";

/**
 * A length of time typed the usual ways ("1:30", "90", "1h 30m", "45 min"), saved as minutes. While typing it keeps
 * the text and shows what it understood at the right end of the field (inside it, so nothing below moves when the
 * hint goes); leaving the field writes it the standard way ("1 h 30 min"). Text it can't read is passed on as is, so
 * the form's check names it.
 */
export function DurationInput({
  value,
  onChange,
  ...rest
}: {
  value: number | string | null;
  onChange: (value: number | string | null) => void;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  className?: string;
  autoFocus?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const shown = typeof value === "number" ? formatDuration(value) : (value ?? "");
  const [text, setText] = useState<string | null>(null);
  const draft = text ?? shown;
  const read = text !== null ? parseDuration(text) : null;
  const hint =
    text !== null && text.trim() !== ""
      ? read !== null
        ? formatDuration(read)
        : "like 1:30 or 45 min"
      : null;
  return (
    <div className="relative">
      <Input
        {...rest}
        inputMode="text"
        placeholder="1:30, 90 or 1h 30m"
        value={draft}
        className={hint ? "pr-28" : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const minutes = parseDuration(e.target.value);
          onChange(e.target.value.trim() === "" ? null : (minutes ?? e.target.value));
        }}
        onBlur={() => setText(null)}
      />
      {hint ? (
        <span
          aria-live="polite"
          className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[12px] text-muted-foreground"
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}
