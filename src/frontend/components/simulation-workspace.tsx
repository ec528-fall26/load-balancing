"use client";
import { withoutRetries } from "@/lib/engine";
import { RegionalTelemetry } from "@/components/regional-telemetry";
import {
  regionalRequest,
  type RegionalConfig,
  type RegionalRun,
} from "@/lib/regions";
import { ShardedRunResults } from "@/components/sharded-run-results";
import {
  fanoutCompareHref,
  fanoutRequest,
  type FanoutRun,
  type ShardedConfig,
} from "@/lib/fanout";
import { LabControls } from "@/components/lab-controls";
import { useLiveSession } from "@/hooks/use-live-session";
import { useWorkspaceDraft } from "@/hooks/use-workspace-draft";
import { LiveSessionPanel } from "@/components/live-session-panel";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";

import {
  COMPARE_DRAFT_KEY,
} from "@/lib/comparison";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Config, engineRequest, Run } from "@/lib/engine";
import type { ExecutionMode } from "@/lib/saved-setups";
import { Results } from "@/components/results";
import {
  outagesSupported,
  withoutOutages,
} from "@/lib/availability";
import previewRun from "@/lib/preview-run.json";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from "@/components/ui/empty";
import { Panel, Notice } from "@/components/surface";
import { SavedRunTools, SavedRunDownloads } from "@/components/saved-run-tools";
import { useSavedRunTools } from "@/hooks/use-saved-run-tools";
import { SaveSetupDialog } from "@/components/save-setup-dialog";
import { AppHeader } from "@/components/app-header";
import { Server } from "lucide-react";
export default function SimulationWorkspace({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const queryParams = useSearchParams();
  const isSetup = pathname === "/setup";
  const [labExecution, setLabExecution] = useState<ExecutionMode>("one_shot");
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
  const [shardedRun, setShardedRun] = useState<{
    config: ShardedConfig;
    run: FanoutRun;
  } | null>(null);
  const [regionalRun, setRegionalRun] = useState<RegionalRun | null>(null);
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
  const {
    config, setConfig, topology, setTopology, regional, setRegional,
    regionalPolicy, setRegionalPolicy, sharded, setSharded, execution,
    setExecution, setupName, currentSave, rememberSaved, draftConfig, regionalConfig,
    draftReady, draftError, detachTemplate,
  } = useWorkspaceDraft(pathname, live.id === live.restoredId ? live.snapshot : null);
  const requestPending = useRef(false);
  const [run, setRun] = useState<Run | null>(null),
    [preview, setPreview] = useState(false),
    [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false);
  const savedRunTools = useSavedRunTools(runSinglePool);
  const showPreview = queryParams.has("preview");
  useEffect(() => {
    if (showPreview) {
      setLabExecution("one_shot");
      setLabTopology("single_pool");
      setPreview(true);
      setRun(previewRun as unknown as Run);
    }
  }, [showPreview]);
  function openComparison(
    compareConfig: Config | RegionalConfig,
    mode = execution,
    name = setupName,
  ) {
    try {
      sessionStorage.setItem(
        COMPARE_DRAFT_KEY,
        JSON.stringify({
          version: 1,
          name,
          config: compareConfig,
          execution: mode,
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
  async function runSinglePool(
    request: () => Promise<Run>,
    onError: (message: string) => void = setFeedback,
  ) {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setFeedback("");
    try {
      const result = await request();
      setRun(result);
      setPreview(false);
      setLabExecution("one_shot");
      setLabTopology("single_pool");
      setLabName(setupName);
      router.push("/simulator");
    } catch (error) {
      onError((error as Error).message);
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }
  if (pathname === "/compare" || pathname === "/docs") return children;
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
              execution={execution}
              current={currentSave}
              onSaved={rememberSaved}
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
            {(feedback || draftError) && (
              <Notice error role="status">
                {feedback || draftError}
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
                if (next === "continuous") setConfig(withoutRetries);
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
                  if (
                    await live.create(
                      topology === "regions"
                        ? draftConfig
                        : outagesSupported(config)
                          ? config
                          : withoutOutages(config),
                    )
                  ) {
                    setLabExecution("continuous");
                    setLabTopology(topology);
                    setLabName(setupName);
                    router.push("/simulator");
                  }
                } else if (topology === "regions") {
                  void runRegional();
                } else {
                  void runSinglePool(() =>
                    engineRequest<Run>("run", {
                      config: outagesSupported(config) ? config : withoutOutages(config),
                    }),
                  );
                }
              }}
            />
            {topology === "single_pool" ? (
              <SavedRunTools tools={savedRunTools} ready={draftReady} busy={busy} />
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
                        labExecution,
                        labName,
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
                <SavedRunDownloads run={run} onError={setFeedback} />
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
