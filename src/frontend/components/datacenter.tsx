"use client";
import { useEffect, useState } from "react";
import type { Run } from "@/lib/engine";
function Stack({
  count,
  total,
  label,
}: {
  count: number;
  total: number;
  label: string;
}) {
  if (!total) return <div className="dc-empty">Disabled</div>;
  return (
    <div className="dc-stack">
      {[
        [count, label],
        [total - count, "Available"],
      ].flatMap(([n, l]) => {
        const size = Number(n),
          chunk = Math.max(1, Math.ceil(size / 4));
        return Array.from({ length: Math.ceil(size / chunk) }, (_, i) => (
          <div
            key={`${l}-${i}`}
            className={`dc-slot ${l === "Available" ? "available" : l === "Running" ? "running" : "waiting"}`}
          >
            {l}
            {Math.min(chunk, size - i * chunk) > 1
              ? ` × ${Math.min(chunk, size - i * chunk)}`
              : ""}
          </div>
        ));
      })}
    </div>
  );
}
export function Datacenter({ run }: { run: Run }) {
  const [mode, setMode] = useState("Playback"),
    [page, setPage] = useState(0),
    [now, setNow] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1);
  const { config, summary } = run,
    events = summary.events;
  const end = Math.max(config.duration, events.at(-1)?.[0] ?? 0);
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const next = performance.now();
      const delta = ((next - previous) / 1000) * speed;
      previous = next;
      setNow((t) => Math.min(end, t + delta));
    }, 100);
    return () => clearInterval(timer);
  }, [playing, speed, end]);
  useEffect(() => {
    if (now >= end) setPlaying(false);
  }, [now, end]);
  const servers = Object.entries(summary.per_server_utilization).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const states: Record<string, [number, number]> = {};
  servers.forEach(([sid]) => (states[sid] = [0, 0]));
  let completed = 0,
    rejected = 0,
    latest;
  for (const event of events) {
    if (event[0] > now) break;
    states[event[1]] = [event[2], event[3]];
    completed += Number(event[4] === "completed");
    rejected += Number(event[4] === "rejected");
    latest = event;
  }
  const running = Object.values(states).reduce((a, b) => a + b[0], 0),
    waiting = Object.values(states).reduce((a, b) => a + b[1], 0),
    total = Math.floor(config.arrival_rate * config.duration),
    arrived = running + waiting + completed + rejected;
  const visible = servers.slice(page * 32, (page + 1) * 32);
  return (
    <>
      <h2>Datacenter</h2>
      <p className="caption">
        Racks group servers for display; they do not model physical locations or
        network topology.
      </p>
      {servers.length > 32 && (
        <label>
          Servers to display
          <select
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {Array.from({ length: Math.ceil(servers.length / 32) }, (_, i) => (
              <option key={i} value={i}>
                Servers {i * 32}–{Math.min((i + 1) * 32, servers.length) - 1}
              </option>
            ))}
          </select>
        </label>
      )}
      <fieldset className="radio">
        <legend>View</legend>
        {["Playback", "Run averages"].map((v) => (
          <label key={v}>
            <input
              type="radio"
              name="view"
              checked={mode === v}
              onChange={() => setMode(v)}
            />
            {v}
          </label>
        ))}
      </fieldset>
      {mode === "Playback" && (
        <>
          <div className="play-controls">
            <button
              onClick={() => {
                if (now >= end) setNow(0);
                setPlaying(!playing);
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => {
                setNow(0);
                setPlaying(false);
              }}
            >
              Restart
            </button>
            <label>
              Playback speed
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                {[0.25, 0.5, 1, 2, 5, 10].map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Jump to time (seconds)
            <input
              type="range"
              min={0}
              max={end}
              step={Math.min(0.1, end / 100)}
              value={now}
              onChange={(e) => setNow(Number(e.target.value))}
            />
          </label>
          <p className="caption">
            1× plays one simulated second per real second. Playback follows the
            recorded run, including queue draining. Teal: running. Orange:
            waiting. Labels show current slot and queue counts.
          </p>
          <p>
            <strong>
              {now >= end ? "Finished" : playing ? "Playing" : "Paused"} ·{" "}
              {now.toFixed(1)} / {end.toFixed(1)} s
            </strong>
          </p>
          <progress value={now} max={end} />
          {latest && (
            <p className="caption">
              Latest event · {latest[0].toFixed(3)} s · Request {latest[5]}{" "}
              {latest[4]} on server {latest[1]}
            </p>
          )}
        </>
      )}
      <div className={mode === "Playback" ? "dc-scene-grid" : ""}>
        <div className="dc-floor">
          {Array.from({ length: Math.ceil(visible.length / 8) }, (_, r) => (
            <section className="dc-rack" key={r}>
              <h4>Rack {page * 4 + r + 1}</h4>
              {visible.slice(r * 8, r * 8 + 8).map(([sid, u]) => {
                const [active, queued] = states[sid];
                return (
                  <div className="dc-server" key={sid}>
                    <strong>Server {sid}</strong>
                    {mode === "Run averages" ? (
                      <>
                        <div className="dc-label dc-section">
                          <span>Average utilization</span>
                          <span>{(u * 100).toFixed(1)}%</span>
                        </div>
                        <div
                          className="dc-meter"
                          role="meter"
                          aria-label={`Server ${sid} slot utilization`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={u * 100}
                        >
                          <div style={{ width: `${u * 100}%` }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div
                          className="dc-state"
                          style={{
                            color: queued
                              ? "#9A3D08"
                              : active
                                ? "#006477"
                                : "#334E60",
                          }}
                        >
                          {queued
                            ? queued === config.queue_limit
                              ? "Queue full"
                              : "Queued"
                            : active
                              ? "Executing"
                              : "Idle"}
                        </div>
                        <div className="dc-stacks">
                          <div>
                            <div className="dc-label dc-section">
                              <span>Executing</span>
                              <span>
                                {active}/{config.concurrency}
                              </span>
                            </div>
                            <Stack
                              count={active}
                              total={config.concurrency}
                              label="Running"
                            />
                          </div>
                          <div>
                            <div className="dc-label dc-section">
                              <span>
                                Waiting
                                {config.queue_limit > 0 &&
                                queued === config.queue_limit
                                  ? " · Full"
                                  : ""}
                              </span>
                              <span>
                                {queued}/{config.queue_limit}
                              </span>
                            </div>
                            <Stack
                              count={queued}
                              total={config.queue_limit}
                              label="Waiting"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
        {mode === "Playback" && (
          <section className="dc-pool-rack">
            <h4>Task pool</h4>
            {[
              ["Not arrived", total - arrived, "#334E60"],
              ["Running", running, "#006477"],
              ["Waiting", waiting, "#9A3D08"],
              ["Completed", completed, "#17683B"],
              ["Rejected", rejected, "#A12727"],
            ].map(([label, value, color]) => (
              <div className="dc-pool-row" key={label}>
                <span style={{ color: String(color) }}>{label}</span>
                <strong>{Number(value).toLocaleString()}</strong>
              </div>
            ))}
            <p className="dc-pool-note">
              {arrived.toLocaleString()} arrived / {total.toLocaleString()}{" "}
              total requests.
              <br />
              Counts cover all servers.
            </p>
          </section>
        )}
      </div>
      <p className="caption">
        Showing {visible.length} of {servers.length} servers.{" "}
        {mode === "Playback"
          ? "Large stacks group positions; × indicates the count."
          : "Bars show average occupied slots during the arrival window."}
      </p>
    </>
  );
}
