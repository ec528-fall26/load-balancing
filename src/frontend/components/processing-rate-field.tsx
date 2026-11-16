"use client";

import { useId, useState } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

export function ProcessingRateField({
  rates,
  onChange,
}: {
  rates?: number[];
  onChange: (rates: number[] | undefined) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const formatted = rates?.map((rate) => Number.isNaN(rate) ? "" : String(rate)).join(", ") ?? "";

  return (
    <Field>
      <FieldLabel htmlFor={id}>Processing rates</FieldLabel>
      <Textarea
        id={id}
        rows={2}
        value={draft ?? formatted}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const value = event.target.value;
          setDraft(value);
          onChange(value.trim()
            ? value.split(",").map((rate) => rate.trim() ? Number(rate) : NaN)
            : undefined);
        }}
      />
      <FieldDescription>
        Enter one comma-separated rate per server. Leave blank to use 1× for
        every server. New servers get 1× when you resize a fleet with custom rates.
      </FieldDescription>
    </Field>
  );
}
