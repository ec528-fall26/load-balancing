"use client";
import { RequestModelFields } from "./request-model-fields";
import type { Config } from "@/lib/engine";
import { policies } from "@/lib/engine";
import { NumberField } from "@/components/number-field";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Panel } from "@/components/surface";
import { useId, useState } from "react";
const labels = [
  ["server_count", "Servers", 1],
  ["concurrency", "Slots / server", 1],
  ["queue_limit", "Queue / server", 1],
  ["arrival_rate", "Requests / second", 0.01],
  ["duration", "Arrival window (s)", 0.01],
] as const;
export function ConfigFields({
  config,
  onChange,
  disabled = false,
}: {
  config: Config;
  disabled?: boolean;
  onChange: (config: Config) => void;
}) {
  const id = useId();
  const [rates, setRates] = useState<string | null>(null);
  return (
    <FieldGroup>
      <RequestModelFields config={config} onChange={onChange} disabled={disabled}/>
      <FieldGroup className="grid grid-cols-2 gap-4">
        {labels.map(([key, label, step]) => (
          <NumberField
            key={key}
            label={label}
            value={config[key]}
            step={step}
            onChange={(value) => onChange({ ...config, [key]: value })}
          />
        ))}
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor={id}>Routing policy</FieldLabel>
        <Select
          value={config.policy}
          disabled={disabled}
          onValueChange={(value) =>
            onChange({ ...config, policy: value as Config["policy"] })
          }
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {Object.entries(policies).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Panel title="Service times, seed and server speeds">
        <FieldGroup>
          <FieldGroup className="grid grid-cols-2 gap-4">
            <NumberField
              label="Min service (s)"
              value={config.service_min}
              step={0.001}
              onChange={(n) => onChange({ ...config, service_min: n })}
            />
            <NumberField
              label="Max service (s)"
              value={config.service_max}
              step={0.001}
              onChange={(n) => onChange({ ...config, service_max: n })}
            />
          </FieldGroup>
          <NumberField
            label="Random seed"
            value={config.seed}
            onChange={(n) => onChange({ ...config, seed: n })}
          />
          <Field>
            <FieldLabel htmlFor={`${id}-rates`}>Processing rates</FieldLabel>
            <Textarea
              id={`${id}-rates`}
              value={rates ?? config.processing_rates?.join(", ") ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                setRates(value);
                const numbers = value.trim()
                  ? value.split(",").map((n) => Number(n.trim()))
                  : undefined;
                onChange({ ...config, processing_rates: numbers });
              }}
            />
            <FieldDescription>
              Optional comma-separated rate per server. Empty uses identical
              servers. Keep the seed unchanged to hold sampled service times
              fixed.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </Panel>
    </FieldGroup>
  );
}
