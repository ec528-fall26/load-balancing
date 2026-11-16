"use client";
import { useId, useState } from "react";
import type { Config } from "@/lib/engine";
import {
  DEFAULT_REPAIR_TIME,
  formatAvailabilities,
  formatRepairTimes,
  hasOutages,
  parseAvailabilities,
  parseRepairTimes,
  availabilityError,
} from "@/lib/availability";
import { AvailabilityNote } from "@/components/availability-note";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";

export function AvailabilityFields({
  config,
  onChange,
}: {
  config: Config;
  onChange: (config: Config) => void;
}) {
  const id = useId();
  // Raw text while typing, so partial input like "0.9," is not rewritten.
  const [text, setText] = useState<string | null>(null);
  const [repairText, setRepairText] = useState<string | null>(null);
  const error = availabilityError(config);
  return (
    <FieldGroup className="gap-4">
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor={`${id}-availability`}>
            Server availability
          </FieldLabel>
          <Input
            id={`${id}-availability`}
            inputMode="decimal"
            placeholder="1"
            aria-invalid={!!error || undefined}
            aria-describedby={`${id}-availability-help`}
            value={text ?? formatAvailabilities(config.availabilities)}
            onChange={(e) => {
              setText(e.target.value);
              const values = parseAvailabilities(
                e.target.value,
                config.server_count,
              );
              onChange({
                ...config,
                availabilities: values,
                mean_repair_time: values
                  ? (config.mean_repair_time ?? DEFAULT_REPAIR_TIME)
                  : undefined,
              });
            }}
            onBlur={() => {
              if (!availabilityError(config)) setText(null);
            }}
          />
          <FieldDescription id={`${id}-availability-help`}>
            You can enter one
            average value for all servers {"(Ex: 0.99) "}
            or enter one value per server separated by commas {" (Ex: 0.99, 0.95, 0.90)"}.
          </FieldDescription>
        </Field>
        {hasOutages(config) && (
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor={`${id}-repair`}>
              Mean time to recover (s)
            </FieldLabel>
            <Input
              id={`${id}-repair`}
              inputMode="decimal"
              placeholder={String(DEFAULT_REPAIR_TIME)}
              aria-invalid={!!error || undefined}
              aria-describedby={`${id}-repair-help`}
              value={repairText ?? formatRepairTimes(config.mean_repair_time)}
              onChange={(e) => {
                setRepairText(e.target.value);
                onChange({
                  ...config,
                  mean_repair_time: parseRepairTimes(e.target.value),
                });
              }}
              onBlur={() => {
                if (!availabilityError(config)) setRepairText(null);
              }}
            />
            <FieldDescription id={`${id}-repair-help`}>
              Average outage length in seconds. One value for all servers{" "}
              {"(Ex: 2) "}or one per server separated by commas
              {" (Ex: 1, 2, 5)"}.
            </FieldDescription>
          </Field>
        )}
      </FieldGroup>
      {error && <FieldError>{error}</FieldError>}
      <AvailabilityNote config={config} />
    </FieldGroup>
  );
}
