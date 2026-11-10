"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FanoutCase } from "@/lib/fanout";

function caseName(row: FanoutCase) {
  const shards = `${row.width} ${row.width === 1 ? "shard" : "shards"}`;
  return `${shards} · ${row.condition}`;
}

function ms(value: number | null) {
  return value === null ? "—" : value.toFixed(2);
}

export function FanoutResults({
  cases,
  demandMs,
}: {
  cases: FanoutCase[];
  demandMs: number;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = cases[selectedIndex];
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Parent outcomes</CardTitle>
          <CardDescription>
            {cases.length === 1 ? "This run offers" : "Each case offers"}{" "}
            {demandMs.toLocaleString()} ms of nominal backend work. P95 uses
            successful parents only. Backend work includes service consumed by
            failed parents.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead>On time</TableHead>
                <TableHead>Timed out</TableHead>
                <TableHead>Rejected</TableHead>
                <TableHead>P95 (ms)</TableHead>
                <TableHead>Backend ms / success</TableHead>
                <TableHead>Failed-parent work (ms)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {cases.map((row, index) => (
                <TableRow
                  key={caseName(row)}
                  data-state={
                    cases.length > 1 && selectedIndex === index
                      ? "selected"
                      : undefined
                  }
                >
                  <TableCell>
                    {cases.length === 1 ? (
                      caseName(row)
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-pressed={selectedIndex === index}
                        onClick={() => setSelectedIndex(index)}
                      >
                        {caseName(row)}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.completed}/{row.offered} (
                    {((100 * row.completed) / row.offered).toFixed(1)}%)
                  </TableCell>
                  <TableCell>{row.timed_out}</TableCell>
                  <TableCell>
                    {row.shard_rejected + row.coordinator_rejected}
                  </TableCell>
                  <TableCell>{ms(row.p95_ms)}</TableCell>
                  <TableCell>{ms(row.backend_ms_per_success)}</TableCell>
                  <TableCell>{ms(row.wasted_backend_ms)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {selected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Queues · {caseName(selected)}</CardTitle>
              <CardDescription>
                Peak coordinator CPU queue was {selected.coordinator_peak_queue}
                . Each shard has separate CPU and I/O queues.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shard</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Rejected</TableHead>
                    <TableHead>Peak CPU queue</TableHead>
                    <TableHead>Peak I/O queue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="tabular-nums">
                  {selected.shards.map((shard) => (
                    <TableRow key={shard.id}>
                      <TableCell>Shard {shard.id}</TableCell>
                      <TableCell>{shard.sent}</TableCell>
                      <TableCell>{shard.completed}</TableCell>
                      <TableCell>{shard.rejected}</TableCell>
                      <TableCell>{shard.peak_cpu_queue}</TableCell>
                      <TableCell>{shard.peak_io_queue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Request {selected.inspected.id} timeline</CardTitle>
              <CardDescription>
                Outcome: {selected.inspected.status.replaceAll("_", " ")}.
                {selected.inspected.critical_shard !== null &&
                  ` Shard ${selected.inspected.critical_shard} supplied the last reply before the join.`}
                {selected.inspected.unanswered_shards.length > 0 &&
                  ` Pending replies when the parent ended: ${selected.inspected.unanswered_shards.join(", ")}.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FanoutEventTable events={selected.inspected.events} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

function eventLabel(phase: string) {
  return phase
    .replaceAll("_", " ")
    .replace(/\bcpu\b/g, "CPU")
    .replace(/\bio\b/g, "I/O");
}

export function FanoutEventTable({
  events,
}: {
  events: FanoutCase["inspected"]["events"];
}) {
  return (
    <div
      className="max-h-96 overflow-auto"
      tabIndex={0}
      role="region"
      aria-label="Request events"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Elapsed (ms)</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Event</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="tabular-nums">
          {events.map((entry, index) => (
            <TableRow key={index}>
              <TableCell>{ms(entry.at_us / 1000)}</TableCell>
              <TableCell>
                {entry.shard === null ? "Coordinator" : `Shard ${entry.shard}`}
              </TableCell>
              <TableCell>{eventLabel(entry.phase)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
