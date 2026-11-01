"use client";
import { useRouter } from "next/navigation";
import { OpenSetupOnLoad } from "@/components/open-setup-on-load";
import { COMPARE_DRAFT_KEY } from "@/lib/comparison";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Config, defaults, engineRequest, policies, Run } from "@/lib/engine";
import { Results, seconds } from "@/components/results";
import previewRun from "@/lib/preview-run.json";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { Panel, Notice } from "@/components/surface";
import { SaveSetupDialog } from "@/components/save-setup-dialog";
import {
  readSetups,
  templates,
  validConfig,
  type SavedSetup,
} from "@/lib/saved-setups";
import { AppHeader, SetupToggle } from "@/components/app-header";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { Play, Server, LoaderCircle } from "lucide-react";
function Upload({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
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
        Choose an original {accept.slice(1).toUpperCase()} export. Limit 200 MB.
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
export default function Page() {
  const router = useRouter();
  const [sourceReady, setSourceReady] = useState(false);
  const [currentSave, setCurrentSave] = useState<SavedSetup | null>(null);
  const [setupName, setSetupName] = useState("New simulation");
  const setupTrigger = useRef<HTMLButtonElement>(null);
  const requestPending = useRef(false);
  const csvFiles = useRef<[string, string]>(["", ""]);
  const uploadVersions = useRef([0, 0]);
  const comparisonVersion = useRef(0);
  const [config, setConfig] = useState<Config>(defaults),
    [run, setRun] = useState<Run | null>(null),
    [preview, setPreview] = useState(false),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<unknown>(null),
    [savedName, setSavedName] = useState(""),
    [replayError, setReplayError] = useState(""),
    [comparison, setComparison] = useState<[Run, Run] | null>(null),
    [fileNames, setFileNames] = useState<[string, string]>(["", ""]),
    [compareError, setCompareError] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    try {
      if (query.has("compareDraft")) {
        const raw = sessionStorage.getItem(COMPARE_DRAFT_KEY);
        if (!raw || raw.length > 65536)
          throw new Error(
            "The comparison's lab setup is unavailable in this tab.",
          );
        const draft = JSON.parse(raw);
        if (draft.version !== 1 || !validConfig(draft.config))
          throw new Error("The comparison's lab setup could not be loaded.");
        setConfig(draft.config);
        setSetupName(typeof draft.name === "string" ? draft.name : "Lab setup");
        setSourceReady(true);
      } else if (query.has("save")) {
        const item = readSetups().find((item) => item.id === query.get("save"));
        if (!item)
          throw new Error(
            "This saved setup was not found in this browser. Your default setup is ready below.",
          );
        setConfig(item.config);
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
        setSetupName(item.name);
        setSourceReady(true);
      }
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "Could not load this setup.",
      );
    }
    if (query.has("preview")) {
      setPreview(true);
      setRun(previewRun as unknown as Run);
    }
  }, []);
  async function request(operation: "run" | "replay") {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setFeedback("");
    try {
      const result = await engineRequest<Run>(
        operation,
        operation === "run" ? { config } : { configuration: saved },
      );
      setRun(result);
      setPreview(false);
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }
  async function readConfig(file: File) {
    try {
      if (file.size > 200 * 1024 * 1024) throw new Error("File exceeds 200MB.");
      const data = JSON.parse(await file.text());
      if (!data.config || typeof data.config !== "object")
        throw new Error(
          "Choose a configuration export containing a config object.",
        );
      setSaved(data);
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
      if (file.size > 200 * 1024 * 1024) throw new Error("File exceeds 200MB.");
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
    try {
      const data = await engineRequest<{
        config_json: string;
        results_csv: string;
        run_id: string;
      }>("exports", run);
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
  function number(
    key: Exclude<keyof Config, "policy" | "processing_rates">,
    label: string,
    help?: string,
    step = 1,
  ) {
    return (
      <NumberField
        label={label}
        value={config[key]}
        step={step}
        help={help}
        onChange={(value) =>
          setConfig((current) => ({ ...current, [key]: value }))
        }
      />
    );
  }
  return (
    <SidebarProvider
      className="flex-col bg-background"
      style={{ "--sidebar-width": "20rem" } as CSSProperties}
    >
      <OpenSetupOnLoad
        ready={sourceReady}
        completedRun={preview ? null : run}
      />
      <AppHeader
        section="lab"
        triggerRef={setupTrigger}
        actions={
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
                `/simulator?save=${encodeURIComponent(item.id)}`,
              );
            }}
          />
        }
      />
      <div className="flex flex-1">
        <Sidebar
          collapsible="offcanvas"
          mobileTitle="Run configuration"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            setupTrigger.current?.focus();
          }}
          className="top-16 h-[calc(100svh-4rem)]"
          aria-label="Run configuration"
        >
          <SidebarHeader className="p-5 pb-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold">Configure a run</h2>
                <p className="caption">Set capacity, traffic, and routing.</p>
              </div>
              <div className="md:hidden">
                <SetupToggle />
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent className="gap-0 p-5">
            {feedback && (
              <div className="mb-4 md:hidden">
                <Notice error role="status">
                  {feedback}
                </Notice>
              </div>
            )}
            <form
              className="flex flex-col gap-6"
              onSubmit={(e) => {
                e.preventDefault();
                if (config.service_min > config.service_max) {
                  setFeedback(
                    "service_min must be less than or equal to service_max",
                  );
                  return;
                }
                request("run");
              }}
            >
              <FieldSet>
                <FieldLegend>Servers</FieldLegend>
                <FieldGroup>
                  {number("server_count", "Server count")}
                  {number(
                    "concurrency",
                    "Slots per server",
                    "Requests each server can process at once.",
                  )}
                  {number(
                    "queue_limit",
                    "Waiting places per server",
                    "Zero rejects requests when all slots are busy.",
                  )}
                  <Field>
                    <FieldLabel htmlFor="routing-policy">
                      Routing policy
                    </FieldLabel>
                    <NativeSelect
                      id="routing-policy"
                      value={config.policy}
                      onChange={(e) =>
                        setConfig((current) => ({
                          ...current,
                          policy: e.target.value as Config["policy"],
                        }))
                      }
                    >
                      {Object.entries(policies).map(([value, label]) => (
                        <NativeSelectOption key={value} value={value}>
                          {label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <FieldDescription>
                      Least active counts running requests. Full targets reject
                      without retrying.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </FieldSet>
              <Separator />
              <FieldSet>
                <FieldLegend>Traffic</FieldLegend>
                <FieldGroup>
                  {number(
                    "arrival_rate",
                    "Requests per second",
                    undefined,
                    0.01,
                  )}
                  {number(
                    "duration",
                    "Arrival window (seconds)",
                    undefined,
                    0.01,
                  )}
                  <FieldGroup className="grid grid-cols-2 gap-3">
                    {number("service_min", "Min service (s)", undefined, 0.001)}
                    {number("service_max", "Max service (s)", undefined, 0.001)}
                  </FieldGroup>
                </FieldGroup>
              </FieldSet>
              <Panel title="Repeatability">
                <FieldGroup>
                  {number("seed", "Random seed")}
                  <FieldDescription>
                    Keep the settings and seed unchanged to repeat a run.
                  </FieldDescription>
                </FieldGroup>
              </Panel>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                ) : (
                  <Play data-icon="inline-start" />
                )}
                {busy ? "Running simulation..." : "Run simulation"}
              </Button>
            </form>
            <p className="caption mt-4">
              Evenly spaced arrivals, sampled service times, and identical
              servers.
            </p>
            <Panel title="Replay a saved run">
              <FieldGroup>
                <Upload
                  label="Configuration export (JSON)"
                  accept=".json"
                  onFile={readConfig}
                />
                {replayError && <Notice error>{replayError}</Notice>}
                {saved !== null && (
                  <>
                    <p className="caption">{savedName}</p>
                    <pre>
                      {JSON.stringify(
                        (saved as { config: Config }).config,
                        null,
                        2,
                      )}
                    </pre>
                    <p className="caption">
                      Replay uses these saved settings and seed, independently
                      of the settings form above. It verifies the saved metrics
                      before replacing the current results.
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
            </Panel>
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="flex min-w-0 flex-col gap-6 p-5 md:p-8 lg:p-10">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
              Load balancing simulator
            </h1>
            <p className="mt-1 text-sm font-medium">{setupName}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                try {
                  sessionStorage.setItem(
                    COMPARE_DRAFT_KEY,
                    JSON.stringify({ version: 1, name: setupName, config }),
                  );
                  router.push("/compare?draft=1");
                } catch {
                  setFeedback(
                    "Could not transfer this setup to Compare. Browser session storage may be unavailable.",
                  );
                }
              }}
            >
              Compare current setup
            </Button>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Explore how traffic and server capacity affect waiting, latency,
              and rejected requests.
            </p>
          </div>
          {feedback && (
            <Notice role="status" error>
              {feedback}
            </Notice>
          )}
          {preview && (
            <Notice>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  <Badge variant="secondary">UI preview</Badge> Recorded example
                  run. Run simulation to get new Python results.
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
          {run ? (
            <>
              <Results key={JSON.stringify(run.config)} run={run} />
              <Panel title="Run configuration">
                <pre>{JSON.stringify(run.config, null, 2)}</pre>
              </Panel>
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
                  <Button variant="outline" onClick={() => download("results")}>
                    Download results (CSV)
                  </Button>
                </div>
              </Panel>
            </>
          ) : (
            <Empty className="min-h-80 border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Server />
                </EmptyMedia>
                <EmptyTitle>Ready for your first run</EmptyTitle>
                <EmptyDescription>
                  Configure your servers and traffic, then select Run
                  simulation. Results show request outcomes, response times, and
                  server utilization.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <Panel title="Compare saved results">
            <FieldGroup>
              <FieldDescription>
                Upload two original results CSV exports. Comparison reads their
                saved metrics and does not run a simulation or change the active
                run.
              </FieldDescription>
              <FieldGroup className="grid gap-6 md:grid-cols-2">
                {[0, 1].map((i) => (
                  <div className="min-w-0" key={i}>
                    <Upload
                      label={`Run ${i ? "B" : "A"} results (CSV)`}
                      accept=".csv"
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
          </Panel>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
