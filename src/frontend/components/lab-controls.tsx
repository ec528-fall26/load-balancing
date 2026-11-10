"use client";
import Link from "next/link";
import { Play, LoaderCircle } from "lucide-react";
import { policies, type Config } from "@/lib/engine";
import { regionalPolicies } from "@/lib/policy-metadata";
import type { RegionalTopology } from "@/lib/regions";
import { RegionalSettings } from "@/components/regional-settings";
import { RequestModelFields } from "@/components/request-model-fields";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
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
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

type Props = {
  config: Config;
  onChange: (c: Config) => void;
  name: string;
  execution: string;
  onExecution: (v: string) => void;
  topology: string;
  onTopology: (v: string) => void;
  regional: RegionalTopology;
  onRegional: (v: RegionalTopology) => void;
  regionalPolicy: string;
  onRegionalPolicy: (v: string) => void;
  onRun: () => void;
  busy: boolean;
  active: boolean;
  ready: boolean;
};
export function LabControls(p: Props) {
  const c = p.config,
    single = p.topology === "single_pool";
  const servers = single
    ? c.server_count
    : p.regional.regions.reduce((n, r) => n + r.servers, 0);
  const slots = single
    ? c.server_count * c.concurrency
    : p.regional.regions.reduce(
        (n, r) => n + r.servers * r.slots_per_server,
        0,
      );
  const select = (
    label: string,
    value: string,
    options: Record<string, string>,
    onChange: (v: string) => void,
  ) => (
    <Field>
      <FieldLabel htmlFor={`setup-${label}`}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={`setup-${label}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {Object.entries(options).map(([key, text]) => (
              <SelectItem key={key} value={key}>
                {text}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        p.onRun();
      }}
    >
      <fieldset
        disabled={p.busy}
        className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="infrastructure-title">
            <Card>
              <CardHeader>
                <CardTitle id="infrastructure-title">Infrastructure</CardTitle>
                <CardDescription>
                  Choose where requests run and how much work can run at once.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {select(
                  "Topology",
                  p.topology,
                  { single_pool: "Single server pool", regions: "Regions" },
                  p.onTopology,
                )}
                {single ? (
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <NumberField
                      label="Server count"
                      value={c.server_count}
                      onChange={(n) => p.onChange({ ...c, server_count: n })}
                    />
                    <NumberField
                      label="Slots per server"
                      value={c.concurrency}
                      onChange={(n) => p.onChange({ ...c, concurrency: n })}
                    />
                    {c.request_model !== "cpu_io" && (
                      <NumberField
                        label="Waiting places per server"
                        value={c.queue_limit}
                        help="Zero disables the waiting queue."
                        onChange={(n) => p.onChange({ ...c, queue_limit: n })}
                      />
                    )}
                  </FieldGroup>
                ) : (
                  <RegionalSettings
                    value={p.regional}
                    onChange={p.onRegional}
                    policy={p.regionalPolicy}
                    onPolicyChange={p.onRegionalPolicy}
                    hidePolicy
                  />
                )}
              </CardContent>
            </Card>
          </section>
          <section aria-labelledby="traffic-title">
            <Card>
              <CardHeader>
                <CardTitle id="traffic-title">Traffic and routing</CardTitle>
                <CardDescription>
                  Define the requests and how the load balancer chooses a
                  destination.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label="Requests per second"
                    value={c.arrival_rate}
                    step={0.01}
                    onChange={(n) => p.onChange({ ...c, arrival_rate: n })}
                  />
                  {select(
                    single ? "Routing policy" : "Regional routing policy",
                    single ? c.policy : p.regionalPolicy,
                    single ? policies : regionalPolicies,
                    (v) =>
                      single
                        ? p.onChange({ ...c, policy: v as Config["policy"] })
                        : p.onRegionalPolicy(v),
                  )}
                </FieldGroup>
                {single && (
                  <RequestModelFields
                    config={c}
                    onChange={p.onChange}
                    view="basic"
                  />
                )}
                {single && c.request_model === "cpu_io" && (
                  <Accordion type="single" collapsible>
                    <AccordionItem value="io">
                      <AccordionTrigger>
                        I/O capacity and request details
                      </AccordionTrigger>
                      <AccordionContent>
                        <RequestModelFields
                          config={c}
                          onChange={p.onChange}
                          view="advanced"
                        />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label="Min service (s)"
                    value={c.service_min}
                    step={0.001}
                    onChange={(n) => p.onChange({ ...c, service_min: n })}
                  />
                  <NumberField
                    label="Max service (s)"
                    value={c.service_max}
                    step={0.001}
                    onChange={(n) => p.onChange({ ...c, service_max: n })}
                  />
                </FieldGroup>
                <FieldDescription>
                  {single && c.request_model === "cpu_io"
                    ? "Service time is CPU + I/O before queueing. Server speed changes CPU stages only."
                    : "Service time is sampled within this range before queueing."}
                </FieldDescription>
              </CardContent>
            </Card>
          </section>
          <section aria-label="Execution settings">
            <Card>
              <CardHeader>
                <CardTitle id="execution-title">Execution</CardTitle>
                <CardDescription>
                  Run a fixed workload or keep traffic flowing continuously.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  {select(
                    "Execution",
                    p.execution,
                    { one_shot: "One-shot", continuous: "Continuous" },
                    p.onExecution,
                  )}
                  {p.execution === "one_shot" && (
                    <NumberField
                      label="Arrival window (seconds)"
                      value={c.duration}
                      step={0.01}
                      onChange={(n) => p.onChange({ ...c, duration: n })}
                    />
                  )}
                  <NumberField
                    label="Random seed"
                    value={c.seed}
                    onChange={(n) => p.onChange({ ...c, seed: n })}
                  />
                </FieldGroup>
              </CardContent>
            </Card>
          </section>
        </div>
        <aside
          className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-24"
          aria-label="Configuration summary"
        >
          <Card>
            <CardHeader>
              <CardTitle>Ready to run</CardTitle>
              <CardDescription>{p.name}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {p.execution === "continuous" ? "Continuous" : "One-shot"}
                </Badge>
                <Badge variant="outline">
                  {single
                    ? "Single pool"
                    : `${p.regional.regions.length} regions`}
                </Badge>
              </div>
              <dl className="flex flex-col gap-3 text-sm">
                {[
                  ["Servers", servers.toLocaleString()],
                  ["CPU slots", slots.toLocaleString()],
                  ["Traffic", `${c.arrival_rate.toLocaleString()} requests/s`],
                  [
                    "Routing",
                    single
                      ? policies[c.policy]
                      : regionalPolicies[
                          p.regionalPolicy as keyof typeof regionalPolicies
                        ],
                  ],
                  [
                    "Workload",
                    !single || c.request_model !== "cpu_io"
                      ? "Simple service"
                      : c.io_heavy_probability !== undefined
                        ? "Mixed CPU / I/O"
                        : "CPU → I/O → CPU",
                  ],
                  ...(p.execution === "one_shot"
                    ? [
                        [
                          "Offered requests",
                          Math.floor(
                            c.arrival_rate * c.duration,
                          ).toLocaleString(),
                        ],
                      ]
                    : []),
                ].map(([label, value]) => (
                  <div className="flex justify-between gap-4" key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {p.active && (
                <p className="text-sm text-muted-foreground">
                  Your current session keeps running while you edit. Starting
                  another continuous run replaces it.
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                className="w-full"
                disabled={p.busy || !p.ready}
              >
                {p.busy ? (
                  <LoaderCircle
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <Play data-icon="inline-start" />
                )}
                {p.busy
                  ? "Running simulation…"
                  : p.execution === "continuous"
                    ? p.active
                      ? "Replace continuous session"
                      : "Start continuous simulation"
                    : "Run simulation"}
              </Button>
            </CardFooter>
          </Card>
          <Button asChild variant="ghost">
            <Link href="/">Choose another template</Link>
          </Button>
        </aside>
      </fieldset>
    </form>
  );
}
