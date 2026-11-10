"use client";
import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
export function NumberField({
  label,
  value,
  step = 1,
  help,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  help?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState("");
  const digits = step === 1 ? 0 : step === 0.001 ? 3 : 2;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          aria-label={label}
          type="number"
          className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          step={step}
          required
          value={editing ? draft : value.toFixed(digits)}
          onFocus={(event) => {
            setDraft(event.currentTarget.value);
            setEditing(true);
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            if (
              e.target.value !== "" &&
              Number.isFinite(Number(e.target.value))
            )
              onChange(Number(e.target.value));
          }}
          onBlur={() => setEditing(false)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={`Decrease ${label}`}
            onClick={() => onChange(Number((value - step).toFixed(digits)))}
          >
            <Minus />
          </InputGroupButton>
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={`Increase ${label}`}
            onClick={() => onChange(Number((value + step).toFixed(digits)))}
          >
            <Plus />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {help && <FieldDescription id={`${id}-help`}>{help}</FieldDescription>}
    </Field>
  );
}
