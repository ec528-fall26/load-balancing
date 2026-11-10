"use client";
import { useEffect, useState } from "react";
import {
  regionalRequest,
  type RegionPreset,
  type RegionalTopology,
} from "@/lib/regions";
import { NumberField } from "@/components/number-field";
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
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Notice } from "@/components/surface";
export const initialRegions: RegionalTopology = {
  regions: [
    {
      name: "us-east-1",
      servers: 10,
      slots_per_server: 4,
      compute: 1,
      queue_per_server: 10,
    },
    {
      name: "us-east-2",
      servers: 10,
      slots_per_server: 4,
      compute: 1,
      queue_per_server: 10,
    },
    {
      name: "us-west-1",
      servers: 10,
      slots_per_server: 4,
      compute: 1,
      queue_per_server: 10,
    },
  ],
  latency_ms: [
    [2, 12, 75],
    [12, 2, 65],
    [75, 65, 2],
  ],
  client_latency_ms: [2, 12, 75],
  source: 0,
};
export function RegionalSettings({
  value,
  onChange,
  policy,
  onPolicyChange,
}: {
  value: RegionalTopology;
  onChange: (v: RegionalTopology) => void;
  policy: string;
  onPolicyChange: (v: string) => void;
}) {
  const [presets, setPresets] = useState<RegionPreset[]>([]),
    [preset, setPreset] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    regionalRequest<{ presets: RegionPreset[] }>("presets")
      .then((data) => {
        if (alive) setPresets(data.presets);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  function edit(next: RegionalTopology) {
    setPreset("");
    onChange(next);
  }
  return (
    <FieldGroup>
      {error && <Notice error>{error}</Notice>}
      <Field>
        <FieldLabel htmlFor="region-preset">Regional preset</FieldLabel>
        <Select
          value={preset}
          onValueChange={(id) => {
            const p = presets.find((p) => p.id === id);
            if (p) {
              setPreset(id);
              const { id: _id, ...topology } = p;
              onChange(structuredClone(topology));
            }
          }}
        >
          <SelectTrigger id="region-preset">
            <SelectValue placeholder="Custom regional setup" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {presets.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.id}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          Illustrative RTTs, not measured cloud-provider latency.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="region-policy">Regional routing policy</FieldLabel>
        <Select value={policy} onValueChange={onPolicyChange}>
          <SelectTrigger id="region-policy">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="least_loaded">Least loaded region</SelectItem>
              <SelectItem value="round_robin">
                Round robin across regions
              </SelectItem>
              <SelectItem value="nearest">Nearest region</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          Least loaded uses (executing + waiting + outbound) / slots, then RTT.
          These are aggregate-region policies; single-pool least active counts
          only running requests.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="source-region">Source region</FieldLabel>
        <Select
          value={String(value.source)}
          onValueChange={(s) => {
            const source = Number(s);
            edit({
              ...value,
              source,
              client_latency_ms: [...value.latency_ms[source]],
            });
          }}
        >
          <SelectTrigger id="source-region">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {value.regions.map((r, i) => (
                <SelectItem value={String(i)} key={i}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          Selecting a source resets client RTTs to that matrix row. Edit them
          below for a custom client location.
        </FieldDescription>
      </Field>
      <Accordion type="multiple">
        {value.regions.map((r, i) => (
          <AccordionItem value={String(i)} key={i}>
            <AccordionTrigger>{r.name}</AccordionTrigger>
            <AccordionContent className="h-auto">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`region-name-${i}`}>
                    Region {i + 1} name
                  </FieldLabel>
                  <Input
                    id={`region-name-${i}`}
                    value={r.name}
                    onChange={(e) =>
                      edit({
                        ...value,
                        regions: value.regions.map((row, j) =>
                          i === j ? { ...row, name: e.target.value } : row,
                        ),
                      })
                    }
                  />
                </Field>
                {(
                  [
                    ["servers", "Servers"],
                    ["slots_per_server", "Slots per server"],
                    ["compute", "Compute multiplier"],
                    ["queue_per_server", "Waiting places per server"],
                  ] as const
                ).map(([key, label]) => (
                  <NumberField
                    key={key}
                    label={`${r.name} ${label}`}
                    step={key === "compute" ? 0.1 : 1}
                    value={r[key]}
                    onChange={(v) =>
                      edit({
                        ...value,
                        regions: value.regions.map((row, j) =>
                          i === j ? { ...row, [key]: v } : row,
                        ),
                      })
                    }
                  />
                ))}
                <NumberField
                  label={`Client RTT to ${r.name} (ms)`}
                  value={value.client_latency_ms[i]}
                  onChange={(v) =>
                    edit({
                      ...value,
                      client_latency_ms: value.client_latency_ms.map((n, j) =>
                        i === j ? v : n,
                      ),
                    })
                  }
                />
              </FieldGroup>
            </AccordionContent>
          </AccordionItem>
        ))}
        <AccordionItem value="rtt">
          <AccordionTrigger>Regional RTT matrix</AccordionTrigger>
          <AccordionContent className="h-auto">
            <FieldGroup>
              <FieldDescription>
                Directed RTT assumptions in milliseconds. Editing the source row
                does not overwrite separately edited client RTTs; reselect a
                source to copy its row.
              </FieldDescription>
              {value.latency_ms.flatMap((row, i) =>
                row.map((n, j) => (
                  <NumberField
                    key={`${i}-${j}`}
                    label={`${value.regions[i].name} to ${value.regions[j].name} (ms)`}
                    value={n}
                    onChange={(v) =>
                      edit({
                        ...value,
                        latency_ms: value.latency_ms.map((r, k) =>
                          i === k ? r.map((x, l) => (j === l ? v : x)) : r,
                        ),
                      })
                    }
                  />
                )),
              )}
            </FieldGroup>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </FieldGroup>
  );
}
