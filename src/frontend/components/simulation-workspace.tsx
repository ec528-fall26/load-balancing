"use client";
import { initialRegions } from "@/components/regional-settings";
import { RegionalTelemetry } from "@/components/regional-telemetry";
import {
  regionalRequest,
  withoutRegionalClients,
  type RegionalConfig,
  type RegionalRun,
  type RegionalTopology,
} from "@/lib/regions";
import { ShardedRunResults } from "@/components/sharded-run-results";
import {
  fanoutCompareHref,
  fanoutRequest,
  isShardedConfig,
  shardedDefaults,
  type FanoutRun,
  type ShardedConfig,
} from "@/lib/fanout";
import { LabControls } from "@/components/lab-controls";
import { useLiveSession } from "@/hooks/use-live-session";
import { LiveSessionPanel } from "@/components/live-session-panel";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";

import {
  COMPARE_DRAFT_KEY,
  WORKSPACE_DRAFT_KEY,
  validCompareConfig,
  isRegional,
} from "@/lib/comparison";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Config, defaults, engineRequest, Run } from "@/lib/engine";
import { Results, seconds } from "@/components/results";
import previewRun from "@/lib/preview-run.json";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { Panel, Notice } from "@/components/surface";
import { SaveSetupDialog } from "@/components/save-setup-dialog";
import { readSetups, templates, type SavedSetup } from "@/lib/saved-setups";
import { AppHeader } from "@/components/app-header";
import { Server } from "lucide-react";
function Upload({
  label,
  accept,
  limit,
  onFile,
}: {
  label: string;
  accept: string;
  limit: string;
  onFile: (file: File) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="file"
        accept={accept}
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <FieldDescription>
        Choose an original {accept.slice(1).toUpperCase()} export. Limit {limit}.
      </FieldDescription>
    </Field>
  );
}
function Comparison({ runs }: { runs: [Run, Run] }) {
  const changed = (Object.keys(runs[0].config) as (keyof Config)[]).filter(
    (k) => runs[0].config[k] !== runs[1].config[k],
  );
  return (
    <>
      <Notice>
        {changed.some((k) => k !== "policy")
          ? `Settings differ: ${changed.join(", ")}. Workload or capacity differences also affect these results; this is not an isolated policy comparison.`
          : changed.length
            ? "Only the routing policy differs; workload and capacity settings match."
            : "Both files have the same configuration."}
      </Notice>
      <div className="grid gap-6 md:grid-cols-2">
        {runs.map((r, i) => {
          const s = r.summary,
            total = s.completed_count + s.rejected_count,
            util = Object.values(s.per_server_utilization);
          return (
            <section key={i}>
              <h2>Run {i ? "B" : "A"}</h2>
              <p>
                <strong>Policy:</strong> {r.config.policy}
              </p>
              <p className="caption">
                {total.toLocaleString()} generated ·{" "}
                {s.completed_count.toLocaleString()} completed ·{" "}
                {s.rejected_count.toLocaleString()} rejected
              </p>
              {[
                ["Average response time", seconds(s.mean_response_time)],
                ["p95 response time", seconds(s.p95_response_time)],
                [
                  "Rejection rate",
                  total
                    ? `${((100 * s.rejected_count) / total).toFixed(1)}%`
                    : "N/A",
                ],
                [
                  "Mean server slot utilization",
                  `${((100 * util.reduce((a, b) => a + b, 0)) / util.length).toFixed(1)}%`,
                ],
              ].map(([label, value]) => (
                <div className="compare-metric" key={label}>
                  <div>{label}</div>
                  <div className="metric-value">{value}</div>
                </div>
              ))}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Server ID</TableHead>
                    <TableHead>Slot utilization (%)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(s.per_server_utilization).map(([sid, u]) => (
                    <TableRow key={sid}>
                      <TableCell>{sid}</TableCell>
                      <TableCell>{(u * 100).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          );
        })}
      </div>
      <p className="caption">
        Latency includes waiting and draining, for completed requests only.
        Utilization excludes draining beyond the arrival window. Mean
        utilization averages all servers in each run. No completions: N/A
        latency; no generated requests: N/A rejection rate.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Setting</TableHead>
            <TableHead>Run A</TableHead>
            <TableHead>Run B</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(Object.keys(runs[0].config) as (keyof Config)[]).map((k) => (
            <TableRow key={k}>
              <TableCell>{k}</TableCell>
              <TableCell>{String(runs[0].config[k])}</TableCell>
              <TableCell>{String(runs[1].config[k])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
export default function SimulationWorkspace({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const queryParams = useSearchParams();
  const isSetup = pathname === "/setup";
  const [labExecution, setLabExecution] = useState("one_shot");
  const [labTopology, setLabTopology] = useState("single_pool");
  const [labName, setLabName] = useState("New simulation");
  const router = useRouter();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (pathname !== "/compare") {
      headingRef.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }, [pathname]);
  const [topology, setTopology] = useState("single_pool");
  const [sharded, setSharded] = useState(shardedDefaults);
  const [shardedRun, setShardedRun] = useState<{
    config: ShardedConfig;
    run: FanoutRun;
  } | null>(null);
  const [regional, setRegional] = useState<RegionalTopology>(initialRegions);
  const [regionalPolicy, setRegionalPolicy] = useState("least_loaded");
  const [regionalRun, setRegionalRun] = useState<RegionalRun | null>(null);
  const [execution, setExecution] = useState("one_shot");
  const live = useLiveSession(true);
  useEffect(() => {
    if (live.id) {
      setLabExecution("continuous");
      if (live.snapshot)
        setLabTopology(
          live.snapshot.topology === "regions" ? "regions" : "single_pool",
        );
    }
  }, [live.id, live.snapshot?.session_id]);
  const [sourceReady, setSourceReady] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const restoredDraft = useRef<string | null>(null);
  const [currentSave, setCurrentSave] = useState<SavedSetup | null>(null);
  const [setupName, setSetupName] = useState("New simulation");
  const requestPending = useRef(false);
  const csvFiles = useRef<[string, string]>(["", ""]);
  const uploadVersions = useRef([0, 0]);
  const comparisonVersion = useRef(0);
  const [config, setConfig] = useState<Config>(defaults),
    [run, setRun] = useState<Run | null>(null),
    [preview, setPreview] = useState(false),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<{ text: string; config: Config } | null>(null),
    [savedName, setSavedName] = useState(""),
    [replayError, setReplayError] = useState(""),
    [comparison, setComparison] = useState<[Run, Run] | null>(null),
    [fileNames, setFileNames] = useState<[string, string]>(["", ""]),
    [compareError, setCompareError] = useState("");
  useEffect(() => {
    const s = live.snapshot;
    if (
      !s ||
      live.id !== live.restoredId ||
      restoredDraft.current === s.session_id ||
      sourceReady
    )
      return;
    restoredDraft.current = s.session_id;
    if (s.topology === "regions") {
      setRegional(s.config);
      setRegionalPolicy(s.config.policy);
      setConfig({
        ...defaults,
        arrival_rate: s.config.arrival_rate,
        service_min: s.config.service_min,
        service_max: s.config.service_max,
        seed: s.config.seed,
      });
    } else setConfig({ ...s.config, duration: defaults.duration });
    setSetupName("Reconnected session");
  }, [live.id, live.restoredId, live.snapshot?.session_id, sourceReady]);
  const sourceKey = queryParams.get("template")
    ? `template:${queryParams.get("template")}`
    : queryParams.get("save")
      ? `save:${queryParams.get("save")}`
      : queryParams.has("compareDraft")
        ? "compareDraft"
        : "";
  const loadedSource = useRef<string | null>(null);
  useEffect(() => {
    if (loadedSource.current === sourceKey) return;
    const firstLoad = loadedSource.current === null;
    if (firstLoad && sourceKey && pathname === "/simulator")
      router.replace("/setup" + location.search);
    loadedSource.current = sourceKey;
    if (!firstLoad && !sourceKey) return;
    const query = new URLSearchParams(location.search);
    if (query.get("mode") === "continuous") setExecution("continuous");
    try {
      const raw = query.has("compareDraft")
        ? sessionStorage.getItem(COMPARE_DRAFT_KEY)
        : !sourceKey && !query.has("new")
          ? sessionStorage.getItem(WORKSPACE_DRAFT_KEY) ??
            sessionStorage.getItem(COMPARE_DRAFT_KEY)
          : null;
      if (raw !== null || query.has("compareDraft")) {
        if (!raw || raw.length > 65536)
          throw new Error(
            "The comparison's lab setup is unavailable in this tab.",
          );
        const draft = JSON.parse(raw);
        if (draft.config?.topology === "sharded") {
          draft.config = {outage_ms: shardedDefaults.outage_ms, dispatch_mode: shardedDefaults.dispatch_mode, ...draft.config};
        }
        if (
          draft.version !== 1 ||
          (!isShardedConfig(draft.config) && !validCompareConfig(draft.config))
        )
          throw new Error("The comparison's lab setup could not be loaded.");
        if (isShardedConfig(draft.config)) {
          setTopology("sharded");
          setSharded(draft.config);
        } else if (isRegional(draft.config)) {
          setRegional(draft.config);
          setRegionalPolicy(draft.config.policy);
          setTopology("regions");
          setConfig({
            ...defaults,
            arrival_rate: draft.config.arrival_rate,
            duration: draft.config.duration,
            service_min: draft.config.service_min,
            service_max: draft.config.service_max,
            seed: draft.config.seed,
          });
        } else {
          setTopology("single_pool");
          setConfig(draft.config);
        }
        setExecution(
          query.get("mode") === "continuous" || draft.execution === "continuous"
            ? "continuous"
            : "one_shot",
        );
        setSetupName(typeof draft.name === "string" ? draft.name : "Lab setup");
        setSourceReady(true);
      } else if (query.has("save")) {
        const item = readSetups().find((item) => item.id === query.get("save"));
        if (!item)
          throw new Error(
            "This saved setup was not found in this browser. Your default setup is ready below.",
          );
        setConfig(item.config);
        setTopology("single_pool");
        setCurrentSave(item);
        setSetupName(item.name);
        setSourceReady(true);
      } else if (query.has("template")) {
        const item = templates.find(
          (item) => item.id === query.get("template"),
        );
        if (!item)
          throw new Error(
            "This template was not found. Your default setup is ready below.",
          );
        setConfig(item.config);
        setTopology("single_pool");
        setCurrentSave(null);
        setSetupName(item.name);
        setSourceReady(true);
      }
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Could not load this setup.",
      );
    }
    setDraftReady(true);
    if (query.has("preview")) {
      setLabExecution("one_shot");
      setLabTopology("single_pool");
      setPreview(true);
      setRun(previewRun as unknown as Run);
    }
  }, [sourceKey]);
  const regionalConfig: RegionalConfig = {
    ...(execution === "continuous" ? regional : withoutRegionalClients(regional)),
    topology: "regions",
    policy: regionalPolicy as RegionalConfig["policy"],
    arrival_rate: config.arrival_rate,
    service_min: config.service_min,
    service_max: config.service_max,
    seed: config.seed,
    duration: config.duration,
  };
  const draftConfig = topology === "regions" ? regionalConfig : config;
  useEffect(() => {
    if (!draftReady) return;
    try {
      sessionStorage.setItem(
        WORKSPACE_DRAFT_KEY,
        JSON.stringify({
          version: 1,
          name: setupName,
          config: topology === "sharded" ? sharded : draftConfig,
          execution: topology === "sharded" ? "one_shot" : execution,
        }),
      );
    } catch {
      /* The explicit Compare action reports storage errors. */
    }
  }, [
    config,
    regional,
    regionalPolicy,
    sharded,
    topology,
    execution,
    setupName,
    draftReady,
  ]);
  function detachTemplate() {
    const q = new URLSearchParams(location.search);
    q.delete("template");
    q.delete("compareDraft");
    q.delete("new");
    history.replaceState(
      null,
      "",
      location.pathname + (q.size ? "?" + q.toString() : ""),
    );
  }
  function openComparison(compareConfig: Config | RegionalConfig) {
    try {
      sessionStorage.setItem(
        COMPARE_DRAFT_KEY,
        JSON.stringify({
          version: 1,
          name: setupName,
          config: compareConfig,
          execution,
        }),
      );
      router.push("/compare?draft=1");
    } catch {
      setFeedback(
        "Could not transfer this setup to Compare. Browser session storage may be unavailable.",
      );
    }
  }
  async function runSharded() {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setFeedback("");
    try {
      const { topology: _topology, ...settings } = sharded;
      const result = await fanoutRequest<FanoutRun>(
        "/api/fan-out/run",
        settings,
      );
      setShardedRun({ config: sharded, run: result });
      setLabExecution("one_shot");
      setLabTopology("sharded");
      setLabName("Sharded service");
      router.push("/simulator");
    } catch (e) {
      setFeedback((e as Error).message);
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }
  async function runRegional() {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setFeedback("");
    try {
      const result = await regionalRequest<RegionalRun>("run", {
        config: regionalConfig,
      });
      setRegionalRun(result);
      setLabExecution("one_shot");
      setLabTopology("regions");
      setLabName(setupName);
      router.push("/simulator");
    } catch (e) {
      setFeedback((e as Error).message);
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }
  async function request(operation: "run" | "replay") {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setFeedback("");
    if (operation === "replay") setReplayError("");
    try {
      const result = await engineRequest<Run>(
        operation,
        operation === "run" ? { config } : { configuration: saved?.text },
      );
      setRun(result);
      setPreview(false);
      setLabExecution("one_shot");
      setLabTopology("single_pool");
      setLabName(setupName);
      router.push("/simulator");
    } catch (error) {
      const message = (error as Error).message;
      if (operation === "replay") setReplayError(message);
      else setFeedback(message);
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }
  async function readConfig(file: File) {
    try {
      if (file.size > 60 * 1024) throw new Error("Configuration exceeds 60 KiB.");
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.config || typeof data.config !== "object")
        throw new Error(
          "Choose a configuration export containing a config object.",
        );
      setSaved({ text, config: data.config });
      setSavedName(file.name);
      setReplayError("");
    } catch (error) {
      setSaved(null);
      setSavedName("");
      setReplayError((error as Error).message);
    }
  }
  async function readCsv(file: File, index: number) {
    const uploadVersion = ++uploadVersions.current[index];
    ++comparisonVersion.current;
    csvFiles.current[index] = "";
    let activeComparison: number | undefined;
    setComparison(null);
    setCompareError("");
    setFileNames((current) => {
      const names: [string, string] = [...current];
      names[index] = "";
      return names;
    });
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error("Results exceed 5 MiB.");
      const text = await file.text();
      if (uploadVersion !== uploadVersions.current[index]) return;
      // File reads may finish together before React rerenders the other handler.
      const next: [string, string] = [...csvFiles.current];
      next[index] = text;
      csvFiles.current = next;
      setFileNames((current) => {
        const names: [string, string] = [...current];
        names[index] = file.name;
        return names;
      });
      setComparison(null);
      setCompareError("");
      if (next.every(Boolean)) {
        const version = ++comparisonVersion.current;
        activeComparison = version;
        const result = await engineRequest<[Run, Run]>("compare", {
          results: next,
        });
        if (version === comparisonVersion.current) setComparison(result);
      }
    } catch (error) {
      if (
        uploadVersion === uploadVersions.current[index] &&
        (activeComparison === undefined ||
          activeComparison === comparisonVersion.current)
      )
        setCompareError((error as Error).message);
    }
  }
  async function download(kind: "configuration" | "results") {
    if (!run?.run_id) return;
    try {
      const data = await engineRequest<{
        config_json: string;
        results_csv: string;
        run_id: string;
      }>("exports", { run_id: run.run_id });
      const blob = new Blob(
        [kind === "configuration" ? data.config_json : data.results_csv],
        { type: kind === "configuration" ? "application/json" : "text/csv" },
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `lbsim-${data.run_id.slice(0, 12)}-${kind === "configuration" ? "config.json" : "results.csv"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setFeedback((error as Error).message);
    }
  }
  if (pathname === "/compare") return children;
  const shardedComparison =
    isSetup && topology === "sharded"
      ? fanoutCompareHref(sharded)
      : !isSetup && labTopology === "sharded" && shardedRun
        ? fanoutCompareHref(shardedRun.config)
        : null;
  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        section={isSetup ? "setup" : "lab"}
        compareHref={shardedComparison ?? "/compare?draft=workspace"}
        actions={
          isSetup && topology === "single_pool" ? (
            <SaveSetupDialog
              suggestedName={setupName}
              config={config}
              current={currentSave}
              onSaved={(item) => {
                setCurrentSave(item);
                setSetupName(item.name);
                history.replaceState(
                  null,
                  "",
                  `${location.pathname}?save=${encodeURIComponent(item.id)}`,
                );
              }}
            />
          ) : undefined
        }
      />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 md:px-8">
        {isSetup ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1
                  ref={headingRef}
                  tabIndex={-1}
                  className="text-3xl font-semibold tracking-tight outline-none"
                >
                  Set up a simulation
                </h1>
                <p className="mt-2 text-muted-foreground">
                  Start with a template, then make it your own. Every setting is
                  editable.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href="/simulator">Return to Lab</Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    shardedComparison
                      ? router.push(shardedComparison)
                      : openComparison(draftConfig)
                  }
                >
                  Compare current setup
                </Button>
              </div>
            </div>
            {feedback && (
              <Notice error role="status">
                {feedback}
              </Notice>
            )}
            {live.error && <Notice error>{live.error}</Notice>}
            <LabControls
              config={config}
              onChange={(next) => {
                setConfig(next);
                detachTemplate();
              }}
              name={setupName}
              execution={execution}
              topology={topology}
              sharded={sharded}
              onSharded={(next) => {
                setSharded(next);
                detachTemplate();
              }}
              regional={regional}
              onRegional={(next) => {
                setRegional(next);
                detachTemplate();
              }}
              regionalPolicy={regionalPolicy}
              onRegionalPolicy={(next) => {
                setRegionalPolicy(next);
                detachTemplate();
              }}
              busy={busy || live.busy}
              active={!!live.id}
              ready={live.ready}
              onExecution={(next) => {
                setExecution(next);
                detachTemplate();
              }}
              onTopology={(next) => {
                setTopology(next);
                detachTemplate();
              }}
              onRun={async () => {
                if (topology === "sharded") {
                  await runSharded();
                  return;
                }
                if (config.service_min > config.service_max) {
                  setFeedback(
                    "service_min must be less than or equal to service_max",
                  );
                  return;
                }
                if (execution === "continuous") {
                  if (await live.create(draftConfig)) {
                    setLabExecution("continuous");
                    setLabTopology(topology);
                    setLabName(setupName);
                    router.push("/simulator");
                  }
                } else if (topology === "regions") void runRegional();
                else void request("run");
              }}
            />
            {topology === "single_pool" ? (
              <Card>
                <CardHeader>
                  <CardTitle>Saved run tools</CardTitle>
                  <CardDescription>
                    Work with exported configurations and results.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" disabled={!draftReady}>
                        Replay a saved run
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-lg">
                      <DialogHeader className="pr-8">
                        <DialogTitle>Replay a saved run</DialogTitle>
                        <DialogDescription>
                          Upload the original configuration JSON to reproduce a run.
                        </DialogDescription>
                      </DialogHeader>
                      <FieldGroup>
                        <Upload
                          label="Configuration export (JSON)"
                          accept=".json"
                          limit="60 KiB"
                          onFile={readConfig}
                        />
                        {replayError && (
                          <Notice error role="status">{replayError}</Notice>
                        )}
                        {saved !== null && (
                          <>
                            <p className="caption">{savedName}</p>
                            <pre>
                              {JSON.stringify(
                                saved.config,
                                null,
                                2,
                              )}
                            </pre>
                            <p className="caption">
                              Replay verifies the saved metrics using the exported
                              settings and seed, then opens the result in Lab.
                            </p>
                            <Button
                              variant="outline"
                              disabled={busy}
                              onClick={() => request("replay")}
                            >
                              Replay saved configuration
                            </Button>
                          </>
                        )}
                      </FieldGroup>
                    </DialogContent>
                  </Dialog>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" disabled={!draftReady}>
                        Compare saved results
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-5xl">
                      <DialogHeader className="pr-8">
                        <DialogTitle>Compare saved results</DialogTitle>
                        <DialogDescription>
                          Upload two results CSV exports to compare their recorded metrics.
                        </DialogDescription>
                      </DialogHeader>
                      <FieldGroup>
                        <FieldGroup className="grid gap-6 md:grid-cols-2">
                          {[0, 1].map((i) => (
                            <div className="min-w-0" key={i}>
                              <Upload
                                label={`Run ${i ? "B" : "A"} results (CSV)`}
                                accept=".csv"
                            limit="5 MiB"
                                onFile={(file) => readCsv(file, i)}
                              />
                              {fileNames[i] && (
                                <p className="caption mt-2">{fileNames[i]}</p>
                              )}
                            </div>
                          ))}
                        </FieldGroup>
                        {compareError && <Notice error>{compareError}</Notice>}
                        {comparison ? (
                          <Comparison runs={comparison} />
                        ) : (
                          <p className="caption">
                            Choose two valid results CSV files to compare.
                          </p>
                        )}
                      </FieldGroup>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            ) : (
              <p className="caption">
                Saved run tools are available for single server pools.
              </p>
            )}
          </>
        ) : (
          <>
            <div>
              <h1
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-semibold tracking-tight outline-none md:text-3xl"
              >
                Simulation Lab
              </h1>
              <p className="mt-1 text-sm font-medium">{labName}</p>
              <Button asChild variant="outline" size="sm" className="mt-3 mr-2">
                <Link href="/setup">Edit configuration</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() =>
                  shardedComparison
                    ? router.push(shardedComparison)
                    : openComparison(
                        labExecution === "continuous" && live.snapshot
                          ? {
                              ...live.snapshot.config,
                              arrival_rate: live.snapshot.arrival_rate,
                              duration: config.duration,
                            }
                          : labTopology === "regions"
                            ? (regionalRun?.config ?? draftConfig)
                            : (run?.config ?? draftConfig),
                      )
                }
              >
                Compare this run
              </Button>
              {live.id && labExecution !== "continuous" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 ml-2"
                  onClick={() => {
                    setLabExecution("continuous");
                    setLabTopology(
                      live.snapshot?.topology === "regions"
                        ? "regions"
                        : "single_pool",
                    );
                  }}
                >
                  View live session
                </Button>
              )}
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {labTopology === "sharded" && labExecution === "one_shot"
                  ? "A coordinator splits each request across shards and waits for their replies."
                  : "See where requests went, how busy servers became, and whether traffic exceeded capacity."}
              </p>
            </div>
            {feedback && (
              <Notice role="status" error>
                {feedback}
              </Notice>
            )}
            {labExecution === "one_shot" &&
              labTopology === "single_pool" &&
              preview && (
                <Notice>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <Badge variant="secondary">UI preview</Badge> Recorded
                      example run. Run simulation to get new Python results.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRun(null);
                        setPreview(false);
                        history.replaceState(null, "", location.pathname);
                      }}
                    >
                      Close preview
                    </Button>
                  </div>
                </Notice>
              )}
            {labExecution === "continuous" ? (
              <LiveSessionPanel
                live={live}
                config={
                  live.snapshot
                    ? { ...live.snapshot.config, duration: config.duration }
                    : draftConfig
                }
              />
            ) : labTopology === "sharded" && shardedRun ? (
              <ShardedRunResults
                run={shardedRun.run}
                config={shardedRun.config}
              />
            ) : labTopology === "regions" ? (
              regionalRun ? (
                <RegionalTelemetry summary={regionalRun.summary} oneShot />
              ) : (
                <Notice>
                  Configure regional capacity and traffic, then select Run
                  simulation.
                </Notice>
              )
            ) : run ? (
              <>
                <Results key={JSON.stringify(run.config)} run={run} />
                <Panel title="Run configuration">
                  <pre>{JSON.stringify(run.config, null, 2)}</pre>
                </Panel>
                {run.run_id &&
                  run.config.request_model !== "cpu_io" &&
                  !run.config.processing_rates?.some((rate) => rate !== 1) && (
                    <Panel title="Download run">
                      <p className="caption mb-4">
                        Download the last completed run&apos;s configuration and
                        results. CSV includes summary metrics and per-server
                        utilization.
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <Button
                          variant="outline"
                          onClick={() => download("configuration")}
                        >
                          Download configuration (JSON)
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => download("results")}
                        >
                          Download results (CSV)
                        </Button>
                      </div>
                    </Panel>
                  )}
              </>
            ) : (
              <Empty className="min-h-80 border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Server />
                  </EmptyMedia>
                  <EmptyTitle>Ready for your first run</EmptyTitle>
                  <EmptyDescription>
                    Open Setup to choose your servers, workload and routing,
                    then run a simulation. Results show request outcomes,
                    response times, and server utilization.
                  </EmptyDescription>
                </EmptyHeader>
                <Button asChild>
                  <Link href="/setup">Configure a simulation</Link>
                </Button>
              </Empty>
            )}
          </>
        )}
      </main>
    </div>
  );
}
