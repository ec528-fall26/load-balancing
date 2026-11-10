"use client";
import { useId } from "react";
import type { Config } from "@/lib/engine";
import { NumberField } from "@/components/number-field";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";

export function RequestModelFields({
  config,
  onChange,
  disabled = false,
  showAdmission = true,
  view = "all",
}: {
  config: Config;
  onChange: (config: Config) => void;
  disabled?: boolean;
  showAdmission?: boolean;
  view?: "basic" | "advanced" | "all";
}) {
  const id = useId();
  const staged = config.request_model === "cpu_io";
  const fraction = config.io_fraction ?? 0.9;
  const profile = !staged
    ? "simple"
    : config.io_heavy_probability !== undefined
      ? "mixed"
      : fraction === 0.1
        ? "cpu"
        : fraction === 0.9
          ? "io"
          : "custom";
  function choose(value: string) {
    const {
      request_model,
      io_fraction,
      outstanding_limit,
      io_capacity,
      io_heavy_probability,
      ...simple
    } = config;
    if (value === "simple") {
      onChange(simple);
      return;
    }
    const base = {
      ...config,
      request_model: "cpu_io" as const,
      outstanding_limit:
        config.outstanding_limit ?? config.concurrency + config.queue_limit,
      io_capacity: config.io_capacity ?? (value === "cpu" ? 64 : 8),
    };
    const { io_heavy_probability: ignored, ...fixed } = base;
    onChange(
      value === "mixed"
        ? { ...fixed, io_fraction: 0.9, io_heavy_probability: 0.5 }
        : {
            ...fixed,
            io_fraction: value === "cpu" ? 0.1 : value === "io" ? 0.9 : 0.5,
          },
    );
  }
  return (
    <FieldGroup>
      {view !== "advanced" && (
        <Field>
          <FieldLabel htmlFor={id}>Workload</FieldLabel>
          <Select value={profile} onValueChange={choose} disabled={disabled}>
            <SelectTrigger id={id}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="simple">Simple requests</SelectItem>
                <SelectItem value="cpu">CPU-heavy requests</SelectItem>
                <SelectItem value="io">I/O-heavy requests</SelectItem>
                <SelectItem value="mixed">
                  Mixed CPU and I/O requests
                </SelectItem>
                <SelectItem value="custom">Custom CPU / I/O split</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {staged
              ? "CPU work → shared I/O → CPU work. Requests can queue at either resource."
              : "One execution slot stays occupied for the request's service time."}
          </FieldDescription>
        </Field>
      )}
      {staged && view !== "basic" && (
        <>
          {profile === "mixed" ? (
            <NumberField
              label="I/O-heavy requests (%)"
              value={(config.io_heavy_probability ?? 0.5) * 100}
              step={1}
              help="Requests are either 90% or 10% I/O. Seeded request types stay identical across policies."
              onChange={(n) =>
                onChange({ ...config, io_heavy_probability: n / 100 })
              }
            />
          ) : (
            <NumberField
              label="I/O share (%)"
              value={fraction * 100}
              step={1}
              help="Remaining work is split between two CPU stages."
              onChange={(n) => onChange({ ...config, io_fraction: n / 100 })}
            />
          )}
          <NumberField
            label="Concurrent I/O operations"
            value={config.io_capacity ?? 64}
            step={1}
            help="One shared pool for all servers. Extra calls queue here."
            onChange={(n) => onChange({ ...config, io_capacity: n })}
          />
          {showAdmission && (
            <NumberField
              label="Outstanding limit per server"
              value={
                config.outstanding_limit ??
                config.concurrency + config.queue_limit
              }
              step={1}
              help="Includes CPU work, I/O and both queues. Full targets reject new arrivals."
              onChange={(n) => onChange({ ...config, outstanding_limit: n })}
            />
          )}
        </>
      )}
    </FieldGroup>
  );
}
