"use client";

import { useId, useState } from "react";
import { CircleHelp } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fanoutFields,
  type FanoutSettings,
  type ShardedConfig,
} from "@/lib/fanout";

const help = {
  rate: "How many new parent requests arrive each second. Each parent can make multiple shard calls.",
  duration:
    "How long new requests arrive. Work already sent can finish after this window closes.",
  deadline_ms:
    "Maximum time from parent arrival through the coordinator’s final join. This includes queues, shard calls, and network travel.",
  rtt_ms:
    "Network travel time for a call to reach a shard and for its reply to return. CPU time, I/O time, and queueing are separate.",
  slow_shard:
    "Choose which of the four shard servers has slower CPU service. Placement rotates across the fleet.",
  slowdown:
    "Multiplies CPU time on the selected shard. At 1× all four shards run at normal speed. I/O and network time stay the same.",
  seed: "Repeat the same arrivals and work per request by keeping the seed and arrival settings fixed.",
  inspect:
    "Pick the parent whose timeline is shown in the results. Request 0 is the first arrival.",
  width:
    "Split the same work into one, two, or four parallel shard calls. The coordinator waits for every required reply.",
};

export function ParameterHelp({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`About ${label.toLowerCase()}`}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={4}>{description}</TooltipContent>
    </Tooltip>
  );
}

function ShardChoices({
  label,
  description,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  options: readonly { value: number; label: string }[];
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field>
      <div className="flex items-center gap-1">
        <FieldTitle id={id}>{label}</FieldTitle>
        <ParameterHelp label={label} description={description} />
      </div>
      <RadioGroup
        aria-labelledby={id}
        className="flex flex-wrap gap-x-1 gap-y-2 py-1"
        disabled={disabled}
        value={String(value)}
        onValueChange={(next) => onChange(Number(next))}
      >
        {options.map((option) => (
          <FieldLabel
            key={option.value}
            className="items-center rounded-full px-2 py-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          >
            <RadioGroupItem value={String(option.value)} />
            {option.label}
          </FieldLabel>
        ))}
      </RadioGroup>
    </Field>
  );
}

export function FanoutWidth({
  config,
  onChange,
  disabled,
}: {
  config: ShardedConfig;
  onChange: (config: ShardedConfig) => void;
  disabled?: boolean;
}) {
  return (
    <ShardChoices
      label="Shards per parent"
      description={help.width}
      options={[
        { value: 1, label: "1 shard" },
        { value: 2, label: "2 shards" },
        { value: 4, label: "4 shards" },
      ]}
      value={config.width}
      onChange={(width) =>
        onChange({ ...config, width: width as ShardedConfig["width"] })
      }
      disabled={disabled}
    />
  );
}

type FieldName = keyof FanoutSettings;
const sliderUnits = { rate: "/s", duration: "s", slowdown: "×" } as const;
const shardOptions = [0, 1, 2, 3].map((value) => ({
  value,
  label: `Shard ${value}`,
}));

export function FanoutFields<T extends FanoutSettings>({
  config,
  onChange,
  names,
  disabled,
}: {
  config: T;
  onChange: (config: T) => void;
  names: readonly FieldName[];
  disabled?: boolean;
}) {
  const id = useId();
  const maxRequest = Math.max(
    0,
    (config.rate || 1) * (config.duration || 1) - 1,
  );

  function change(name: FieldName, value: number) {
    const next = { ...config, [name]: value };
    if (
      (name === "rate" || name === "duration") &&
      Number.isInteger(next.rate) &&
      next.rate >= 1 &&
      Number.isInteger(next.duration) &&
      next.duration >= 1
    ) {
      next.inspect = Math.min(next.inspect, next.rate * next.duration - 1);
    }
    onChange(next);
  }

  return (
    <FieldGroup className="grid items-start gap-x-8 gap-y-5 sm:grid-cols-2">
      {names.map((name) => {
        const field = fanoutFields.find((entry) => entry.name === name)!;
        const { label, min, max } = field;
        const fieldId = `${id}-${name}`;
        if (name === "slow_shard") {
          return (
            <ShardChoices
              key={name}
              label="Slow shard"
              description={help[name]}
              options={shardOptions}
              value={config[name]}
              onChange={(value) => change(name, value)}
              disabled={disabled}
            />
          );
        }
        const unit =
          name === "rate" || name === "duration" || name === "slowdown"
            ? sliderUnits[name]
            : null;
        return (
          <Field key={name} className="min-w-0">
            <div className="flex items-center gap-1">
              <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
              <ParameterHelp label={label} description={help[name]} />
            </div>
            {unit ? (
              <div className="flex items-center gap-4">
                <Slider
                  aria-label={label}
                  min={min}
                  max={max}
                  value={[
                    Math.min(max, Math.max(min, config[name] || field.initial)),
                  ]}
                  onValueChange={([value]) => change(name, value)}
                  disabled={disabled}
                  className="h-8"
                />
                <InputGroup className="w-24 shrink-0">
                  <InputGroupInput
                    id={fieldId}
                    type="number"
                    inputMode="numeric"
                    required
                    min={min}
                    max={max}
                    step={1}
                    value={Number.isNaN(config[name]) ? "" : config[name]}
                    onChange={(event) =>
                      change(name, event.target.valueAsNumber)
                    }
                    disabled={disabled}
                    className="tabular-nums"
                  />
                  <InputGroupAddon align="inline-end" aria-hidden="true">
                    {unit}
                  </InputGroupAddon>
                </InputGroup>
              </div>
            ) : (
              <Input
                id={fieldId}
                type="number"
                required
                min={min}
                max={name === "inspect" ? maxRequest : max}
                step={1}
                value={Number.isNaN(config[name]) ? "" : config[name]}
                onChange={(event) => change(name, event.target.valueAsNumber)}
              />
            )}
          </Field>
        );
      })}
    </FieldGroup>
  );
}

export function FanoutTraceOptions<T extends FanoutSettings>(props: {
  config: T;
  onChange: (config: T) => void;
  disabled?: boolean;
}) {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="trace">
        <AccordionTrigger>Seed and request timeline</AccordionTrigger>
        <AccordionContent className="px-1 pt-1">
          <FanoutFields {...props} names={["seed", "inspect"]} />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
