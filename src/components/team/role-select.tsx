"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type Member, ROLES } from "@/lib/store/workspaces";

const ITEMS = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));

export function RoleSelect({
  value,
  onChange,
  label,
  className,
}: {
  value: Member["role"];
  onChange: (role: Member["role"]) => void;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Member["role"])} items={ITEMS}>
      <SelectTrigger aria-label={label} className={className ?? "w-[120px]"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="w-64">
        <SelectGroup>
          {ROLES.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              <span className="flex flex-col">
                <span>{r.label}</span>
                <span className="text-[12px] text-muted-foreground">{r.description}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
