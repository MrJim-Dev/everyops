"use client";

import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { editableFields } from "@/lib/blueprint/field-kind";
import type { Entity, RecordData } from "@/lib/blueprint/types";
import type { FieldError as EngineError } from "@/lib/engine/records";
import { FieldInput } from "./field-input";

/** The editable fields of a record, with engine errors shown under each input. */
export function RecordFieldsForm({
  entity,
  values,
  errors,
  onChange,
  idPrefix,
}: {
  entity: Entity;
  values: RecordData;
  errors: EngineError[];
  onChange: (fieldId: string, value: RecordData[string]) => void;
  idPrefix: string;
}) {
  return (
    <FieldGroup className="gap-4">
      {editableFields(entity).map((field) => {
        const error = errors.find((e) => e.fieldId === field.id);
        const id = `${idPrefix}-${field.id}`;
        const inline = field.type === "checkbox";
        return (
          <Field
            key={field.id}
            data-invalid={error ? true : undefined}
            orientation={inline ? "horizontal" : "vertical"}
          >
            {inline ? null : (
              <FieldLabel htmlFor={id}>
                {field.name}
                {field.required ? (
                  <span aria-hidden="true" className="text-muted-foreground">
                    *
                  </span>
                ) : null}
              </FieldLabel>
            )}
            <FieldInput
              id={id}
              field={field}
              value={values[field.id]}
              invalid={!!error}
              onChange={(v) => onChange(field.id, v)}
            />
            {inline ? <FieldLabel htmlFor={id}>{field.name}</FieldLabel> : null}
            {field.description && !error ? <FieldDescription>{field.description}</FieldDescription> : null}
            {error ? <FieldError>{error.message}</FieldError> : null}
          </Field>
        );
      })}
    </FieldGroup>
  );
}
