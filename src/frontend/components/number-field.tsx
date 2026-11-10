"use client";
import { useState } from "react";
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
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState("");
  const digits = step === 1 ? 0 : step === 0.001 ? 3 : 2;
  return (
    <label>
      {label}
      {help && (
        <span className="help" title={help} aria-label={help}>
          ?
        </span>
      )}
      <span className="number">
        <input
          aria-label={label}
          type="number"
          step={step}
          value={editing ? draft : value.toFixed(digits)}
          required
          onFocus={() => {
            setDraft(String(value));
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
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(Number((value - step).toFixed(digits)))}
        >
          −
        </button>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Number((value + step).toFixed(digits)))}
        >
          +
        </button>
      </span>
    </label>
  );
}
