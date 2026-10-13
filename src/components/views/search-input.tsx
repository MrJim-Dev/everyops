"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <InputGroup className="h-8 w-full max-w-[260px]">
      <InputGroupAddon>
        <MagnifyingGlassIcon />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[13px]"
      />
    </InputGroup>
  );
}
