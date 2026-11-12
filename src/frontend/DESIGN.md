# Simulator UI conventions

This is an operating interface for configuring seeded simulations and inspecting
Python results. Keep the neutral surfaces and compact
controls consistent across setup, results, saved-run workflows, and playback.

- Use shadcn/ui components from `components/ui/`. Application components compose
  them; native semantic elements remain appropriate for headings, layout, and
  descriptive text. Do not introduce another UI kit.
- Theme source: `app/globals.css`. Shared neutral tokens cover foreground,
  background, primary, borders, input, focus, secondary, muted, and destructive
  states. The palette follows the system through `prefers-color-scheme`.
  Source Sans is self-hosted. Data uses tabular numerals.
- The shared `components/app-header.tsx` composes shadcn controls into a 64px sticky header. Library, Setup, Lab and Compare use text links in the desktop header and a fixed bottom bar with labeled icons on mobile. There is no settings sidebar or opener.
- Setup lives at `/setup`: three Card sections for Infrastructure, Traffic and routing, and Execution, with a sticky summary/run action on desktop and a linear form on mobile. Templates prefill editable settings without a preset/custom mode. Secondary I/O fields use a focused Accordion.
- Forms use Field, FieldGroup, FieldSet, and FieldLegend. Numeric controls use
  InputGroup with named increment/decrement buttons. Select uses the shared Radix popup with keyboard navigation.
- Results use shadcn Tabs and Table. Accordion sections contain repeatability,
  saved-run workflows, configuration, exports, and comparison. Errors use Alert;
  the initial state uses Empty. Keep preview visibly labeled as recorded data.
- Charts use shadcn Chart + Recharts. Chart 1 is teal (`oklch(0.49 0.085 210)`);
  chart 2 is orange (`oklch(0.52 0.14 45)`). Labels and tooltips carry meaning
  independently of color. Disable chart entrance animations so results are
  immediately visible. Histogram work is linear in sample count, with at most
  20 rendered bins. Preserve engine p95 and completed-request-only semantics.
- Playback uses Button, RadioGroup, Select, Slider, Progress, and Badge.
  Execution and waiting remain separate; the task pool covers every server.
  Rack cards paginate at 32 servers. No container implies a physical region.
- API errors retain the previous successful run. Edited settings never rewrite
  the completed run's configuration. Replay, comparison, and exports keep their
  existing explicit unconnected responses until their backend task is done.

Verification: production build and TypeScript, Node API/client suite, browser
suite with live Python Run parity, real UI run and validation recovery,
recorded playback, comparison uploads, and desktop/mobile screenshots.

## Datacenter components

`components/datacenter/` separates rack composition (`rack-view.tsx`), server
blades and capacity cells (`server-node.tsx`), the global request pool
(`task-pool.tsx`), and the inspection Sheet (`server-inspector.tsx`). The parent
`datacenter.tsx` owns playback and passes snapshots; visual components do not
run simulations or change routing.

A rack contains up to eight server blades; a page renders at most 32 servers.
Execution and waiting have separate strips, exact counts, and at most 16 cells
per strip. Larger capacities group places into cells, with fractional fill for
a partially occupied group. Empty queue capacity says "No waiting queue".
Teal denotes executing work, orange waiting, green completed, and destructive
red rejected/full queues. Badge variants share these semantic tokens with the
visuals. Status labels distinguish idle, executing, busy, queued, and queue full;
run-average mode does not present these as current server status.

Selecting a server pauses playback and opens a Sheet showing the recorded
snapshot, capacities, processing-rate multiplier, and run-average utilization.
Closing restores focus to the selected server. Task-pool counts always cover
all servers, including those outside the current page. Its segmented bar counts
all generated requests, including those that have not yet arrived. These views
model neither physical network layout nor actual hardware telemetry.

## Setup library

The root route is a searchable grid of saved configurations and starter
templates. Use the same shadcn Card composition for both; saved items precede
templates and show their update date, while templates show a purpose statement.
Facts include server count, slots per server, arrival rate, window and policy.
Three columns on desktop collapse to two and then one on narrow screens.
Tabs expose All/Saved/Templates panels; search and counts remain visible.

Templates and saves open `/setup`. Its header offers Save setup via a shadcn
Dialog; existing saves offer Save changes and Save a copy. The brand links back
to the library. Delete uses AlertDialog and leaves templates intact. Keep the
browser-local persistence boundary explicit: saves contain configuration and
seed, and do not include results or start a run automatically. Preserve unknown
or malformed stored data and show an Alert rather than silently resetting it.

## Lab navigation and comparison

Header navigation names Library, Setup, Lab and Compare. A successful run opens
`/simulator`; errors stay on Setup. Lab offers Edit configuration and Compare
this run, with results, playback and active live controls. Setup edits are a draft
and never reconfigure or stop an active worker. Explicit replacement of a live
session stops the old worker before starting the replacement.

A shared route-group layout keeps the workspace mounted across Setup, Lab and
Compare. Retain completed results separately from the editable draft and active
session configuration. Focus the page heading on Setup/Lab navigation and reset
scroll to the top. Session storage retains valid drafts across reloads; live IDs
reconnect separately. Old template/save Lab links resolve to Setup.

The comparison route separates a named baseline from up to three editable
variants. The same NumberField and shadcn fields/controls carry all settings.
Show changed fields explicitly and preserve the seed by default. Results always
use their own frozen configurations and labels, with signed deltas, percentage
points for rates, and N/A for undefined metrics. Outcome and latency charts have
legends. Changing workload/capacity is visibly distinguished from comparing
routing policies under otherwise identical inputs. Keep previous complete
results visible if a later case fails; never present a partial set as complete.

## Control consistency

Use shadcn Select with SelectTrigger, SelectValue, SelectContent, SelectGroup and
SelectItem for lab policy, comparison policy/baseline, playback speed and server
pagination. Group baseline choices with SelectLabel. Page navigation uses
shadcn buttons rendered as links, with the current page marked by aria-current.
Keep browser-specific dropdown presentation out of app controls. NumberField composes InputGroupInput and InputGroupButton; suppress
native number spinners so there is one consistent pair of stepper controls.
Playback controls use full Card composition. Native semantic page structure and
the bounded data-visualization graphics remain separate from control primitives.

## Continuous sessions

Topology and Execution are separate Select controls. Single pool and Regions each
support one-shot and continuous execution. Keep regional pool policies distinct
from individual-server policies; label pooled capacity, immediate load reports
and illustrative client RTTs. Regional cards show executing, queued and transit
work separately. Hide
the arrival window in continuous mode. Live controls affect the active session,
while Setup edits are a draft for the next start. Show the active pool size
and configuration separately. Label recent p95/windowed histograms and lifetime
means distinctly. Reuse rack/server inspection graphics, with live timestamps
and session utilization labels; continuous task pools have no finite future
request total. Show lag, connection/expiry state and retained-snapshot status.
Use bounded sequential polling, cancellation and revision checks. Preserve
user-editing state across updates and provide feedback inside mobile settings.


## Focused comparison editing

Compare captures the current Lab draft or active-session configuration as a fixed baseline. Clones begin identical; users select individual settings to override instead of editing a full repeated form. Keep baseline values beside each chosen field, list exact before/after values, and support cloning either the baseline or a variant. Reset removes an override without mutating the source. The comparison window is shared unless explicitly overridden. Header navigation from Lab also carries its draft. Single-pool and regional comparisons use bounded fresh Python runs; they never clone or mutate a live worker. Regional p95 must retain its recent-window label and sample counts; omit unavailable regional average utilization.

## CPU/I/O in the main Lab

Request model is independent of one-shot/continuous execution for single pools.
Use the shared RequestModelFields component in Lab and configuration editors.
Staged requests expose I/O fraction and an outstanding admission cap; hide the
legacy waiting-place setting in this mode. Templates launch the main Lab with
model settings and optional continuous mode; browser saves keep these settings.

Reuse rack/server components for both models. For CPU/I/O, label execution as
CPU activity, queueing as CPU-ready work, and show separate I/O-waiting and
outstanding counts/caps in nodes, inspectors and task pool. CPU-idle with I/O
wait is not server-idle. Continuous history adds the I/O series; snapshot
conservation includes it. Preserve bounded recorded state paging and live polling.

## Setup and resource details

Use LabControls on the dedicated Setup page. Keep the three setup sections and
summary consistent on desktop and mobile. RequestModelFields combines model and
profile selection. Do not add a custom-mode selector: edits apply directly to
the draft. Library is the entry point for picking templates. Live controls stay
in Lab, with speed and restart under Session options.

Separate CPU activity, shared I/O in service, I/O queue and admission pressure.
Use the latency breakdown to explain completed-request response time; keep
rejection and unfinished work visible alongside latency.
