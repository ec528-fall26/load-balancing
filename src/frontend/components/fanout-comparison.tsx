"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { FanoutFields, FanoutTraceOptions } from "@/components/fanout-fields";
import { FanoutResults } from "@/components/fanout-results";
import { Notice } from "@/components/surface";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
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
  type FanoutSettings,
} from "@/lib/fanout";

export function FanoutComparison({
  initial,
  href,
}: {
  initial: FanoutSettings;
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
              Compare one and four shards with the same seeded arrivals and
              backend work. Each width runs with healthy shards and with your
              chosen CPU slowdown.
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
              Set the workload, deadline, and slow-shard condition shared by the
              four cases.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={run}>
              <fieldset disabled={busy} className="flex flex-col gap-4">
                <FieldGroup>
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
