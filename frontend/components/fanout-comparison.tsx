"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import {
  FanoutDispatchMode,
  FanoutFields,
  FanoutTraceOptions,
} from "@/components/fanout-fields";
import { FanoutResults } from "@/components/fanout-results";
import { Notice } from "@/components/surface";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fanoutRequest,
  type FanoutExperiment,
  type FanoutComparisonSettings,
} from "@/lib/fanout";

export function FanoutComparison({
  initial,
  href,
}: {
  initial: FanoutComparisonSettings;
  href: string;
}) {
  const [config, setConfig] = useState(initial);
  const [data, setData] = useState<FanoutExperiment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      setData(
        await fanoutRequest<FanoutExperiment>("/api/research/fan-out", config),
      );
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "The experiment failed.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader section="compare" compareHref={href} />
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Compare fan-out
            </h1>
            <p className="mt-2 max-w-2xl text-muted-foreground">
              Compare shard counts or call order with the same seeded arrivals
              and backend work.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/compare">Compare routing</Link>
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Paired experiment</CardTitle>
            <CardDescription>
              {config.comparison === "order"
                ? "Both modes use the same shard count and CPU settings. If an outage is set, each mode runs with and without that outage."
                : config.outage_ms > 0
                  ? "All four cases use the same CPU slowdown. Both outage cases take the same shard offline at the same time."
                  : "With outages off, each width runs with normal CPU speed and with the configured slow shard."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={run}>
              <fieldset disabled={busy} className="flex flex-col gap-4">
                <FieldGroup>
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="fanout-comparison">
                        Compare
                      </FieldLabel>
                      <NativeSelect
                        id="fanout-comparison"
                        value={config.comparison}
                        onChange={(event) =>
                          setConfig({
                            ...config,
                            comparison:
                              event.target.value === "order"
                                ? "order"
                                : "width",
                          })
                        }
                      >
                        <NativeSelectOption value="width">
                          One vs. four shards
                        </NativeSelectOption>
                        <NativeSelectOption value="order">
                          Parallel vs. serial
                        </NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    {config.comparison === "order" ? (
                      <Field>
                        <FieldLabel htmlFor="fanout-order-width">
                          Shards per request
                        </FieldLabel>
                        <NativeSelect
                          id="fanout-order-width"
                          value={config.order_width}
                          onChange={(event) =>
                            setConfig({
                              ...config,
                              order_width: event.target.value === "2" ? 2 : 4,
                            })
                          }
                        >
                          <NativeSelectOption value="2">
                            2 shards
                          </NativeSelectOption>
                          <NativeSelectOption value="4">
                            4 shards
                          </NativeSelectOption>
                        </NativeSelect>
                      </Field>
                    ) : (
                      <FanoutDispatchMode
                        config={config}
                        onChange={setConfig}
                        disabled={busy}
                      />
                    )}
                  </FieldGroup>
                  <FieldSet>
                    <FieldLegend>Workload and timing</FieldLegend>
                    <FanoutFields
                      config={config}
                      onChange={setConfig}
                      names={[
                        "rate",
                        "duration",
                        "deadline_ms",
                        "rtt_ms",
                        "outage_ms",
                      ]}
                      disabled={busy}
                    />
                  </FieldSet>
                  <Separator />
                  <FieldSet>
                    <FieldLegend>Slow-shard condition</FieldLegend>
                    <FanoutFields
                      config={config}
                      onChange={setConfig}
                      names={["slow_shard", "slowdown"]}
                      disabled={busy}
                    />
                  </FieldSet>
                  <FanoutTraceOptions
                    config={config}
                    onChange={setConfig}
                    disabled={busy}
                  />
                </FieldGroup>
                <Button type="submit" className="self-start">
                  {busy ? "Running experiment…" : "Run experiment"}
                </Button>
              </fieldset>
            </form>
          </CardContent>
        </Card>
        {error && <Notice error>{error}</Notice>}
        {data && (
          <FanoutResults
            cases={data.cases}
            demandMs={data.offered_backend_demand_ms}
          />
        )}
      </main>
    </div>
  );
}
