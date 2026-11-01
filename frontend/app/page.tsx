"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, FolderOpen } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { SetupCard } from "@/components/setup-card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Notice } from "@/components/surface";
import {
  readSetups,
  deleteSetup,
  templates,
  type SavedSetup,
  LIBRARY_KEY,
} from "@/lib/saved-setups";
export default function Home() {
  const [items, setItems] = useState<SavedSetup[]>([]),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("all");
  useEffect(() => {
    // Retain previously shared recorded-preview links.
    if (new URLSearchParams(location.search).has("preview")) {
      location.replace("/simulator?preview=1");
      return;
    }
    function refresh() {
      try {
        setItems(readSetups());
        setError("");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not read browser storage.",
        );
      } finally {
        setReady(true);
      }
    }
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === LIBRARY_KEY || event.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  function remove(id: string) {
    try {
      deleteSetup(id);
      setItems(readSetups());
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not delete saved setup.",
      );
    }
  }
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const saves = tab === "templates" ? [] : items.filter((i) => matches(i.name));
  const starters =
    tab === "saved"
      ? []
      : templates.filter((i) => matches(i.name + " " + i.description));
  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        actions={
          <Button asChild size="sm">
            <Link href="/simulator">
              <Plus data-icon="inline-start" />
              New simulation
            </Link>
          </Button>
        }
      />
      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-8 md:px-8 md:py-12">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Your simulations
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Start from a template or pick up a saved setup. Explore how routing,
            traffic, and capacity affect your server pool.
          </p>
          <p className="caption">
            Saves stay in this browser. They contain configuration and seed;
            results are generated when you run them.
          </p>
        </div>
        {error && <Notice error>{error}</Notice>}
        <Tabs value={tab} onValueChange={setTab} className="gap-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <TabsList aria-label="Setup library filter">
              <TabsTrigger value="all">All setups</TabsTrigger>
              <TabsTrigger value="saved">
                Saved {ready ? `(${items.length})` : ""}
              </TabsTrigger>
              <TabsTrigger value="templates">
                Templates ({templates.length})
              </TabsTrigger>
            </TabsList>
            <InputGroup className="sm:max-w-xs">
              <InputGroupInput
                aria-label="Search setups"
                placeholder="Search setups…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
            </InputGroup>
          </div>
          <TabsContent value={tab}>
            {!ready ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-80 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {saves.map((item) => (
                  <SetupCard
                    key={`save-${item.id}`}
                    {...item}
                    onDelete={remove}
                  />
                ))}
                {starters.map((item) => (
                  <SetupCard key={`template-${item.id}`} {...item} />
                ))}
              </div>
            )}
            {ready && !saves.length && !starters.length && (
              <Empty className="min-h-64 border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderOpen />
                  </EmptyMedia>
                  <EmptyTitle>
                    {query ? "No matching setups" : "No saved setups yet"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query
                      ? "Try another name or clear the search."
                      : "Open a template or create a simulation, then choose Save setup to add it here."}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {query ? (
                    <Button variant="outline" onClick={() => setQuery("")}>
                      Clear search
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setTab("templates")}
                    >
                      Browse templates
                    </Button>
                  )}
                </EmptyContent>
              </Empty>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
