# Simulator UI conventions

This is an operating interface for configuring seeded simulations and inspecting
Python results. Keep the white canvas, quiet neutral surfaces, and compact
controls consistent across setup, results, saved-run workflows, and playback.

- Use shadcn/ui components from `components/ui/`. Application components compose
  them; native semantic elements remain appropriate for headings, layout, and
  descriptive text. Do not introduce another UI kit.
- Theme source: `app/globals.css`. Shared neutral tokens cover foreground,
  background, primary, borders, input, focus, secondary, muted, and destructive
  states. Source Sans is self-hosted. Data uses tabular numerals.
- The shared `components/app-header.tsx` composes shadcn controls into a 64px sticky header. The setup trigger sits at the far left; the desktop sidebar starts below the header. Body scrolling must keep the header visible on desktop and mobile.
- Setup stays in a 320px desktop column. Hide/show setup works on every size;
  narrow screens use the Sidebar's mobile Sheet, with focus containment, Escape dismissal, and an overlay. SidebarProvider owns panel state and responsive behavior; keep configuration state in the page so closing the panel preserves settings.
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

The root route is a searchable grid of saved configurations and six starter
templates. Use the same shadcn Card composition for both; saved items precede
templates and show their update date, while templates show a purpose statement.
Facts include server count, slots per server, arrival rate, window and policy.
Three columns on desktop collapse to two and then one on narrow screens.
Tabs expose All/Saved/Templates panels; search and counts remain visible.

The simulator lives at `/simulator`. Its header offers Save setup via a shadcn
Dialog; existing saves offer Save changes and Save a copy. The brand links back
to the library. Delete uses AlertDialog and leaves templates intact. Keep the
browser-local persistence boundary explicit: saves contain configuration and
seed, and do not include results or start a run automatically. Preserve unknown
or malformed stored data and show an Alert rather than silently resetting it.

## Lab navigation and comparison

Header navigation names Library, Lab, and Compare. Use text links on desktop and
DropdownMenu on mobile; keep the sidebar opener at the far left without a
separator. Opening templates/saves opens settings once; users can then close
them normally. Successful runs reveal results on mobile; errors appear in the
settings Sheet while it is open.

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
pagination. Group baseline choices with SelectLabel. Header page navigation
uses DropdownMenu. Keep browser-specific dropdown presentation out of app
controls. NumberField composes InputGroupInput and InputGroupButton; suppress
native number spinners so there is one consistent pair of stepper controls.
Playback controls use full Card composition. Native semantic page structure and
the bounded data-visualization graphics remain separate from control primitives.
