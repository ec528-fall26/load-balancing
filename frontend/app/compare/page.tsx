"use client";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AppHeader } from "@/components/app-header";
import { ConfigFields } from "@/components/config-fields";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Notice, Panel } from "@/components/surface";
import { defaults, engineRequest, type Config, type Run } from "@/lib/engine";
import {
  readSetups,
  templates,
  validConfig,
  type SavedSetup,
} from "@/lib/saved-setups";
import {
  changedSettings,
  configLabels,
  COMPARE_DRAFT_KEY,
  compactRun,
} from "@/lib/comparison";
import type { CompletedCase } from "@/components/comparison-results";
import { LoaderCircle } from "lucide-react";
const ComparisonResults = dynamic(
  () =>
    import("@/components/comparison-results").then((m) => m.ComparisonResults),
  { loading: () => <p className="caption">Loading comparison charts…</p> },
);
type Variant = { id: string; config: Config };
const copy = (config: Config): Config => JSON.parse(JSON.stringify(config));
const alternative = (config: Config): Config => ({
  ...copy(config),
  policy:
    config.policy === "round_robin" ? "least_active_requests" : "round_robin",
});
export default function ComparePage() {
  const [base, setBase] = useState<Config>(defaults),
    [baseName, setBaseName] = useState("Default setup"),
    [source, setSource] = useState("default"),
    [saves, setSaves] = useState<SavedSetup[]>([]),
    [variants, setVariants] = useState<Variant[]>([
      { id: "first", config: alternative(defaults) },
    ]),
    [results, setResults] = useState<CompletedCase[] | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const [draftBaseline, setDraftBaseline] = useState<{
    name: string;
    config: Config;
  } | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    try {
      setSaves(readSetups());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read saved setups.");
    }
    if (new URLSearchParams(location.search).has("draft")) {
      try {
        const raw = sessionStorage.getItem(COMPARE_DRAFT_KEY);
        if (!raw || raw.length > 65536)
          throw new Error(
            "This lab setup is unavailable in this tab. Choose a baseline below.",
          );
        const draft = JSON.parse(raw);
        if (draft.version !== 1 || !validConfig(draft.config))
          throw new Error(
            "The lab setup is not valid for comparison. Fix its settings in Lab, or choose another baseline.",
          );
        setBase(draft.config);
        setBaseName(typeof draft.name === "string" ? draft.name : "Lab setup");
        setSource("draft");
        setDraftBaseline({
          name: typeof draft.name === "string" ? draft.name : "Lab setup",
          config: draft.config,
        });
        setVariants([{ id: "first", config: alternative(draft.config) }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load lab setup.");
      }
    }
  }, []);
  function chooseSource(value: string) {
    let config = defaults,
      name = "Default setup";
    if (value === "draft" && draftBaseline) {
      config = draftBaseline.config;
      name = draftBaseline.name;
    } else if (value.startsWith("template:")) {
      const t = templates.find((t) => `template:${t.id}` === value);
      if (!t) return;
      config = t.config;
      name = t.name;
    } else if (value.startsWith("save:")) {
      const t = saves.find((t) => `save:${t.id}` === value);
      if (!t) return;
      config = t.config;
      name = t.name;
    }
    setSource(value);
    setBase(copy(config));
    setBaseName(name);
    setVariants([{ id: crypto.randomUUID(), config: alternative(config) }]);
    setResults(null);
    setError("");
  }
  async function compare() {
    if (pending.current) return;
    const configs = [
      { label: "Baseline", config: copy(base) },
      ...variants.map((v, i) => ({
        label: `Variant ${String.fromCharCode(65 + i)}`,
        config: copy(v.config),
      })),
    ];
    for (const item of configs) {
      if (!validConfig(item.config)) {
        setError(
          `${item.label}: check server/slot limits, service times, seed, workload size and processing-rate count. Each run is limited to 100,000 requests and 4,096 execution slots.`,
        );
        return;
      }
    }
    if (variants.some((v) => !changedSettings(base, v.config).length)) {
      setError(
        "Each variant must change at least one setting from the baseline.",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    let active = "Baseline";
    try {
      const completed: CompletedCase[] = [];
      for (const [i, item] of configs.entries()) {
        active = item.label;
        setProgress(`Running ${item.label} (${i + 1} of ${configs.length})…`);
        const run = await engineRequest<Run>("run", { config: item.config });
        completed.push({ label: item.label, run: compactRun(run) });
      }
      setResults(completed);
      setProgress("Comparison complete.");
    } catch (e) {
      setError(
        `${active} failed: ${e instanceof Error ? e.message : "Unable to run comparison."} ${results ? "Previous complete results have been kept." : "No complete comparison was produced."}`,
      );
      setProgress("");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        section="compare"
        labHref={draftBaseline ? "/simulator?compareDraft=1" : "/simulator"}
      />
      <main className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-8 md:px-8 md:py-10">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Compare configurations
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Choose a baseline, change one or a few settings, and compare the
            outcomes. Keep the same seed for a repeatable workload. Add up to
            three variants.
          </p>
        </div>
        {error && <Notice error>{error}</Notice>}
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
          <Card role="region" aria-label="Baseline configuration">
            <CardHeader>
              <CardTitle>Baseline</CardTitle>
              <CardDescription>
                {baseName}. This is the reference for every delta.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Field className="max-w-sm">
                <FieldLabel htmlFor="comparison-baseline">
                  Load baseline from
                </FieldLabel>
                <Select
                  value={source}
                  onValueChange={chooseSource}
                  disabled={busy}
                >
                  <SelectTrigger id="comparison-baseline" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="default">Default setup</SelectItem>
                      {draftBaseline && (
                        <SelectItem value="draft">Current lab setup</SelectItem>
                      )}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel>Templates</SelectLabel>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={`template:${t.id}`}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {saves.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Saved setups</SelectLabel>
                        {saves.map((s) => (
                          <SelectItem key={s.id} value={`save:${s.id}`}>
                            {s.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Panel title="Baseline settings">
                <ConfigFields
                  key={source}
                  config={base}
                  onChange={setBase}
                  disabled={busy}
                />
              </Panel>
            </CardContent>
          </Card>
          <div
            className={cn(
              "grid items-start gap-5 lg:grid-cols-2",
              variants.length === 3 && "xl:grid-cols-3",
            )}
          >
            {variants.map((variant, index) => {
              const changes = changedSettings(base, variant.config);
              return (
                <Card
                  key={variant.id}
                  className="min-w-0"
                  role="region"
                  aria-label={`Variant ${String.fromCharCode(65 + index)} configuration`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle>
                        Variant {String.fromCharCode(65 + index)}
                      </CardTitle>
                      {variants.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setVariants((current) =>
                              current.filter((v) => v.id !== variant.id),
                            )
                          }
                          aria-label={`Remove variant ${String.fromCharCode(65 + index)}`}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                    <CardDescription>
                      {changes.length} changed{" "}
                      {changes.length === 1 ? "setting" : "settings"} from
                      baseline
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-wrap gap-1">
                      {changes.map((key) => (
                        <Badge key={key} variant="outline">
                          {configLabels[key]}
                        </Badge>
                      ))}
                      {!changes.length && (
                        <p className="caption">
                          Change a setting below to create a variant.
                        </p>
                      )}
                    </div>
                    <ConfigFields
                      disabled={busy}
                      config={variant.config}
                      onChange={(config) =>
                        setVariants((current) =>
                          current.map((v) =>
                            v.id === variant.id ? { ...v, config } : v,
                          ),
                        )
                      }
                    />
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={compare} disabled={busy}>
              {busy && (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              )}
              {busy ? "Running comparison…" : "Run comparison"}
            </Button>
            <Button
              variant="outline"
              disabled={busy || variants.length >= 3}
              onClick={() =>
                setVariants((current) => [
                  ...current,
                  { id: crypto.randomUUID(), config: copy(base) },
                ])
              }
            >
              Add variant
            </Button>
          </div>
        </fieldset>
        <p role="status" className="caption">
          {progress ||
            "Runs execute one at a time through Python. Results remain on this page; they are not saved to the setup library."}
        </p>
        {results && <ComparisonResults cases={results} />}
      </main>
    </div>
  );
}
