# A-11: API, engine and browser scale checks

This capture measures the existing API/UI before the separately reviewed pagination follow-up.

Measured locally on an Apple M4 Pro with 48 GiB RAM. This is a single-machine experiment, not a deployment capacity guarantee.

100 servers × 4 slots; 10 waiting places per server; deterministic evenly spaced traffic; uniform 0.1–1.0 s service; round-robin routing. Regional capacity is split 40/30/30 across three pools, with illustrative client RTTs of 2/12/75 ms. The individual-server and regional pooled schedulers are different models; this is not a policy-quality comparison.

One-shot runs offer exactly 100,000 requests: a 100 s arrival window at 1,000/s or 10 s at 10,000/s. Core continuous measurements offer traffic for 100 simulated seconds, then drain. Live API and browser measurements use 1× wall-clock speed before drain.

## Engine-only fresh processes

Three seeds (42/43/44) per case. Timings include the correctness assertions in the harness and exclude JSON transport and browser work; sampled peak process memory includes interpreter/imports. Counts include rejected work.

| Topology | Mode | Requests/s | Median engine wall (s) | Range (s) | Median CPU (s) | Max peak process MiB |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| single_pool | one_shot | 1,000 | 0.761 | 0.750–0.762 | 0.754 | 93.4 |
| single_pool | one_shot | 10,000 | 0.462 | 0.462–0.466 | 0.459 | 76.2 |
| single_pool | continuous | 1,000 | 0.365 | 0.354–0.371 | 0.361 | 37.6 |
| single_pool | continuous | 10,000 | 1.961 | 1.957–2.038 | 1.951 | 37.8 |
| regions | one_shot | 1,000 | 0.342 | 0.338–0.342 | 0.340 | 37.6 |
| regions | one_shot | 10,000 | 0.150 | 0.150–0.154 | 0.150 | 37.6 |
| regions | continuous | 1,000 | 0.272 | 0.270–0.274 | 0.270 | 37.7 |
| regions | continuous | 10,000 | 1.434 | 1.421–1.543 | 1.423 | 38.0 |

## One-shot API transfer

Direct rows use three seeds. Next proxy rows use seed 42 and are checked for exact output equality with the direct response. API latency includes worker startup, computation, serialization and response download. Decoded JSON size and actual downloaded wire bytes are recorded separately; proxy compression is not equivalent to reducing browser parse/state size.

| Topology | Requests/s | Median direct latency (ms) | Proxy latency (ms) | Direct JSON MiB | Proxy wire KiB | Trace events |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| single_pool | 1,000 | 1549.3 | 1521.0 | 7.506 | 7685.8 | 173,692 |
| single_pool | 10,000 | 979.3 | 960.0 | 3.712 | 3795.5 | 108,411 |
| regions | 1,000 | 533.8 | 544.5 | 0.017 | 17.5 | 0 |
| regions | 10,000 | 347.6 | 346.2 | 0.005 | 5.4 | 0 |

## Continuous API and retention

Polling waits 500 ms after each completed HTTP read. Snapshot requests ask for 32 servers and the full capped 240-point history to exercise retention; the actual UI normally requests 120 history samples. OS process sampling adds harness delay between reads; use the browser poll gaps for actual UI cadence. Worker RSS is sampled, not a process high-water mark. CPU is the sampled worker process CPU-time delta, including the final drain; it excludes Next.js/browser CPU.

| Topology | Requests/s | Poll count | p50 / p95 HTTP (ms) | Max lag (s) | Max decoded KiB | History at end | Worker RSS start → end (MiB) | Worker CPU (s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| single_pool | 1,000 | 35 | 7.8 / 9.3 | 0.000 | 11.0 | 38 | 26.4 → 27.7 | 0.32 |
| single_pool | 10,000 | 35 | 8.4 / 10.1 | 0.000 | 11.1 | 38 | 26.6 → 27.9 | 1.08 |
| regions | 1,000 | 35 | 8.8 / 10.2 | 0.000 | 6.6 | 37 | 28.0 → 29.1 | 0.31 |
| regions | 10,000 | 226 | 9.0 / 11.6 | 0.000 | 23.4 | 240 | 26.9 → 28.8 | 5.07 |

The regional 10,000/s soak ran for 129.7 wall seconds. Retained history reached the 240-point cap for 7 sampled snapshots; response values stayed at or below 2,000. Worker RSS during the capped-history segment ranged 28.7–28.8 MiB. This short soak supports bounded-retention behavior, not a proof of leak freedom.

## Browser measurements

Headless Chromium, 1440×1000, production Next.js, one browser case at a time after API/core measurements. Initial-ready latency is click-to-visible-results/control time and includes API/engine work and Playwright synchronization; it is not isolated paint time. Long tasks (>50 ms) and animation-frame gaps are observed on the browser main thread. Browser JSON-read timings include body download plus decoding/parsing. Retained-heap deltas compare forced-GC measurements before and after the window; normal end-of-window heap is also saved. Forced GC is outside the measured responsiveness window.

| Topology | Mode | Requests/s | First ready (ms) | Pause control (ms) | Long tasks / max (ms) | Max frame gap (ms) | Retained heap delta MiB | Max overlapping polls |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| regions | continuous | 1,000 | 122 | 51 | 0 / 0 | 17 | 4.6 | 1 |
| regions | one_shot | 1,000 | 729 | — | 1 / 53 | 33 | 3.8 | 0 |
| regions | continuous | 10,000 | 141 | 66 | 0 / 0 | 17 | 4.6 | 1 |
| regions | one_shot | 10,000 | 513 | — | 0 / 0 | 33 | 3.3 | 0 |
| single_pool | continuous | 1,000 | 157 | 68 | 0 / 0 | 33 | 6.0 | 1 |
| single_pool | one_shot | 1,000 | 1815 | — | 1 / 66 | 83 | 15.0 | 0 |
| single_pool | continuous | 10,000 | 169 | 77 | 0 / 0 | 33 | 6.9 | 1 |
| single_pool | one_shot | 10,000 | 1152 | — | 1 / 55 | 50 | 10.5 | 0 |

## Correctness and limitations

- Every sampled live snapshot checks request conservation, execution/queue capacity, histogram count equality and retention bounds. Pause freezes time; zero-traffic resume drains; single-pool pages enumerate all 100 server IDs; test sessions are deleted.
- The benchmark exposed accumulated regional arrival-clock drift: a nominal 100,000-request / 10,000/s one-shot case offered 100,001 requests. The corrected clock uses integer-indexed arrivals relative to a rate-change anchor; the regression test and corrected measurements require exactly 100,000. The earlier capture is preserved separately as baseline-api-engine.json.
- One-shot single-pool responses still carry their entire event trace and response list. These measurements diagnose that payload cost; bounded one-shot summaries and stable paginated playback remain unfinished A-11 work. Replay/export integration still depends on A-07.
- Offered request rates exceed nominal 400-slot capacity for 0.55 s mean service (about 727 requests/s before regional travel). Rejections are expected simulated overload; they are distinct from an engine falling behind wall clock.
- Global/regional recent p95 windows are not whole-run p95. Completed-request latency excludes rejected work. No routing-policy ranking follows from these cases.
- Steady live traffic is measured at 1× speed; this does not establish 10× catch-up performance at full traffic. API/Next.js parent-process RSS and GPU paint are not measured.
- One machine, three engine/one-shot seeds, one live/browser sample per case and a short soak do not establish production performance, concurrent-user capacity, mobile GPU behavior, network realism or long-term leak freedom.

Raw evidence: api-engine.json, baseline-api-engine.json, browser-*.json and browser screenshots. Source hashes, versions and configurations are embedded in the API/core report. Interactive demo services on 3000/8000 were not restarted for this benchmark.

## Validation

Initial capture: 99 Python tests, eight browser benchmark cases, TypeScript and diff checks pass. All 16 direct/proxy one-shot outcome counts match the corresponding engine sample; all test-owned live workers were cleaned up. See validation.json.
