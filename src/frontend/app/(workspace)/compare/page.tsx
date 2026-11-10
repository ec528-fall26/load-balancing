"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FanoutComparison } from "@/components/fanout-comparison";
import { fanoutSettingsFromQuery } from "@/lib/fanout";
import { AppHeader } from "@/components/app-header";
import { VariantEditor } from "@/components/variant-editor";
import { NumberField } from "@/components/number-field";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Notice, Panel } from "@/components/surface";
import { defaults, engineRequest, type Run } from "@/lib/engine";
import { regionalRequest, type RegionalRun } from "@/lib/regions";
import { readSetups, templates, type SavedSetup } from "@/lib/saved-setups";
import {
  changedSettings,
  settings,
  settingLabel,
  settingValue,
  isRegional,
  validCompareConfig,
  COMPARE_DRAFT_KEY,
  compactRun,
  compactRegionalRun,
  type CompareConfig,
} from "@/lib/comparison";
import type { CompletedCase } from "@/components/comparison-results";
import { LoaderCircle, Copy } from "lucide-react";
const ComparisonResults = dynamic(
  () =>
    import("@/components/comparison-results").then((m) => m.ComparisonResults),
  { loading: () => <p className="caption">Loading comparison charts…</p> },
);
type Variant = { id: string; config: CompareConfig; fields: string[] };
const clone = (config: CompareConfig): Variant => ({
  id: crypto.randomUUID(),
  config: structuredClone(config),
  fields: [],
});
export default function ComparePage() {
  const query = useSearchParams();
  if (query.has("fanout")) {
    return (
      <FanoutComparison
        key={query.toString()}
        initial={fanoutSettingsFromQuery(query)}
        href={`/compare?${query}`}
      />
    );
  }
  return <RoutingComparison />;
}

function RoutingComparison() {
  const [base, setBase] = useState<CompareConfig>(defaults),
    [baseName, setBaseName] = useState("Default setup"),
    [source, setSource] = useState("default"),
    [saves, setSaves] = useState<SavedSetup[]>([]),
    [variants, setVariants] = useState<Variant[]>([
      { id: "first", config: structuredClone(defaults), fields: [] },
    ]),
    [results, setResults] = useState<CompletedCase[] | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [fromContinuous, setFromContinuous] = useState(false);
  const [draftBaseline, setDraftBaseline] = useState<{
    name: string;
    config: CompareConfig;
  } | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    try {
      setSaves(readSetups());
    } catch (e) {
      setError((e as Error).message);
    }
    if (new URLSearchParams(location.search).has("draft")) {
      try {
        const raw = sessionStorage.getItem(COMPARE_DRAFT_KEY);
        if (!raw || raw.length > 65536)
          throw new Error(
            "This lab setup is unavailable in this tab. Choose a baseline below.",
          );
        const draft = JSON.parse(raw);
        if (draft.version !== 1 || !validCompareConfig(draft.config))
          throw new Error(
            "The lab setup needs valid settings and a bounded arrival window of at most 100,000 requests. Adjust it in Lab, then compare again.",
          );
        const name = typeof draft.name === "string" ? draft.name : "Lab setup";
        setBase(structuredClone(draft.config));
        setBaseName(name);
        setSource("draft");
        setDraftBaseline({ name, config: structuredClone(draft.config) });
        setVariants([clone(draft.config)]);
        setFromContinuous(draft.execution === "continuous");
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, []);
  function chooseSource(value: string) {
    let config: CompareConfig = defaults,
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
    setBase(structuredClone(config));
    setBaseName(name);
    setVariants([clone(config)]);
    setResults(null);
    setError("");
  }
  function update(id: string, patch: Partial<Variant>) {
    setVariants((current) =>
      current.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    );
  }
  async function compare() {
    if (pending.current) return;
    const configs = [
      { label: "Baseline", config: structuredClone(base) },
      ...variants.map((v, i) => ({
        label: `Variant ${String.fromCharCode(65 + i)}`,
        config: structuredClone(v.config),
      })),
    ];
    if (configs.some((c) => !validCompareConfig(c.config))) {
      setError(
        "Check capacity, service times, seed, rates and the arrival window. Each case is limited to 100,000 requests and 4,096 execution slots.",
      );
      return;
    }
    if (variants.some((v) => !changedSettings(base, v.config).length)) {
      setError(
        "Each variant must change at least one setting from the baseline. Choose a setting below, or remove an unchanged clone.",
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
        setProgress(`Running ${active} (${i + 1} of ${configs.length})…`);
        const run = isRegional(item.config)
          ? compactRegionalRun(
              await regionalRequest<RegionalRun>("run", {
                config: item.config,
              }),
            )
          : compactRun(
              await engineRequest<Run>("run", { config: item.config }),
            );
        completed.push({ label: item.label, run });
      }
      setResults(completed);
      setProgress("Comparison complete.");
    } catch (e) {
      setError(
        `${active} failed: ${(e as Error).message} ${results ? "Previous complete results have been kept." : "No complete comparison was produced."}`,
      );
      setProgress("");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const regional = isRegional(base);
  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        section="compare"
        setupHref={draftBaseline ? "/setup?compareDraft=1" : "/setup"}
      />
      <main className="mx-auto flex max-w-7xl flex-col gap-7 px-5 py-8 md:px-8 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Compare configurations
            </h1>
            <p className="mt-2 max-w-3xl text-muted-foreground">
              Keep your setup as the baseline. Clone it, change one or two
              settings, and see what those changes do.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/compare?fanout=1">Compare fan-out</Link>
          </Button>
        </div>
        {error && <Notice error>{error}</Notice>}
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">Configurations</h2>
              <p className="caption">
                Each starts as an exact copy. Only your chosen changes differ.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy || variants.length >= 3}
              onClick={() =>
                setVariants((current) => [...current, clone(base)])
              }
            >
              <Copy data-icon="inline-start" />
              Clone baseline
            </Button>
          </div>
          <div
            role="region"
            aria-label="Configuration comparison"
            tabIndex={0}
            className="min-w-0 overflow-x-auto px-1 pt-1 pb-2 focus-visible:outline focus-visible:outline-ring"
          >
            <div
              className="grid items-start gap-5 sm:grid-cols-[repeat(var(--comparison-columns),minmax(280px,1fr))]"
              style={
                { "--comparison-columns": variants.length + 1 } as CSSProperties
              }
            >
              <Card
                role="region"
                aria-label="Baseline configuration"
                className="min-w-0"
              >
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <CardTitle>Baseline · {baseName}</CardTitle>
                      <CardDescription>
                        {regional
                          ? `${base.regions.length} regions · ${base.regions.reduce((n, r) => n + r.servers, 0)} servers`
                          : `${base.server_count} servers × ${base.concurrency} slots`}{" "}
                        · {base.arrival_rate.toLocaleString()} requests/s · seed{" "}
                        {base.seed}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">Unchanged reference</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="comparison-baseline">
                        Load baseline from
                      </FieldLabel>
                      <Select
                        value={source}
                        onValueChange={chooseSource}
                        disabled={busy}
                      >
                        <SelectTrigger id="comparison-baseline">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="default">
                              Default setup
                            </SelectItem>
                            {draftBaseline && (
                              <SelectItem value="draft">
                                Current lab setup
                              </SelectItem>
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
                              {saves.map((t) => (
                                <SelectItem key={t.id} value={`save:${t.id}`}>
                                  {t.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                    </Field>
                    <NumberField
                      label="Comparison window (s)"
                      value={base.duration}
                      step={0.01}
                      onChange={(duration) => {
                        setBase((c) => ({ ...c, duration }));
                        setVariants((current) =>
                          current.map((v) => ({
                            ...v,
                            config: { ...v.config, duration },
                          })),
                        );
                      }}
                    />
                  </FieldGroup>
                  <p className="caption">
                    {fromContinuous && source === "draft"
                      ? "This captures the configuration, not the running session. "
                      : ""}
                    Every case starts fresh with the same seed and runs for the
                    bounded arrival window, then drains. Your Lab setup and live
                    session are preserved.
                  </p>
                  <Panel title="View baseline settings">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Setting</TableHead>
                          <TableHead>Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {settings(base).map((s) => (
                          <TableRow key={s.key}>
                            <TableCell>{s.label}</TableCell>
                            <TableCell>{settingValue(base, s.key)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <pre>{JSON.stringify(base, null, 2)}</pre>
                  </Panel>
                </CardContent>
              </Card>
              {variants.map((variant, index) => {
                const changes = changedSettings(base, variant.config),
                  label = `Variant ${String.fromCharCode(65 + index)}`;
                return (
                  <Card
                    key={variant.id}
                    role="region"
                    aria-label={`${label} configuration`}
                    className="min-w-0"
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle>{label}</CardTitle>
                        <Badge variant="outline">
                          {changes.length
                            ? `${changes.length} changed`
                            : "Matches baseline"}
                        </Badge>
                      </div>
                      <CardDescription>
                        {changes.length
                          ? "All other settings match the baseline."
                          : "Choose what to change. Nothing is changed automatically."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-5">
                      <VariantEditor
                        base={base}
                        config={variant.config}
                        fields={variant.fields}
                        onFields={(fields) => update(variant.id, { fields })}
                        onChange={(config) => update(variant.id, { config })}
                        disabled={busy}
                      />
                      {!!changes.length && (
                        <Table aria-label={`${label} setting differences`}>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Changed setting</TableHead>
                              <TableHead>Baseline</TableHead>
                              <TableHead>{label}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {changes.map((key) => (
                              <TableRow key={key}>
                                <TableCell>{settingLabel(base, key)}</TableCell>
                                <TableCell>{settingValue(base, key)}</TableCell>
                                <TableCell className="font-medium">
                                  {settingValue(variant.config, key)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy || variants.length >= 3}
                          onClick={() =>
                            setVariants((current) => [
                              ...current,
                              {
                                ...clone(variant.config),
                                fields: [...variant.fields],
                              },
                            ])
                          }
                        >
                          Clone {label}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={
                            busy || (!variant.fields.length && !changes.length)
                          }
                          onClick={() =>
                            update(variant.id, {
                              config: structuredClone(base),
                              fields: [],
                            })
                          }
                        >
                          Reset to baseline
                        </Button>
                        {variants.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove variant ${String.fromCharCode(65 + index)}`}
                            onClick={() =>
                              setVariants((current) =>
                                current.filter((v) => v.id !== variant.id),
                              )
                            }
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button onClick={compare} disabled={busy}>
              {busy && (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                />
              )}
              {busy ? "Running comparison…" : "Run comparison"}
            </Button>
            <p className="caption">
              Baseline + {variants.length}{" "}
              {variants.length === 1 ? "variant" : "variants"} · sequential
              Python runs
            </p>
          </div>
        </fieldset>
        <p role="status" className="caption">
          {progress ||
            "Results show differences relative to the baseline. A failed case keeps the previous complete comparison."}
        </p>
        {results && <ComparisonResults cases={results} />}
        <Button asChild variant="outline" className="self-start">
          <Link
            href={draftBaseline ? "/setup?compareDraft=1" : "/setup"}
          >
            Back to Setup
          </Link>
        </Button>
      </main>
    </div>
  );
}
