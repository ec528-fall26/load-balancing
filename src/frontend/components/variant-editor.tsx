"use client";
import { useId } from "react";
import {
  settings,
  updateSetting,
  settingValue,
  type CompareConfig,
} from "@/lib/comparison";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AvailabilityNote } from "@/components/availability-note";
import {
  formatAvailabilities,
  formatRepairTimes,
  parseAvailabilities,
  parseRepairTimes,
} from "@/lib/availability";
export function VariantEditor({
  base,
  config,
  fields,
  onFields,
  onChange,
  disabled,
}: {
  base: CompareConfig;
  config: CompareConfig;
  fields: string[];
  onFields: (keys: string[]) => void;
  onChange: (config: CompareConfig) => void;
  disabled: boolean;
}) {
  const id = useId(),
    descriptors = settings(config),
    available = descriptors.filter((s) => !fields.includes(s.key));
  return (
    <FieldGroup>
      {fields.map((key) => {
        const s = descriptors.find((s) => s.key === key);
        if (!s) return null;
        return (
          <FieldGroup key={key} className="gap-2">
            {s.options ? (
              <Field>
                <FieldLabel htmlFor={`${id}-${key}`}>{s.label}</FieldLabel>
                <Select
                  disabled={disabled}
                  value={String(s.value)}
                  onValueChange={(value) =>
                    onChange(updateSetting(config, key, value))
                  }
                >
                  <SelectTrigger id={`${id}-${key}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {Object.entries(s.options).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : key === "processing_rates" ? (
              <Field>
                <FieldLabel htmlFor={`${id}-rates`}>
                  Processing rates
                </FieldLabel>
                <Textarea
                  id={`${id}-rates`}
                  disabled={disabled}
                  value={Array.isArray(s.value) ? s.value.join(", ") : ""}
                  onChange={(e) =>
                    onChange(
                      updateSetting(
                        config,
                        key,
                        e.target.value.trim()
                          ? e.target.value
                              .split(",")
                              .map((v) => Number(v.trim()))
                          : undefined,
                      ),
                    )
                  }
                />
                <FieldDescription>
                  One comma-separated multiplier per server. Empty uses 1×.
                </FieldDescription>
              </Field>
            ) : key === "availabilities" && !("topology" in config) ? (
              <Field>
                <FieldLabel htmlFor={`${id}-availability`}>
                  Server availability
                </FieldLabel>
                <Input
                  id={`${id}-availability`}
                  inputMode="decimal"
                  placeholder="1 (never fails)"
                  disabled={disabled}
                  defaultValue={formatAvailabilities(config.availabilities)}
                  onChange={(e) =>
                    onChange(
                      updateSetting(
                        config,
                        key,
                        parseAvailabilities(e.target.value, config.server_count),
                      ),
                    )
                  }
                />
                <FieldDescription>
                  Fraction of time a server is up (0–1). One value for every
                  server, or one per server separated by commas.
                </FieldDescription>
                <AvailabilityNote config={config} />
              </Field>
            ) : key === "mean_repair_time" && !("topology" in config) ? (
              <Field>
                <FieldLabel htmlFor={`${id}-repair`}>
                  Mean time to recover (s)
                </FieldLabel>
                <Input
                  id={`${id}-repair`}
                  inputMode="decimal"
                  disabled={disabled}
                  defaultValue={formatRepairTimes(config.mean_repair_time)}
                  onChange={(e) =>
                    onChange(
                      updateSetting(config, key, parseRepairTimes(e.target.value)),
                    )
                  }
                />
                <FieldDescription>
                  Average outage length. One value for every server, or one
                  per server separated by commas.
                </FieldDescription>
              </Field>
            ) : (
              <NumberField
                label={s.label}
                value={s.value as number}
                step={s.step}
                onChange={(value) =>
                  onChange(updateSetting(config, key, value))
                }
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="caption">Baseline: {settingValue(base, key)}</p>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`Reset ${s.label}`}
                onClick={() => {
                  onChange(
                    updateSetting(
                      config,
                      key,
                      settings(base).find((s) => s.key === key)?.value,
                    ),
                  );
                  onFields(fields.filter((k) => k !== key));
                }}
              >
                Reset
              </Button>
            </div>
          </FieldGroup>
        );
      })}
      {!!available.length && (
        <Field>
          <FieldLabel htmlFor={`${id}-add`}>Change a setting</FieldLabel>
          <Select
            value=""
            disabled={disabled}
            onValueChange={(key) => onFields([...fields, key])}
          >
            <SelectTrigger id={`${id}-add`}>
              <SelectValue
                placeholder={
                  fields.length ? "Add another setting…" : "Choose a setting…"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {[...new Set(available.map((s) => s.group))].map((group) => (
                <SelectGroup key={group}>
                  <SelectLabel>{group}</SelectLabel>
                  {available
                    .filter((s) => s.group === group)
                    .map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Add multiple settings to this variant. Unselected settings stay
            identical to the baseline.
          </FieldDescription>
        </Field>
      )}
    </FieldGroup>
  );
}
