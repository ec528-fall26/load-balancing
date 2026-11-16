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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Notice, Panel } from "@/components/surface";
import { seconds } from "@/components/results";
import { hasOutages } from "@/lib/availability";
import { engineRequest, type Config, type Run } from "@/lib/engine";
import type { useSavedRunTools } from "@/hooks/use-saved-run-tools";

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
export function SavedRunTools({
  tools,
  ready,
  busy,
}: {
  tools: ReturnType<typeof useSavedRunTools>;
  ready: boolean;
  busy: boolean;
}) {
  const {
    saved, savedName, replayError, replay, readConfig, readCsv,
    fileNames, compareError, comparison,
  } = tools;
  return (
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
            <Button variant="outline" disabled={!ready}>
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
                  <pre>{JSON.stringify(saved.config, null, 2)}</pre>
                  <p className="caption">
                    Replay verifies the saved metrics using the exported
                    settings and seed, then opens the result in Lab.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={replay}
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
            <Button variant="outline" disabled={!ready}>
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
  );
}

export function SavedRunDownloads({
  run,
  onError,
}: {
  run: Run;
  onError: (message: string) => void;
}) {
  const { run_id: runId, config } = run;
  if (
    !runId ||
    config.request_model === "cpu_io" ||
    config.processing_rates?.some((rate) => rate !== 1) ||
    hasOutages(config)
  ) {
    return null;
  }

  async function download(kind: "configuration" | "results") {
    try {
      const data = await engineRequest<{
        config_json: string;
        results_csv: string;
        run_id: string;
      }>("exports", { run_id: runId });
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
      onError((error as Error).message);
    }
  }
  return (
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
  );
}
