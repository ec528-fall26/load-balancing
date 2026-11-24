import Image from "next/image";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { metricHelp } from "@/lib/metric-help";

const sections = [
  { id: "start", label: "Quick start" },
  { id: "models", label: "Simulation models" },
  { id: "disk", label: "CPU and disk" },
  { id: "live", label: "Live controls and outages" },
  { id: "compare", label: "Compare and export" },
  { id: "glossary", label: "Definitions" },
  { id: "troubleshoot", label: "Troubleshooting" },
];

const definitions = [
  ["Offered traffic", "New requests generated at the configured rate. A regional client weight determines the fraction originating in that region."],
  ["Slot", "One concurrent operation at a resource. A CPU slot executes work. A disk slot is occupied while a read or write is in service."],
  ["Queue", "Work waiting for an available slot. In the staged model, the CPU and disk have distinct queues."],
  ["Outstanding", "All work already admitted and still unfinished, including active CPU, queued CPU, and work waiting for or using I/O."],
  ["Service time", "Time a request occupies a resource. Response time also includes waiting and any modeled network travel."],
  ["Round Robin", "Rotate through eligible targets in order."],
  ["Least Active Requests", "Pick the target with the fewest requests currently executing. Queued work and I/O do not count."],
  ["Least Outstanding", "Pick the target with the fewest unfinished requests, including queued work and I/O."],
  ["Power of Two Choices", "Sample two targets and use the policy’s load comparison to choose between them."],
  ["RTT", "Round-trip time from a client region to a target region, or from a coordinator to a shard and back."],
  ["Admission limit", "Maximum unfinished requests per server in CPU/I/O mode. When the selected target reaches this bound, a new request can be rejected."],
  ["Drain", "Stop generating new work and finish requests already admitted. One-shot runs drain after the arrival window."],
  ["P95", metricHelp.p95],
  ["Rejection rate", metricHelp.rejection],
  ["Utilization", metricHelp.utilization],
  ["Seed", "Input to the pseudo-random generator. Keep it and the workload settings fixed for repeatable comparisons."],
  ["Fan-out", "Split a parent request into calls to multiple shards. The coordinator waits for every required reply."],
  ["Deadline", "Maximum time for a parent request to finish, including coordinator work, shard work, and network waits."],
  ["Availability and MTTR", "Availability sets the expected fraction of time a server is up in the stochastic model. Mean time to recover (MTTR) sets the average length of an outage."],
];

function Screenshot({ file, alt, caption }: { file: string; alt: string; caption: string }) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <Image src={`/docs/${file}`} alt={alt} width={1280} height={900}
        unoptimized className="h-auto w-full rounded-lg border" />
      <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-dvh">
      <AppHeader section="docs" />
      <main id="main-content" className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 pb-28 sm:px-6 md:pb-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Documentation</h1>
          <p className="max-w-2xl text-muted-foreground">
            Set up a simulation, inspect a request, and compare what happens when you change a policy, resource, or failure condition.
          </p>
        </header>
        <nav aria-label="Documentation contents" className="flex flex-wrap gap-2">
          {sections.map(({ id, label }) => (
            <Button key={id} variant="outline" size="sm" asChild>
              <a href={`#${id}`}>{label}</a>
            </Button>
          ))}
        </nav>
        <Card id="start" className="scroll-mt-20">
          <CardHeader>
            <CardTitle>Run your first simulation</CardTitle>
            <CardDescription>Start with the Read-heavy disk template to see independent CPU and I/O queues.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Open a template from Library. Setup loads its inputs and shows the topology and execution mode.</li>
              <li>Run the simulation to open Lab. Let the run finish, then inspect completions, rejections, and p95.</li>
              <li>Open Datacenter → Playback to step through the recorded run. Open Compare to clone the setup and test one change.</li>
            </ol>
            <Button asChild className="self-start">
              <Link href="/setup?template=disk-read-heavy">Open Read-heavy disk</Link>
            </Button>
          </CardContent>
        </Card>
        <section id="models" className="scroll-mt-20 space-y-3">
          <h2 className="text-xl font-semibold">Simulation models</h2>
          <dl className="space-y-3">
            <div><dt className="font-medium">Single pool</dt><dd>Routes requests to a fleet with per-server capacity. Simple requests hold one slot until they finish. CPU/I/O requests release CPU while the shared dependency is busy.</dd></div>
            <div><dt className="font-medium">Regions</dt><dd>Routes requests from weighted client origins across compute pools using configured RTTs. Choose nearest, least loaded, or a latency-aware load threshold. Pool capacity abstracts the individual servers.</dd></div>
            <div><dt className="font-medium">Sharded service</dt><dd>A coordinator sends required calls to shards in parallel or in sequence. Inspect individual requests for queues, travel, slow replies and deadline or outage failures.</dd></div>
          </dl>
        </section>
        <section id="disk" className="scroll-mt-20 space-y-4">
          <h2 className="text-xl font-semibold">CPU and disk</h2>
          <p>
            In Single pool, choose a staged workload and open I/O capacity and request details. Set the I/O timing model to Shared disk reads and writes. Configure the read percentage, read time, write time and shared slots. The seed assigns operations to arrivals. Reads and writes use one FIFO queue, and each stage completes before the next starts.
          </p>
          <p>
            The I/O share or CPU/I/O mix still determines the CPU portion of the original service demand. A configured disk timing replaces the proportional I/O duration. The model uses fixed service per operation and abstracts device behavior such as caching, request sizes and writeback.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <Screenshot file="disk-setup.png" alt="Setup showing the read percentage, read time, write time and concurrent I/O operation fields"
              caption="Under I/O capacity and request details, choose disk timing, operation mix, and shared capacity." />
            <Screenshot file="disk-results.png" alt="Lab results showing completed read and write counts and a latency breakdown into CPU work, CPU queue, I/O service and I/O queue"
              caption="Use the response-time breakdown to tell disk service apart from waiting for a disk slot." />
          </div>
        </section>
        <section id="live" className="scroll-mt-20 space-y-3">
          <h2 className="text-xl font-semibold">Live controls and outages</h2>
          <ol className="list-decimal space-y-2 pl-5">
            <li>Select Continuous in Setup for Single pool or Regions. Start the session and watch the current totals and recent history.</li>
            <li>Pause to inspect a snapshot. Resume before changing traffic to test how a queue forms or drains.</li>
            <li>In Regions with client migration enabled, set the offered split, take a region offline, and compare client origin, preferred region, and actual route. Restore it and watch the route distribution settle.</li>
            <li>In Simple Single pool, use server availability for seeded outages or the live server control for a manual outage. Check reroutes and rejects alongside utilization. In Sharded service, use the seeded outage control and inspect a failed parent timeline.</li>
          </ol>
          <p>Live p95 covers recent completions. Snapshot history is bounded and the session expires after inactivity. Pause preserves the simulation clock until it resumes.</p>
        </section>
        <section id="compare" className="scroll-mt-20 space-y-3">
          <h2 className="text-xl font-semibold">Compare and export</h2>
          <p>Open Compare from the current configuration. Choose a baseline, clone a variant and change one setting at a time. For the disk example, start from Read-heavy disk and change Disk write time (ms) to 250. Leave the seed and read fraction fixed.</p>
          <p>Read the metric deltas alongside the changed settings. For staged workloads, the workload indicator checks whether the offered arrivals, CPU demand and disk operation sequence match. Download CSV to save the completed cases, metric units, p95 scope and input configurations.</p>
          <p>One-shot Playback inspects a temporary recorded trace. Export results before the server’s retention window closes when you need a durable copy.</p>
        </section>
        <section id="glossary" className="scroll-mt-20 space-y-3">
          <h2 className="text-xl font-semibold">Definitions</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            {definitions.map(([term, definition]) => (
              <div key={term} className="border-t pt-3">
                <dt className="font-medium">{term}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{definition}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section id="troubleshoot" className="scroll-mt-20 space-y-3">
          <h2 className="text-xl font-semibold">Troubleshooting</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li><strong>Engine unavailable.</strong> Start the Python API before the web app for a local run. Check the API health endpoint and the frontend’s API URL.</li>
            <li><strong>Unknown run or session.</strong> Return to Setup and run again. The API keeps recordings and sessions temporarily, and a restart clears them.</li>
            <li><strong>Configuration rejected.</strong> Check the highlighted fields. Shorten the arrival window, reduce offered load or lower total fleet capacity to fit service limits.</li>
            <li><strong>Latency missing.</strong> Latency is available after at least one successful completion. Check rejection and outstanding counts.</li>
            <li><strong>Different numbers on replay.</strong> A live p95 uses a recent window. One-shot Single pool results use all completions, including draining.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
