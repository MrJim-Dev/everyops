"use client";

import { BarcodeIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import type { Field } from "@/lib/blueprint/types";
import { ScanDialog } from "./scan-dialog";

/** A text field for a code (Barcode, SKU, Serial number) with a button that scans it in. */
export function ScanInput({
  id,
  field,
  value,
  onChange,
  invalid,
}: {
  id: string;
  field: Field;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  return (
    <>
      <InputGroup>
        <InputGroupInput
          id={id}
          aria-invalid={invalid || undefined}
          aria-required={field.required || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={`Scan ${field.name.toLowerCase()}`}
            onClick={() => setScanning(true)}
          >
            <BarcodeIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <ScanDialog
        open={scanning}
        onOpenChange={setScanning}
        title={`Scan ${field.name.toLowerCase()}`}
        onScan={onChange}
      />
    </>
  );
}
