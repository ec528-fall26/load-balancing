"use client";
import { useEffect, useRef, useState } from "react";
import { Config, defaults, engineRequest, policies, Run } from "@/lib/engine";
import { Results, seconds } from "@/components/results";
import previewRun from "@/lib/preview-run.json";
import { NumberField } from "@/components/number-field";
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
    <label className="upload-label">
      {label}
      <span className="upload">
        <span>
          ⇧ &nbsp; Drag and drop file here
          <span className="caption">
            Limit 200MB per file • {accept.slice(1).toUpperCase()}
          </span>
        </span>
        <span className="browse">Browse files</span>
        <input
          type="file"
          accept={accept}
          aria-label={label}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </span>
    </label>
  );
}
function Comparison({ runs }: { runs: [Run, Run] }) {
  const changed = (Object.keys(runs[0].config) as (keyof Config)[]).filter(
    (k) => runs[0].config[k] !== runs[1].config[k],
  );
  return (
    <>
      <div
        className={`notice ${changed.some((k) => k !== "policy") ? "warning" : ""}`}
      >
        {changed.some((k) => k !== "policy")
          ? `Settings differ: ${changed.join(", ")}. Workload or capacity differences also affect these results; this is not an isolated policy comparison.`
          : changed.length
            ? "Only the routing policy differs; workload and capacity settings match."
            : "Both files have the same configuration."}
      </div>
      <div className="columns">
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
              <table>
                <thead>
                  <tr>
                    <th>Server ID</th>
                    <th>Slot utilization (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(s.per_server_utilization).map(([sid, u]) => (
                    <tr key={sid}>
                      <td>{sid}</td>
                      <td>{(u * 100).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
      <table>
        <thead>
          <tr>
            <th>Setting</th>
            <th>Run A</th>
            <th>Run B</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(runs[0].config) as (keyof Config)[]).map((k) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{String(runs[0].config[k])}</td>
              <td>{String(runs[1].config[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
export default function Page() {
  const requestPending = useRef(false);
  const [config, setConfig] = useState<Config>(defaults),
    [run, setRun] = useState<Run | null>(null),
    [preview, setPreview] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState<unknown>(null),
    [savedName, setSavedName] = useState(""),
    [replayError, setReplayError] = useState(""),
    [comparison, setComparison] = useState<[Run, Run] | null>(null),
    [csv, setCsv] = useState<[string, string]>(["", ""]),
    [fileNames, setFileNames] = useState<[string, string]>(["", ""]),
    [compareError, setCompareError] = useState("");
  useEffect(() => {
    if (window.matchMedia("(max-width:760px)").matches) setSidebar(false);
    if (new URLSearchParams(location.search).has("preview")) {
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
    try {
      if (file.size > 200 * 1024 * 1024) throw new Error("File exceeds 200MB.");
      const next: [string, string] = [...csv];
      next[index] = await file.text();
      setCsv(next);
      setFileNames((current) => {
        const names: [string, string] = [...current];
        names[index] = file.name;
        return names;
      });
      setComparison(null);
      setCompareError("");
      if (next.every(Boolean))
        setComparison(
          await engineRequest<[Run, Run]>("compare", { results: next }),
        );
    } catch (error) {
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
    <div className={sidebar ? "app" : "app collapsed"}>
      <aside aria-label="Run configuration" hidden={!sidebar}>
        <button
          className="collapse"
          title="Close sidebar"
          onClick={() => setSidebar(false)}
        >
          «
        </button>
        <h2>Configure a run</h2>
        <form
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
          <h3>Servers</h3>
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
          <label>
            Routing policy
            <span
              className="help"
              title="Least active counts running requests only; ties favor the lowest server ID. Waiting requests do not count and full targets reject without retrying."
            >
              ?
            </span>
            <select
              value={config.policy}
              onChange={(e) =>
                setConfig({
                  ...config,
                  policy: e.target.value as Config["policy"],
                })
              }
            >
              {Object.entries(policies).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <h3>Traffic</h3>
          {number("arrival_rate", "Requests per second", undefined, 0.01)}
          {number("duration", "Arrival window (seconds)", undefined, 0.01)}
          <div className="columns small-gap">
            {number("service_min", "Min service (s)", undefined, 0.001)}
            {number("service_max", "Max service (s)", undefined, 0.001)}
          </div>
          <details>
            <summary>Repeatability</summary>
            <div className="details-content">
              {number("seed", "Random seed")}
              <p className="caption">
                Keep the settings and seed unchanged to repeat a run.
              </p>
            </div>
          </details>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Running simulation..." : "Run simulation"}
          </button>
        </form>
        <p className="caption">
          Evenly spaced arrivals, sampled service times, and identical servers.
        </p>
        <details>
          <summary>Replay a saved run</summary>
          <div className="details-content">
            <Upload
              label="Configuration export (JSON)"
              accept=".json"
              onFile={readConfig}
            />
            {replayError && (
              <div role="alert" className="notice error">
                {replayError}
              </div>
            )}
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
                  Replay uses these saved settings and seed, independently of
                  the settings form above. It verifies the saved metrics before
                  replacing the current results.
                </p>
                <button disabled={busy} onClick={() => request("replay")}>
                  Replay saved configuration
                </button>
              </>
            )}
          </div>
        </details>
      </aside>
      {!sidebar && (
        <button
          className="expand"
          title="Open sidebar"
          onClick={() => setSidebar(true)}
        >
          »
        </button>
      )}
      <main>
        <h1>Load balancing simulator</h1>
        <p>
          Explore how traffic and server capacity affect waiting, latency, and
          rejected requests.
        </p>
        {feedback && (
          <div role="status" className="notice warning">
            {feedback}
          </div>
        )}
        {preview && (
          <div className="notice preview">
            UI preview · Recorded example run. The Python engine is not
            connected.
            <button
              onClick={() => {
                setRun(null);
                setPreview(false);
                history.replaceState(null, "", location.pathname);
              }}
            >
              Close preview
            </button>
          </div>
        )}
        {run ? (
          <>
            <Results key={JSON.stringify(run.config)} run={run} />
            <details>
              <summary>Run configuration</summary>
              <div className="details-content">
                <pre>{JSON.stringify(run.config, null, 2)}</pre>
              </div>
            </details>
            <details>
              <summary>Download run</summary>
              <div className="details-content">
                <p className="caption">
                  Download the last completed run&apos;s configuration and
                  results. CSV includes summary metrics and per-server
                  utilization.
                </p>
                <div className="columns">
                  <button onClick={() => download("configuration")}>
                    Download configuration (JSON)
                  </button>
                  <button onClick={() => download("results")}>
                    Download results (CSV)
                  </button>
                </div>
              </div>
            </details>
          </>
        ) : (
          <>
            <div className="notice">
              Configure your servers and traffic in the sidebar, then select Run
              simulation.
            </div>
            <h2>What you&apos;ll see</h2>
            <p>
              Request outcomes show whether capacity kept up with traffic.
              Response times include both queue waiting and service. Server
              utilization shows how evenly work was distributed.
            </p>
          </>
        )}
        <details>
          <summary>Compare saved results</summary>
          <div className="details-content">
            <p className="caption">
              Upload two original results CSV exports. Comparison reads their
              saved metrics and does not run a simulation or change the active
              run.
            </p>
            <div className="columns">
              {[0, 1].map((i) => (
                <div key={i}>
                  <Upload
                    label={`Run ${i ? "B" : "A"} results (CSV)`}
                    accept=".csv"
                    onFile={(file) => readCsv(file, i)}
                  />
                  {fileNames[i] && <p className="caption">{fileNames[i]}</p>}
                </div>
              ))}
            </div>
            {compareError && (
              <div className="notice warning" role="alert">
                {compareError}
              </div>
            )}
            {comparison ? (
              <Comparison runs={comparison} />
            ) : (
              <div className="notice">
                Choose two valid results CSV files to compare.
              </div>
            )}
          </div>
        </details>
      </main>
    </div>
  );
}
