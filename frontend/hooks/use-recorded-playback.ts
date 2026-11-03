"use client";
import { useEffect, useRef, useState } from "react";
import type { Event } from "@/lib/engine";
export type RecordedState = {
  api_version: "1";
  run_id: string;
  simulation_time: number;
  totals: {
    offered: number;
    completed: number;
    rejected: number;
    running: number;
    waiting: number;
  };
  idle_servers: number;
  latest_event: Event | null;
  servers: {
    offset: number;
    limit: number;
    total: number;
    items: {
      id: number;
      running: number;
      waiting: number;
      slots: number;
      queue_limit: number;
      processing_rate: number;
    }[];
  };
};
export function useRecordedPlayback(
  id: string | undefined,
  time: number,
  page: number,
  enabled: boolean,
) {
  const [snapshot, setSnapshot] = useState<RecordedState | null>(null),
    [error, setError] = useState("");
  const now = useRef(time);
  now.current = time;
  useEffect(() => {
    if (!id || !enabled) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      last = -1;
    const controller = new AbortController();
    setError("");
    async function read() {
      if (cancelled) return;
      const requested = now.current;
      if (last !== requested) {
        try {
          const r = await fetch(
            `/api/runs/${id}/snapshot?time=${encodeURIComponent(String(requested))}&server_offset=${page * 32}&server_limit=32`,
            { cache: "no-store", signal: controller.signal },
          );
          const data = await r.json();
          if (!r.ok)
            throw Object.assign(
              new Error(data.message ?? "Could not load recorded playback."),
              { terminal: [404, 410].includes(r.status) },
            );
          if (
            data.run_id !== id ||
            !Array.isArray(data.servers?.items) ||
            data.servers.items.length > 32 ||
            data.totals?.offered !==
              data.totals.completed +
                data.totals.rejected +
                data.totals.running +
                data.totals.waiting
          )
            throw new Error("Invalid recorded snapshot.");
          if (!cancelled) {
            setSnapshot(data);
            setError("");
            last = requested;
          }
        } catch (e) {
          if (!cancelled) {
            setError((e as Error).message);
            if ((e as { terminal?: boolean }).terminal) return;
          }
        }
      }
      if (!cancelled) timer = setTimeout(read, 250);
    }
    void read();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [id, page, enabled]);
  return { snapshot: snapshot?.run_id === id ? snapshot : null, error };
}
