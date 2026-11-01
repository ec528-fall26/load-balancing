"use client";
import { useState } from "react";
import { Chart } from "./chart";
import { Datacenter } from "./datacenter";
import { Run, policies } from "@/lib/engine";
const TEAL = "#147D92",
  ORANGE = "#B85A27";
export const seconds = (v: number | null) =>
  v === null ? "N/A" : `${v.toFixed(3)} s`;
export function Results({ run }: { run: Run }) {
  const [tab, setTab] = useState("Overview");
  const { config: c, summary: s } = run;
  const rows = Object.entries(s.per_server_utilization)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([id, u]) => ({
      "Server ID": Number(id),
      "Slot utilization (%)": Math.round(u * 10000) / 100,
    }));
  const total = s.completed_count + s.rejected_count;
  return (
    <>
      <p className="caption">
        Last completed run · {c.server_count} servers · {c.arrival_rate}{" "}
        requests/s · {c.duration} s arrival window · seed {c.seed} ·{" "}
        {policies[c.policy]}
      </p>
      <div className="metrics">
        {[
          ["Completed requests", s.completed_count],
          ["Rejected requests", s.rejected_count],
          ["Average response time", seconds(s.mean_response_time)],
          ["p95 response time", seconds(s.p95_response_time)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
          </div>
        ))}
      </div>
      {s.completed_count === 0 && (
        <div className="notice">
          No completed requests. Response times are unavailable.
        </div>
      )}
      <p className="caption">
        Response times include queue waiting and service, in simulated seconds.
      </p>
      <div className="tabs" role="tablist">
        {["Overview", "Datacenter", "Server details"].map((t) => (
          <button
            id={`tab-${t.replace(" ", "-")}`}
            role="tab"
            aria-selected={tab === t}
            aria-controls="results-panel"
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div
        id="results-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab.replace(" ", "-")}`}
      >
        {tab === "Overview" && (
          <>
            <div className="columns">
              <section>
                <h2>Request outcomes</h2>
                {total ? (
                  <>
                    <Chart
                      label="Completed and rejected request counts"
                      spec={{
                        data: {
                          values: [
                            {
                              Outcome: "Completed",
                              Requests: s.completed_count,
                            },
                            { Outcome: "Rejected", Requests: s.rejected_count },
                          ],
                        },
                        mark: { type: "bar", cornerRadiusEnd: 3 },
                        encoding: {
                          y: {
                            field: "Outcome",
                            type: "nominal",
                            title: null,
                            sort: ["Completed", "Rejected"],
                          },
                          x: {
                            field: "Requests",
                            type: "quantitative",
                            axis: { tickMinStep: 1 },
                          },
                          color: {
                            field: "Outcome",
                            type: "nominal",
                            legend: null,
                            scale: {
                              domain: ["Completed", "Rejected"],
                              range: [TEAL, ORANGE],
                            },
                          },
                          tooltip: [
                            { field: "Outcome" },
                            { field: "Requests" },
                          ],
                        },
                      }}
                    />
                    <p className="caption">
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
              </section>
              <section>
                <h2>Response time distribution</h2>
                {s.response_times.length ? (
                  <>
                    <Chart
                      label="Histogram of completed-request response times with a p95 reference line"
                      spec={{
                        data: {
                          values: s.response_times.map((t) => ({ Seconds: t })),
                        },
                        layer: [
                          {
                            mark: { type: "bar", color: TEAL },
                            encoding: {
                              x: {
                                field: "Seconds",
                                type: "quantitative",
                                bin: { maxbins: 20 },
                                title: "Response time (s)",
                              },
                              y: {
                                aggregate: "count",
                                type: "quantitative",
                                title: "Completed requests",
                                axis: { tickMinStep: 1 },
                              },
                              tooltip: [
                                {
                                  field: "Seconds",
                                  bin: { maxbins: 20 },
                                  type: "quantitative",
                                  title: "Seconds",
                                },
                                {
                                  aggregate: "count",
                                  type: "quantitative",
                                  title: "Requests",
                                },
                              ],
                            },
                          },
                          {
                            data: { values: [{ p95: s.p95_response_time }] },
                            mark: {
                              type: "rule",
                              color: ORANGE,
                              strokeDash: [5, 4],
                            },
                            encoding: {
                              x: { field: "p95", type: "quantitative" },
                              tooltip: [
                                {
                                  field: "p95",
                                  type: "quantitative",
                                  format: ".3f",
                                },
                              ],
                            },
                          },
                        ],
                      }}
                    />
                    <p className="caption">
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
              </section>
            </div>
            <h2>Per-server utilization</h2>
            {rows.length ? (
              <Chart
                height={200}
                label="Occupied slot percentage for each server during the arrival window"
                spec={{
                  data: { values: rows },
                  mark: {
                    type: rows.length <= 40 ? "bar" : "line",
                    color: TEAL,
                  },
                  encoding: {
                    x: {
                      field: "Server ID",
                      type: rows.length <= 40 ? "ordinal" : "quantitative",
                      axis: { labelAngle: 0, tickCount: 10, tickMinStep: 1 },
                    },
                    y: {
                      field: "Slot utilization (%)",
                      type: "quantitative",
                      scale: { domain: [0, 100] },
                    },
                    tooltip: [
                      { field: "Server ID" },
                      { field: "Slot utilization (%)", format: ".2f" },
                    ],
                  },
                }}
              />
            ) : (
              <div className="notice">
                No server utilization data available.
              </div>
            )}
            <p className="caption">
              Occupied slots during the arrival window. Draining time is
              excluded; this is modeled utilization.
            </p>
          </>
        )}
        {tab === "Datacenter" && <Datacenter run={run} />}
        {tab === "Server details" && (
          <>
            <p className="caption">Values behind the utilization chart.</p>
            <table>
              <thead>
                <tr>
                  <th>Server ID</th>
                  <th>Slot utilization (%)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row["Server ID"]}>
                    <td>{row["Server ID"]}</td>
                    <td>{row["Slot utilization (%)"]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
