"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  COMPARE_DRAFT_KEY,
  WORKSPACE_DRAFT_KEY,
  isRegional,
  validWorkspaceConfig,
} from "@/lib/comparison";
import { defaults, type Config } from "@/lib/engine";
import { withoutOutages } from "@/lib/availability";
import { isShardedConfig, shardedDefaults } from "@/lib/fanout";
import type { LiveSnapshot } from "@/lib/live-session";
import {
  initialRegions,
  withoutRegionalClients,
  type RegionalConfig,
  type RegionalTopology,
} from "@/lib/regions";
import { readSetups, templates, type ExecutionMode, type SavedSetup } from "@/lib/saved-setups";

export function useWorkspaceDraft(pathname: string, restoredSession: LiveSnapshot | null) {
  const router = useRouter();
  const query = useSearchParams();
  const templateId = query.get("template");
  const saveId = query.get("save");
  const fromCompare = query.has("compareDraft");
  const newSetup = query.has("new");
  const requestedMode = query.get("mode") === "continuous" ? "continuous" : undefined;
  const sourceKey = templateId ? `template:${templateId}`
    : saveId ? `save:${saveId}`
    : fromCompare ? "compare"
    : newSetup ? "new"
    : "";

  const [config, setConfig] = useState<Config>(defaults);
  const [topology, setTopology] = useState("single_pool");
  const [regional, setRegional] = useState<RegionalTopology>(initialRegions);
  const [regionalPolicy, setRegionalPolicy] = useState("least_loaded");
  const [sharded, setSharded] = useState(shardedDefaults);
  const [execution, setExecution] = useState<ExecutionMode>("one_shot");
  const [setupName, setSetupName] = useState("New simulation");
  const [currentSave, setCurrentSave] = useState<SavedSetup | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftError, setDraftError] = useState("");
  const loadedSource = useRef<string | null>(null);
  const canRestoreSession = useRef(true);

  useEffect(() => {
    if (loadedSource.current === sourceKey) return;
    const firstLoad = loadedSource.current === null;
    loadedSource.current = sourceKey;
    if (!firstLoad && !sourceKey) return;
    if (firstLoad && sourceKey && sourceKey !== "new" && pathname === "/simulator") {
      router.replace("/setup" + location.search);
    }
    setDraftError("");
    try {
      if (templateId || saveId) {
        canRestoreSession.current = false;
        const item = templateId
          ? templates.find(({ id }) => id === templateId)
          : readSetups().find(({ id }) => id === saveId);
        if (!item) throw new Error("This setup was not found in this browser.");
        setConfig(item.config);
        setTopology("single_pool");
        setExecution(requestedMode ?? item.execution ?? "one_shot");
        setCurrentSave(saveId && "updatedAt" in item ? item : null);
        setSetupName(item.name);
        return;
      }
      if (newSetup && !fromCompare) {
        canRestoreSession.current = false;
        setConfig(defaults);
        setTopology("single_pool");
        setRegional(initialRegions);
        setRegionalPolicy("least_loaded");
        setSharded(shardedDefaults);
        setExecution(requestedMode ?? "one_shot");
        setCurrentSave(null);
        setSetupName("New simulation");
        return;
      }

      const raw = fromCompare
        ? sessionStorage.getItem(COMPARE_DRAFT_KEY)
        : sessionStorage.getItem(WORKSPACE_DRAFT_KEY) ?? sessionStorage.getItem(COMPARE_DRAFT_KEY);
      if (raw === null && !fromCompare) {
        if (requestedMode) setExecution(requestedMode);
        return;
      }
      if (!raw || raw.length > 65_536) throw new Error("The saved Lab draft is unavailable in this tab.");
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1) {
        throw new Error("The saved Lab draft format is unsupported.");
      }
      const draft = data as { execution?: unknown; name?: unknown; config?: unknown };
      const mode = requestedMode ?? (draft.execution === "continuous" ? "continuous" : "one_shot");
      let candidate = draft.config;
      if (candidate && typeof candidate === "object" &&
          "topology" in candidate && candidate.topology === "sharded") {
        candidate = {
          outage_ms: shardedDefaults.outage_ms,
          dispatch_mode: shardedDefaults.dispatch_mode,
          ...candidate,
        };
      } else if (candidate && typeof candidate === "object" &&
                 "request_model" in candidate && candidate.request_model === "cpu_io") {
        candidate = withoutOutages(candidate as Config);
      }
      if (isShardedConfig(candidate)) {
        setTopology("sharded");
        setSharded(candidate);
      } else if (validWorkspaceConfig(candidate, mode)) {
        if (isRegional(candidate)) {
          setRegional(candidate);
          setRegionalPolicy(candidate.policy);
          setTopology("regions");
          const { arrival_rate, duration, service_min, service_max, seed } = candidate;
          setConfig({ ...defaults, arrival_rate, duration, service_min, service_max, seed });
        } else {
          setTopology("single_pool");
          setConfig(candidate);
        }
      } else {
        throw new Error("The saved Lab draft could not be loaded.");
      }
      canRestoreSession.current = false;
      setCurrentSave(null);
      setExecution(mode);
      setSetupName(typeof draft.name === "string" ? draft.name : "Lab setup");
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Could not load this setup.");
    } finally {
      setDraftReady(true);
    }
  }, [sourceKey, templateId, saveId, fromCompare, newSetup, requestedMode, pathname, router]);

  useEffect(() => {
    if (!draftReady || !restoredSession || !canRestoreSession.current) return;
    canRestoreSession.current = false;
    const { arrival_rate, service_min, service_max, seed } = restoredSession.config;
    if (restoredSession.topology === "regions") {
      setTopology("regions");
      setRegional(restoredSession.config);
      setRegionalPolicy(restoredSession.config.policy);
      setConfig({ ...defaults, arrival_rate, service_min, service_max, seed });
    } else {
      setConfig({ ...restoredSession.config, duration: defaults.duration });
      setTopology("single_pool");
    }
    setExecution("continuous");
    setSetupName("Reconnected session");
  }, [draftReady, restoredSession]);

  const regionalConfig = useMemo<RegionalConfig>(() => ({
    ...(execution === "continuous" ? regional : withoutRegionalClients(regional)),
    topology: "regions",
    policy: regionalPolicy as RegionalConfig["policy"],
    arrival_rate: config.arrival_rate,
    service_min: config.service_min,
    service_max: config.service_max,
    seed: config.seed,
    duration: config.duration,
  }), [config, execution, regional, regionalPolicy]);
  const draftConfig = topology === "regions" ? regionalConfig : config;

  useEffect(() => {
    if (!draftReady) return;
    try {
      sessionStorage.setItem(WORKSPACE_DRAFT_KEY, JSON.stringify({
        version: 1,
        name: setupName,
        config: topology === "sharded" ? sharded : draftConfig,
        execution: topology === "sharded" ? "one_shot" : execution,
      }));
    } catch {
      // Storage is optional. The explicit Compare action reports write failures.
    }
  }, [draftConfig, sharded, topology, execution, setupName, draftReady]);

  function detachTemplate() {
    canRestoreSession.current = false;
    setDraftError("");
    const next = new URLSearchParams(location.search);
    for (const key of ["template", "compareDraft", "mode", "new"]) next.delete(key);
    history.replaceState(null, "", location.pathname + (next.size ? `?${next}` : ""));
  }

  function rememberSaved(item: SavedSetup) {
    setCurrentSave(item);
    setSetupName(item.name);
    history.replaceState(null, "", `${location.pathname}?save=${encodeURIComponent(item.id)}`);
  }

  return {
    config, setConfig, topology, setTopology, regional, setRegional,
    regionalPolicy, setRegionalPolicy, sharded, setSharded, execution,
    setExecution, setupName, currentSave, rememberSaved, draftConfig, regionalConfig,
    draftReady, draftError, detachTemplate,
  };
}
