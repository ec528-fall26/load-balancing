"use client";
import { useMemo } from "react";
import {
  OutcomeChart,
  ResponseChart,
  UtilizationChart,
  histogram,
} from "./chart";
import { Datacenter } from "./datacenter";
import { Run, policies } from "@/lib/engine";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "./surface";
export const seconds = (v: number | null) =>
  v === null ? "N/A" : `${v.toFixed(3)} s`;
export function Results({ run }: { run: Run }) {
  const { config: c, summary: s } = run;
  const bins = useMemo(() => histogram(s.response_times), [s.response_times]);
  const rows = useMemo(
    () =>
      Object.entries(s.per_server_utilization)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([id, u]) => ({
          id: Number(id),
          utilization: Math.round(u * 10000) / 100,
        })),
    [s.per_server_utilization],
  );
  const total = s.completed_count + s.rejected_count;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Last completed run</Badge>
        <p className="caption">
          {c.server_count} servers · {c.arrival_rate} requests/s · {c.duration}{" "}
          s arrival window · seed {c.seed} · {policies[c.policy]}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-6 border-y py-5 xl:grid-cols-4">
        {[
          ["Completed requests", s.completed_count.toLocaleString()],
          ["Rejected requests", s.rejected_count.toLocaleString()],
          ["Average response time", seconds(s.mean_response_time)],
          ["p95 response time", seconds(s.p95_response_time)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {s.completed_count === 0 && (
        <Notice>No completed requests. Response times are unavailable.</Notice>
      )}
      <p className="caption">
        Response times include queue waiting and service, in simulated seconds.
      </p>
      <Tabs defaultValue="Overview" className="min-w-0">
        <TabsList>
          {["Overview", "Datacenter", "Server details"].map((t) => (
            <TabsTrigger key={t} value={t}>
              {t}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="Overview" className="mt-4 flex flex-col gap-5">
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Request outcomes</CardTitle>
                <CardDescription>
                  Did the available capacity keep up?
                </CardDescription>
              </CardHeader>
              <CardContent>
                {total ? (
                  <>
                    <OutcomeChart
                      completed={s.completed_count}
                      rejected={s.rejected_count}
                    />
                    <p className="caption mt-3">
                      {((s.rejected_count / total) * 100).toFixed(1)}% rejected
                      out of {total.toLocaleString()} requests.
                    </p>
                  </>
                ) : (
                  <p className="caption">
                    No requests were generated. Increase the rate or arrival
                    window.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Response time distribution</CardTitle>
                <CardDescription>
                  Completed requests, in simulated seconds.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {bins.length ? (
                  <>
                    <ResponseChart bins={bins} p95={s.p95_response_time} />
                    <p className="caption mt-3">
                      Each bar groups similar response times. The dashed line
                      marks p95.
                    </p>
                  </>
                ) : (
                  <p className="caption">
                    Run a simulation with completed requests to see the
                    distribution.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Per-server utilization</CardTitle>
              <CardDescription>
                How evenly was work distributed?
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rows.length ? (
                <UtilizationChart rows={rows} />
              ) : (
                <Notice>No server utilization data available.</Notice>
              )}
              <p className="caption mt-3">
                Occupied slots during the arrival window. Draining time is
                excluded; this is modeled utilization.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="Datacenter" className="mt-4">
          <Datacenter run={run} />
        </TabsContent>
        <TabsContent value="Server details" className="mt-4">
          <p className="caption mb-3">Values behind the utilization chart.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server ID</TableHead>
                <TableHead>Slot utilization (%)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.id}</TableCell>
                  <TableCell>{r.utilization.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
