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
  InputGroup with named increment/decrement buttons. NativeSelect is the shadcn
  native select, preserving browser keyboard behavior.
- Results use shadcn Tabs and Table. Accordion sections contain repeatability,
  saved-run workflows, configuration, exports, and comparison. Errors use Alert;
  the initial state uses Empty. Keep preview visibly labeled as recorded data.
- Charts use shadcn Chart + Recharts. Chart 1 is teal (`oklch(0.49 0.085 210)`);
  chart 2 is orange (`oklch(0.52 0.14 45)`). Labels and tooltips carry meaning
  independently of color. Disable chart entrance animations so results are
  immediately visible. Histogram work is linear in sample count, with at most
  20 rendered bins. Preserve engine p95 and completed-request-only semantics.
- Playback uses Button, RadioGroup, NativeSelect, Slider, Progress, and Badge.
  Execution and waiting remain separate; the task pool covers every server.
  Rack cards paginate at 32 servers. No container implies a physical region.
- API errors retain the previous successful run. Edited settings never rewrite
  the completed run's configuration. Replay, comparison, and exports keep their
  existing explicit unconnected responses until their backend task is done.

Verification: production build and TypeScript, Node API/client suite, browser
suite with live Python Run parity, real UI run and validation recovery,
recorded playback, comparison uploads, and desktop/mobile screenshots.
