"""Render A-11 evidence into a compact Markdown report without changing raw data."""
import json
from pathlib import Path
import statistics

OUT=Path(__file__).resolve().parent/'results/a-11'
d=json.loads((OUT/'api-engine.json').read_text())
lines=['# A-11: API, engine and browser scale checks','',
'The engine/API tables below preserve the initial pre-pagination capture. Browser rows are refreshed by the current harness. See the pagination follow-up for the new API and larger topologies.','',
'Measured locally on an Apple M4 Pro with 48 GiB RAM. This is a single-machine experiment, not a deployment capacity guarantee.','',
'100 servers × 4 slots; 10 waiting places per server; deterministic evenly spaced traffic; uniform 0.1–1.0 s service; round-robin routing. Regional capacity is split 40/30/30 across three pools, with illustrative client RTTs of 2/12/75 ms. The individual-server and regional pooled schedulers are different models; this is not a policy-quality comparison.','',
'One-shot runs offer exactly 100,000 requests: a 100 s arrival window at 1,000/s or 10 s at 10,000/s. Core continuous measurements offer traffic for 100 simulated seconds, then drain. Live API and browser measurements use 1× wall-clock speed before drain.','',
'## Engine-only fresh processes','',
'Three seeds (42/43/44) per case. Timings include the correctness assertions in the harness and exclude JSON transport and browser work; sampled peak process memory includes interpreter/imports. Counts include rejected work.','',
'| Topology | Mode | Requests/s | Median engine wall (s) | Range (s) | Median CPU (s) | Max peak process MiB |','| --- | --- | ---: | ---: | ---: | ---: | ---: |']
for topology in ('single_pool','regions'):
 for mode in ('one_shot','continuous'):
  for rate in (1000,10000):
   r=[r for r in d['engine'] if (r['topology'],r['mode'],r['rate'])==(topology,mode,rate)]
   if not r:continue
   wall=[x['wall_seconds'] for x in r]
   lines.append(f'| {topology} | {mode} | {rate:,} | {statistics.median(wall):.3f} | {min(wall):.3f}–{max(wall):.3f} | {statistics.median(x["cpu_seconds"] for x in r):.3f} | {max(x["peak_process_bytes"] for x in r)/1048576:.1f} |')
lines+=['','## One-shot API transfer','',
'Direct rows use three seeds. Next proxy rows use seed 42 and are checked for exact output equality with the direct response. API latency includes worker startup, computation, serialization and response download. Decoded JSON size and actual downloaded wire bytes are recorded separately; proxy compression is not equivalent to reducing browser parse/state size.','',
'| Topology | Requests/s | Median direct latency (ms) | Proxy latency (ms) | Direct JSON MiB | Proxy wire KiB | Trace events |',
'| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
for topology in ('single_pool','regions'):
 for rate in (1000,10000):
  rows=[r for r in d['one_shot_api'] if r['topology']==topology and r['rate']==rate]
  direct=[r for r in rows if r['transport']=='direct'];proxy=next((r for r in rows if r['transport']=='next_proxy'),None)
  if not direct or not proxy:continue
  lines.append(f'| {topology} | {rate:,} | {statistics.median(r["sample"]["latency_ms"] for r in direct):.1f} | {proxy["sample"]["latency_ms"]:.1f} | {statistics.median(r["sample"]["decoded_bytes"] for r in direct)/1048576:.3f} | {proxy["sample"]["wire_bytes"]/1024:.1f} | {proxy["trace_events"]:,} |')
lines+=['','## Continuous API and retention','',
'Polling waits 500 ms after each completed HTTP read. Snapshot requests ask for 32 servers and the full capped 240-point history to exercise retention; the actual UI normally requests 120 history samples. OS process sampling adds harness delay between reads; use the browser poll gaps for actual UI cadence. Worker RSS is sampled, not a process high-water mark. CPU is the sampled worker process CPU-time delta, including the final drain; it excludes Next.js/browser CPU.','',
'| Topology | Requests/s | Poll count | p50 / p95 HTTP (ms) | Max lag (s) | Max decoded KiB | History at end | Worker RSS start → end (MiB) | Worker CPU (s) |',
'| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
for r in d['live_api']:
 samples=r['samples'];last=samples[-1]
 lines.append(f'| {r["topology"]} | {r["rate"]:,} | {len(samples)} | {r["poll_ms"]["median"]:.1f} / {r["poll_ms"]["p95"]:.1f} | {r["lag_seconds"]["max"]:.3f} | {r["decoded_bytes"]["max"]/1024:.1f} | {last["retention"]["history_points"]} | {r["initial_worker"]["rss_bytes"]/1048576:.1f} → {r["final_worker"]["rss_bytes"]/1048576:.1f} | {r["sampled_worker_cpu_seconds"]:.2f} |')
long=next((r for r in d['live_api'] if r['topology']=='regions' and r['rate']==10000),None)
if long:
 plateau=[s for s in long['samples'] if s['retention']['history_points']==240]
 if plateau:lines+=['',f'The regional 10,000/s soak ran for {long["samples"][-1]["wall_seconds"]:.1f} wall seconds. Retained history reached the 240-point cap for {len(plateau)} sampled snapshots; response values stayed at or below 2,000. Worker RSS during the capped-history segment ranged {min(s["worker"]["rss_bytes"] for s in plateau)/1048576:.1f}–{max(s["worker"]["rss_bytes"] for s in plateau)/1048576:.1f} MiB. This short soak supports bounded-retention behavior, not a proof of leak freedom.']
files=sorted(OUT.glob('browser-*.json'))
if files:
 lines+=['','## Browser measurements','',
'Headless Chromium, 1440×1000, production Next.js, one browser case at a time after API/core measurements. Initial-ready latency is click-to-visible-results/control time and includes API/engine work and Playwright synchronization; it is not isolated paint time. Long tasks (>50 ms) and animation-frame gaps are observed on the browser main thread. Browser JSON-read timings include body download plus decoding/parsing. Retained-heap deltas compare forced-GC measurements before and after the window; normal end-of-window heap is also saved. Forced GC is outside the measured responsiveness window.','',
'| Topology | Mode | Requests/s | First ready (ms) | Pause control (ms) | Long tasks / max (ms) | Max frame gap (ms) | Retained heap delta MiB | Max overlapping polls |',
'| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
 for p in files:
  r=json.loads(p.read_text());lt=r['rendering']['long_tasks'];pause=r.get('pause_control_ms')
  pause_label = f'{pause:.0f}' if pause is not None else '—'
  lines.append(f'| {r["topology"]} | {r["mode"]} | {r["rate"]:,} | {r["first_ready_ms"]:.0f} | {pause_label} | {len(lt)} / {max(lt,default=0):.0f} | {r["rendering"]["frame_gap_max_ms"]:.0f} | {r["retained_heap_delta_bytes"]/1048576:.1f} | {r["max_simultaneous_polls"]} |')

lines+=['','## Correctness and limitations','',
'- Every sampled live snapshot checks request conservation, execution/queue capacity, histogram count equality and retention bounds. Pause freezes time; zero-traffic resume drains; single-pool pages enumerate all 100 server IDs; test sessions are deleted.','- The benchmark exposed accumulated regional arrival-clock drift: a nominal 100,000-request / 10,000/s one-shot case offered 100,001 requests. The corrected clock uses integer-indexed arrivals relative to a rate-change anchor; the regression test and corrected measurements require exactly 100,000. The earlier capture is preserved separately as baseline-api-engine.json.','- One-shot single-pool responses still carry their entire event trace and response list. These measurements diagnose that payload cost; bounded one-shot summaries and stable paginated playback remain unfinished A-11 work. Replay/export integration still depends on A-07.','- Offered request rates exceed nominal 400-slot capacity for 0.55 s mean service (about 727 requests/s before regional travel). Rejections are expected simulated overload; they are distinct from an engine falling behind wall clock.','- Global/regional recent p95 windows are not whole-run p95. Completed-request latency excludes rejected work. No routing-policy ranking follows from these cases.','- Steady live traffic is measured at 1× speed; this does not establish 10× catch-up performance at full traffic. API/Next.js parent-process RSS and GPU paint are not measured.',
'- One machine, three engine/one-shot seeds, one live/browser sample per case and a short soak do not establish production performance, concurrent-user capacity, mobile GPU behavior, network realism or long-term leak freedom.','',
'Raw evidence: api-engine.json, baseline-api-engine.json, browser-*.json and browser screenshots. Source hashes, versions and configurations are embedded in the API/core report. Interactive demo services on 3000/8000 were not restarted for this benchmark.','']
lines += ['## Validation', '', 'Initial capture: 99 Python tests, eight browser benchmark cases, TypeScript and diff checks pass. All 16 direct/proxy one-shot outcome counts match the corresponding engine sample; all test-owned live workers were cleaned up. See validation.json.', '']

# Append current bounded-transfer/large-topology measurements without replacing
# the preserved pre-pagination API evidence above.
pagination=OUT/'pagination-scale.json'
if pagination.exists():
 q=json.loads(pagination.read_text())
 lines+=['## Pagination and larger topology follow-up','','The frontend now requests compact recorded results; legacy `/v1/run` remains available. Every event page was compared against the original full trace in stable sequence order, and start/middle/end snapshots preserve conservation. One-shot traces are temporary disk-backed records with count/byte/TTL quotas, not browser-held arrays.','',
 '| Servers | Offered/s | Legacy JSON bytes | Bounded JSON bytes | Reduction | Event pages | Largest page bytes |','| ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
 for r in q['one_shot']:
  old,new=r['legacy']['decoded_bytes'],r['bounded']['decoded_bytes']
  lines.append(f'| {r["config"]["server_count"]:,} | {r["config"]["arrival_rate"]:,} | {old:,} | {new:,} | {100*(1-new/old):.2f}% | {r["pages"]} | {r["largest_page_bytes"]:,} |')
 lines+=['','The regional tests cover 12 datacenters / 1,000 servers / 4,000 slots, mixed compute and client RTTs from 2 to 450 ms. Both offered rates (10,000 and 100,000/s) generate exactly 100,000 requests and fully drain. 1,001 servers and 13 regions are rejected with validation errors; configured limits were not raised.','',
 '| Topology (1,000 servers) | Offered/s | Max reported lag in 8-second probe (s) | Pause HTTP (ms) |','| --- | ---: | ---: | ---: |']
 for r in q['live']:
  lines.append(f'| {r["topology"]} | {r["rate"]:,} | {max(x["lag"] for x in r["samples"]):.3f} | {r["pause_ms"]:.1f} |')
 lines+=['','Raising the event ceiling from 2,000 to 20,000 per tick removes an avoidable batch throttle; the 10 ms per-tick CPU budget remains. The 100,000/s live probes still fall behind and must **not** be described as sustained real time. Pause stays responsive, and zero-traffic drain conserves all actually offered work. Commands take effect at processed simulated time and reset catch-up debt, as before. The pre-tuning live evidence is in pagination-before-batch.json; its exploratory one-shot timing overlapped a build and is not used for performance conclusions.','']
 large_single=OUT/'large-browser-single.json';large_regions=OUT/'large-browser-regions.json'
 if large_single.exists() and large_regions.exists():
  a=json.loads(large_single.read_text());b=json.loads(large_regions.read_text())
  lines += [f'The browser renders the 1,000-server case from a {a["decoded_summary_bytes"]:,}-byte summary. Cached-result-to-visible-results was {a["cached_response_to_results_ms"]:.0f} ms and seek-to-end was {a["seek_to_end_ms"]:.0f} ms in this headless sample; playback shows only 32 servers at a time and reaches server 999 through paging. The 12-datacenter preset renders all latency cards; pause-to-visible-paused control took {b["pause_control_ms"]:.0f} ms. These are local single samples, not GPU paint or mobile guarantees.','']
 lines += ['The frontend histogram uses at most 20 Python-supplied bins, and playback reads state snapshots rather than collecting all pages in JavaScript. The slider reaches the exact final completion despite fractional-step rounding. Deleted/expired recording errors retain summary metrics and stop retrying.','']
lines += ['## Pagination validation', '', '103 Python tests, 17 Node API/client tests, 26 browser regressions and ten browser performance cases pass. Production build, TypeScript and diff checks pass. See pagination-validation.json. The worker-expiry regression permits bounded 429 retries while a previously expired worker is still being reaped; admission limits were not loosened.', '']
(OUT/'analysis.md').write_text('\n'.join(lines))
print(OUT/'analysis.md')
