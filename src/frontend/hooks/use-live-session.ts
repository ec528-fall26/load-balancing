"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RegionalConfig } from "@/lib/regions";
import type { Config } from "@/lib/engine";
import {
  ACTIVE_SESSION_KEY,
  SESSION_ID,
  continuousConfig,
  sessionRequest,
  isTerminalSessionError,
  type LiveSnapshot,
} from "@/lib/live-session";
export function useLiveSession(enabled: boolean) {
  const [id, setId] = useState<string | null>(null),
    [restoredId, setRestoredId] = useState<string | null>(null),
    [startedId, setStartedId] = useState<string | null>(null),
    [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null),
    [error, setError] = useState(""),
    [connectionError, setConnectionError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [offset, setOffset] = useState(0);
  const idRef = useRef<string | null>(null),
    last = useRef<LiveSnapshot | null>(null),
    pending = useRef(false),
    epoch = useRef(0),
    poll = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const remember = useCallback((value: string | null) => {
    idRef.current = value;
    setId(value);
    try {
      if (value)
        sessionStorage.setItem(
          ACTIVE_SESSION_KEY,
          JSON.stringify({ version: 1, id: value }),
        );
      else sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {
      /* Session works without browser persistence. */
    }
  }, []);
  const adopt = useCallback((data: LiveSnapshot) => {
    if (!mounted.current || data.session_id !== idRef.current) return;
    if (
      last.current?.session_id === data.session_id &&
      last.current.revision > data.revision
    )
      return;
    last.current = data;
    setSnapshot(data);
    setConnectionError("");
  }, []);
  useEffect(() => {
    mounted.current = true;
    try {
      const raw = sessionStorage.getItem(ACTIVE_SESSION_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored.version === 1 && SESSION_ID.test(stored.id)) {
          remember(stored.id);
          setRestoredId(stored.id);
        } else sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch {
      setError(
        "Browser session storage is unavailable; automatic reconnection may not work.",
      );
    }
    setReady(true);
    return () => {
      mounted.current = false;
      epoch.current++;
      poll.current?.abort();
    };
  }, [remember]);
  useEffect(() => {
    if (!enabled || !id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      if (cancelled || idRef.current !== id) return;
      if (!pending.current) {
        const controller = new AbortController();
        poll.current = controller;
        const generation = epoch.current;
        try {
          const data = (await sessionRequest(
            `/${id}/snapshot?server_offset=${offset}&server_limit=32&history_limit=120`,
            { signal: controller.signal },
          )) as LiveSnapshot;
          if (
            !cancelled &&
            generation === epoch.current &&
            idRef.current === id
          )
            adopt(data);
        } catch (e) {
          if (
            !cancelled &&
            !controller.signal.aborted &&
            generation === epoch.current
          ) {
            setConnectionError(
              e instanceof Error ? e.message : "Could not refresh session.",
            );
            if (isTerminalSessionError(e)) remember(null);
          }
        }
      }
      if (!cancelled) timer = setTimeout(tick, 500);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      poll.current?.abort();
    };
  }, [enabled, id, offset, adopt, remember]);
  async function operation<T>(
    callback: () => Promise<T>,
    clearTerminalSession = true,
  ): Promise<T | undefined> {
    if (pending.current) return;
    pending.current = true;
    epoch.current++;
    poll.current?.abort();
    setBusy(true);
    setError("");
    setConnectionError("");
    try {
      return await callback();
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : "Session request failed.");
        if (clearTerminalSession && isTerminalSessionError(e)) remember(null);
      }
      return undefined;
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function create(config: Config | RegionalConfig) {
    return operation(async () => {
      const previous = idRef.current;
      const data = (await sessionRequest("", {
        method: "POST",
        body: {
          config: continuousConfig(config),
          ...(previous ? { replace_session_id: previous } : {}),
        },
      })) as LiveSnapshot;
      if (!mounted.current) {
        await sessionRequest("/" + data.session_id, { method: "DELETE" });
        return false;
      }
      last.current = null;
      setOffset(0);
      remember(data.session_id);
      setStartedId(data.session_id);
      adopt(data);
      return true;
    }, false);
  }
  async function command(
    action: "pause" | "resume" | "set_rate" | "set_speed",
    value?: number,
  ) {
    return operation(async () => {
      const sid = idRef.current;
      if (!sid) throw new Error("Start a session first.");
      const data = (await sessionRequest(`/${sid}/commands`, {
        method: "POST",
        body: { action, ...(value === undefined ? {} : { value }) },
      })) as LiveSnapshot;
      adopt(data);
      if (data.topology !== "regions" && offset !== 0) {
        try {
          const page = (await sessionRequest(
            `/${sid}/snapshot?server_offset=${offset}&server_limit=32&history_limit=120`,
          )) as LiveSnapshot;
          adopt(page);
        } catch (e) {
          if (mounted.current)
            setConnectionError(
              e instanceof Error
                ? e.message
                : "Control applied; server page refresh failed.",
            );
        }
      }
      return true;
    });
  }
  async function stop() {
    return operation(async () => {
      const sid = idRef.current;
      if (!sid) return true;
      try {
        await sessionRequest("/" + sid, { method: "DELETE" });
      } catch (e) {
        if (!isTerminalSessionError(e)) throw e;
      }
      remember(null);
      setStartedId(null);
      return true;
    });
  }
  return {
    id,
    restoredId,
    startedId,
    snapshot,
    error: error || connectionError,
    connectionError,
    busy,
    ready,
    offset,
    setOffset,
    create,
    command,
    stop,
  };
}
export type LiveSessionController = ReturnType<typeof useLiveSession>;
