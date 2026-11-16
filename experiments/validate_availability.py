"""Server availability: check simulated outages against the theory behind them.

Each server alternates up and down periods drawn from exponential distributions
with means MTBF and MTTR, where availability A = MTBF / (MTBF + MTTR). Theory
(alternating renewal processes, the law of large numbers and the central limit
theorem) predicts:

1. Measured availability converges to A, with spread A(1 - A) * sqrt(2 / n)
   after n up/down cycles.
2. Up and down periods are exponential: mean = MTBF / MTTR, standard
   deviation = mean, and the empirical distribution matches 1 - e^(-t/mean).
3. With independent servers, all of them are down at once a fraction
   (1 - A1)(1 - A2)... of the time, so that share of evenly spaced arrivals
   finds no server up.
4. A server fails about T / (MTBF + MTTR) times in a window of T seconds.
5. Trends: lower availability means more rejections; at fixed availability a
   longer MTTR means fewer, longer outages with the same downtime; more servers
   means fewer "every server was down" rejections.
6. Continuous sessions see exactly the same outages as one-shot runs with the
   same seed.

A mean check passes when theory lies within 4 standard errors of the measured
mean (95% intervals are reported). Exits with status 1 if any check fails.
"""

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import platform
import statistics
import time

from lbsim.availability import mean_time_between_failures, outage_schedule
from lbsim.continuous import ContinuousSimulation
from lbsim.settings import validate_config
from lbsim.simulation import run_simulation

ROOT = Path(__file__).resolve().parents[1]
SEEDS = range(50)
TOLERANCE_SE = 4  # standard errors allowed between theory and measurement
Z95 = 1.96

# Light load (about 30% busy): rejections come from outages, not full queues.
POOL = dict(concurrency=2, queue_limit=10, arrival_rate=10.0, duration=600.0,
            service_min=.01, service_max=.05, policy="round_robin")


# ---------------------------------------------------------------- statistics
def summary(values):
    """Mean, standard error and 95% half-width of a list of numbers."""
    mean = statistics.fmean(values)
    se = statistics.stdev(values) / math.sqrt(len(values)) if len(values) > 1 else 0.0
    return dict(mean=mean, se=se, ci95=Z95 * se, n=len(values))


def mean_check(name, expected, values, unit=""):
    s = summary(values)
    passed = abs(s["mean"] - expected) <= TOLERANCE_SE * s["se"] + 1e-12
    return dict(name=name, expected=expected, measured=s["mean"], ci95=s["ci95"],
                se=s["se"], samples=s["n"], unit=unit, passed=passed)


def downtime(intervals, duration):
    return sum(min(end, duration) - start for start, end in intervals if start < duration)


def all_down_time(outages, server_count, duration):
    """Seconds in [0, duration] when every server was down (sweep over intervals)."""
    if len(outages) < server_count or any(not outages[sid] for sid in range(server_count)):
        return 0.0
    changes = sorted((t, delta) for sid in range(server_count)
                     for start, end in outages[sid] if start < duration
                     for t, delta in ((start, 1), (min(end, duration), -1)))
    down = total = previous = 0.0
    for t, delta in changes:
        if down == server_count:
            total += t - previous
        down += delta
        previous = t
    return total


def ks_statistic(values, mean):
    """Kolmogorov-Smirnov distance between the data and an exponential CDF."""
    ordered = sorted(values)
    n = len(ordered)
    return max(max((i + 1) / n - (1 - math.exp(-x / mean)),
                   (1 - math.exp(-x / mean)) - i / n)
               for i, x in enumerate(ordered))


# --------------------------------------------------------------------- checks
def check_convergence():
    """1. Measured availability converges to A; spread shrinks like 1/sqrt(n)."""
    checks = []
    for availability in (.5, .8, .95):
        duration = 20_000.0
        values = [1 - downtime(outage_schedule([availability], 1.0, duration, seed)[0], duration)
                  / duration for seed in SEEDS]
        checks.append(mean_check(f"Availability {availability} (20,000 s window)",
                                 availability, values))
    availability, mttr = .9, 2.0
    cycle = mean_time_between_failures(availability, mttr) + mttr
    rows = []
    for duration in (60.0, 600.0, 6_000.0, 60_000.0):
        values = [1 - downtime(outage_schedule([availability], mttr, duration, seed)[0], duration)
                  / duration for seed in range(200)]
        cycles = duration / cycle
        theory = availability * (1 - availability) * math.sqrt(2 / cycles)
        spread = statistics.stdev(values)
        rows.append(dict(window=duration, cycles=cycles, mean=statistics.fmean(values),
                         spread=spread, theory_spread=theory))
        if cycles >= 30:  # the CLT approximation needs enough cycles
            checks.append(dict(
                name=f"Spread after {cycles:,.0f} cycles = A(1-A)sqrt(2/n)",
                expected=theory, measured=spread, ci95=None, samples=200, unit="",
                passed=0.8 <= spread / theory <= 1.25))
    return checks, rows


def check_periods():
    """2. Up/down periods are exponential with means MTBF / MTTR."""
    availability, mttr, duration = .9, 2.0, 200_000.0
    mtbf = mean_time_between_failures(availability, mttr)
    ups, downs = [], []
    for seed in range(5):
        previous_end = 0.0
        for start, end in outage_schedule([availability], mttr, duration, seed)[0]:
            ups.append(start - previous_end)
            downs.append(end - start)
            previous_end = end
    checks = []
    for label, values, mean in (("Up", ups, mtbf), ("Down", downs, mttr)):
        checks.append(mean_check(f"{label} period mean", mean, values, "s"))
        cv = statistics.stdev(values) / statistics.fmean(values)
        checks.append(dict(name=f"{label} period std / mean (exponential: 1)", expected=1.0,
                           measured=cv, ci95=None, samples=len(values), unit="",
                           passed=abs(cv - 1) < 0.05))
        d = ks_statistic(values, mean)
        critical = 1.63 / math.sqrt(len(values))  # 1% significance
        checks.append(dict(name=f"{label} periods fit an exponential "
                                "(KS distance; theory column = 1% critical value)",
                           expected=critical, measured=d, ci95=None, samples=len(values),
                           unit="", passed=d < critical, note="passes below the 1% critical value"))
    return checks, dict(up=ups, down=downs, mtbf=mtbf, mttr=mttr)


def run_pool(availabilities, mttr, seed):
    config = {**POOL, "server_count": len(availabilities), "seed": seed,
              "availabilities": list(availabilities), "mean_repair_time": mttr}
    return run_simulation(config)


def check_all_down():
    """3. Every server down at once a fraction prod(1 - A) of the time."""
    checks, headline = [], None
    for availabilities in ((.4, .4), (.5, .6, .7)):
        expected = math.prod(1 - a for a in availabilities)
        time_share, arrival_share = [], []
        for seed in SEEDS:
            summary_ = run_pool(availabilities, 1.0, seed)
            outages = {int(k): v for k, v in summary_["outages"].items()}
            time_share.append(all_down_time(outages, len(availabilities), POOL["duration"])
                              / POOL["duration"])
            offered = summary_["completed_count"] + summary_["rejected_count"]
            arrival_share.append(summary_["rejected_breakdown"]["no_server_up"] / offered)
        label = ", ".join(str(a) for a in availabilities)
        checks.append(mean_check(f"Time with every server down (A = {label})",
                                 expected, time_share))
        arrival = mean_check(f"Arrivals finding no server up (A = {label})",
                             expected, arrival_share)
        checks.append(arrival)
        if headline is None:
            headline = arrival
    return checks, headline


def check_outage_counts():
    """4. About T / (MTBF + MTTR) failures per server in T seconds."""
    checks = []
    for availability, mttr in ((.9, 2.0), (.5, 1.0)):
        duration = 6_000.0
        expected = duration / (mean_time_between_failures(availability, mttr) + mttr)
        counts = [len(outage_schedule([availability], mttr, duration, seed)[0]) for seed in SEEDS]
        checks.append(mean_check(f"Failures in 6,000 s (A = {availability}, MTTR = {mttr} s)",
                                 expected, counts))
    return checks


def check_trends():
    """5. Directions that must hold on average across seeds."""
    seeds = range(20)
    checks = []
    levels = (.95, .8, .6, .4)
    rejection = [statistics.fmean(
        (s := run_pool((a, a, a), 1.0, seed))["rejected_count"]
        / (s["completed_count"] + s["rejected_count"]) for seed in seeds) for a in levels]
    checks.append(dict(name="Lower availability -> more rejections "
                            f"(A = {', '.join(map(str, levels))})",
                       expected=None, measured=rejection, ci95=None, samples=len(seeds),
                       unit="", passed=all(x < y for x, y in zip(rejection, rejection[1:]))))
    duration = 6_000.0
    counts, shares = [], []
    for mttr in (.5, 2.0, 8.0):
        schedules = [outage_schedule([.8], mttr, duration, seed)[0] for seed in seeds]
        counts.append(statistics.fmean(len(s) for s in schedules))
        shares.append([downtime(s, duration) / duration for s in schedules])
    checks.append(dict(name="Same availability, longer MTTR -> fewer outages "
                            "(MTTR = 0.5, 2, 8 s)",
                       expected=None, measured=counts, ci95=None, samples=len(seeds),
                       unit="", passed=all(x > y for x, y in zip(counts, counts[1:]))))
    for mttr, share in zip((.5, 2.0, 8.0), shares):
        checks.append(mean_check(f"... but the same downtime (MTTR = {mttr} s)", .2, share))
    no_server = []
    for servers in (1, 2, 3, 4):
        values = [run_pool((.6,) * servers, 1.0, seed)["rejected_breakdown"]["no_server_up"]
                  / (POOL["arrival_rate"] * POOL["duration"]) for seed in seeds]
        no_server.append(values)
        checks.append(mean_check(f"{servers} server(s) at A = 0.6: arrivals finding none up "
                                 f"(theory 0.4^{servers})", .4 ** servers, values))
    means = [statistics.fmean(v) for v in no_server]
    checks.append(dict(name="More servers -> fewer 'every server was down' rejections",
                       expected=None, measured=means, ci95=None, samples=len(seeds), unit="",
                       passed=all(x > y for x, y in zip(means, means[1:]))))
    return checks


def check_continuous():
    """6. Continuous sessions match one-shot runs with the same seed exactly."""
    availabilities, mttr, duration = (.5, .7, .9), 1.0, 300.0
    mismatches = 0
    for seed in range(10):
        values = {**POOL, "duration": duration, "server_count": len(availabilities),
                  "seed": seed, "availabilities": list(availabilities),
                  "mean_repair_time": mttr}
        one_shot = run_simulation(values)
        config = validate_config(values)
        config.pop("duration")
        engine = ContinuousSimulation(config)
        # One-shot arrivals are at i / rate for i < rate * duration.
        while not engine.advance(duration - 1e-9, max_events=100_000):
            pass
        window = {int(k): v for k, v in one_shot["outages"].items()}
        same_outages = all(engine.outage_count[sid] == len(window[sid])
                           for sid in range(len(availabilities)))
        # Arrivals that found every server down depend only on the outages.
        same_rejections = (engine.no_server_up
                           == one_shot["rejected_breakdown"]["no_server_up"])
        mismatches += not (same_outages and same_rejections)
    return [dict(name="Continuous = one-shot: same outages and 'no server up' rejections "
                      "(10 seeds, 300 s)", expected=0, measured=mismatches, ci95=None,
                 samples=10, unit="mismatched seeds", passed=mismatches == 0)]


# ------------------------------------------------------------------- outputs
def histogram_svg(values, mean, title, path):
    """Density histogram of periods with the exponential curve e^(-t/m)/m on top."""
    bins, high = 32, 4 * mean
    width = high / bins
    counts = [0] * bins
    for v in values:
        if v < high:
            counts[int(v / width)] += 1
    density = [c / (len(values) * width) for c in counts]
    w, h, left, right, top, bottom = 640, 360, 56, 20, 40, 48
    plot_w, plot_h = w - left - right, h - top - bottom
    y_max = max(max(density), 1 / mean) * 1.1
    x = lambda t: left + t / high * plot_w
    y = lambda d: top + plot_h - d / y_max * plot_h
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
             f'font-family="system-ui, sans-serif" font-size="12">',
             f'<rect width="{w}" height="{h}" fill="#ffffff"/>',
             f'<text x="{left}" y="24" font-size="15" font-weight="600" fill="#1f2937">'
             f'{title}</text>']
    for i, d in enumerate(density):
        parts.append(f'<rect x="{x(i * width) + 1:.1f}" y="{y(d):.1f}" '
                     f'width="{plot_w / bins - 2:.1f}" height="{top + plot_h - y(d):.1f}" '
                     f'fill="#0f766e" opacity="0.75"/>')
    curve = " ".join(f"{x(t):.1f},{y(math.exp(-t / mean) / mean):.1f}"
                     for t in (high * i / 200 for i in range(201)))
    parts.append(f'<polyline points="{curve}" fill="none" stroke="#c2410c" stroke-width="2.5"/>')
    parts.append(f'<line x1="{left}" y1="{top + plot_h}" x2="{left + plot_w}" '
                 f'y2="{top + plot_h}" stroke="#6b7280"/>')
    parts.append(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_h}" stroke="#6b7280"/>')
    for i in range(5):
        t = high * i / 4
        parts.append(f'<text x="{x(t):.1f}" y="{top + plot_h + 18}" text-anchor="middle" '
                     f'fill="#4b5563">{t:g} s</text>')
    parts.append(f'<text x="{left + plot_w / 2}" y="{h - 8}" text-anchor="middle" '
                 f'fill="#4b5563">Period length</text>')
    parts.append(f'<text x="14" y="{top + plot_h / 2}" text-anchor="middle" fill="#4b5563" '
                 f'transform="rotate(-90 14 {top + plot_h / 2})">Density</text>')
    lx = left + plot_w - 230
    parts.append(f'<rect x="{lx}" y="{top + 4}" width="12" height="12" fill="#0f766e" '
                 f'opacity="0.75"/><text x="{lx + 18}" y="{top + 14}" fill="#1f2937">'
                 f'Simulated ({len(values):,} periods)</text>')
    parts.append(f'<line x1="{lx}" y1="{top + 30}" x2="{lx + 12}" y2="{top + 30}" '
                 f'stroke="#c2410c" stroke-width="2.5"/><text x="{lx + 18}" y="{top + 34}" '
                 f'fill="#1f2937">Exponential, mean {mean:g} s</text>')
    parts.append("</svg>")
    path.write_text("\n".join(parts), encoding="utf-8")


def fmt(value):
    if value is None:
        return "—"
    if isinstance(value, list):
        return ", ".join(fmt(v) for v in value)
    if isinstance(value, float):
        return f"{value:.4g}"
    return str(value)


def write_report(output, sections, convergence_rows, headline, elapsed):
    checks = [c for _, cs in sections for c in cs]
    passed = sum(c["passed"] for c in checks)
    lines = [
        "# Availability validation",
        "",
        f"**{passed} of {len(checks)} checks passed** "
        f"({len(SEEDS)} seeds per mean check unless noted; {elapsed:.0f} s).",
        "",
        f"> Theory says {headline['expected']:.0%} of requests should find every server "
        f"down (two servers at 40% availability); the simulation measured "
        f"{headline['measured']:.1%} ± {headline['ci95']:.1%} (95% interval) over "
        f"{headline['samples']} seeds.",
        "",
        "A mean check passes when theory lies within "
        f"{TOLERANCE_SE} standard errors of the measured mean; ± values are 95% intervals.",
        "",
    ]
    for title, cs in sections:
        lines += [f"## {title}", "", "| Check | Theory | Measured | Result |",
                  "| --- | --- | --- | --- |"]
        for c in cs:
            measured = fmt(c["measured"])
            if c.get("ci95") is not None:
                measured += f" ± {c['ci95']:.2g}"
            lines.append(f"| {c['name']} | {fmt(c['expected'])} | {measured} | "
                         f"{'PASS' if c['passed'] else '**FAIL**'} |")
        lines.append("")
        if title.startswith("1."):
            lines += ["Availability 0.9, MTTR 2 s, 200 seeds per window:", "",
                      "| Window | Cycles | Mean measured | Spread | Theory spread |",
                      "| --- | --- | --- | --- | --- |"]
            lines += [f"| {r['window']:,.0f} s | {r['cycles']:,.0f} | {r['mean']:.4f} | "
                      f"{r['spread']:.4f} | {r['theory_spread']:.4f} |" for r in convergence_rows]
            lines += ["", "The mean stays at the target while the spread shrinks like "
                      "1/sqrt(cycles), as the central limit theorem predicts.", ""]
        if title.startswith("2."):
            lines += ["![Up periods](up-periods.svg)", "", "![Down periods](down-periods.svg)", ""]
    (output / "report.md").write_text("\n".join(lines), encoding="utf-8")
    return passed, len(checks)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path,
                        default=ROOT / "experiments/results/availability-validation-rerun")
    output = parser.parse_args().output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()

    print("1/6 availability convergence ...", flush=True)
    convergence, convergence_rows = check_convergence()
    print("2/6 up/down period distributions ...", flush=True)
    periods, samples = check_periods()
    print("3/6 every server down at once ...", flush=True)
    all_down, headline = check_all_down()
    print("4/6 outage counts ...", flush=True)
    counts = check_outage_counts()
    print("5/6 trends ...", flush=True)
    trends = check_trends()
    print("6/6 continuous vs one-shot ...", flush=True)
    continuous = check_continuous()
    elapsed = time.perf_counter() - started

    histogram_svg(samples["up"], samples["mtbf"],
                  "Up periods (availability 0.9, MTTR 2 s)", output / "up-periods.svg")
    histogram_svg(samples["down"], samples["mttr"],
                  "Down periods (MTTR 2 s)", output / "down-periods.svg")
    sections = [("1. Availability converges to the setting", convergence),
                ("2. Up and down periods are exponential", periods),
                ("3. Every server down at once = product of (1 - A)", all_down),
                ("4. Failures per window = T / (MTBF + MTTR)", counts),
                ("5. Trends", trends),
                ("6. Continuous sessions match one-shot runs", continuous)]
    passed, total = write_report(output, sections, convergence_rows, headline, elapsed)
    (output / "results.json").write_text(json.dumps(dict(
        generated=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        python=platform.python_version(), seeds=len(SEEDS), tolerance_standard_errors=TOLERANCE_SE,
        elapsed_seconds=round(elapsed, 1), passed=passed, total=total,
        convergence=convergence_rows,
        checks={title: cs for title, cs in sections}), indent=2), encoding="utf-8")

    for title, cs in sections:
        for c in cs:
            print(f"  {'PASS' if c['passed'] else 'FAIL'}  {c['name']}")
    # ASCII "+/-" because some Windows consoles cannot print "±".
    print(f"\n{headline['name']}: theory {headline['expected']:.1%}, measured "
          f"{headline['measured']:.1%} +/- {headline['ci95']:.1%} (95% interval)")
    print(f"{passed} of {total} availability checks passed in {elapsed:.0f} s. "
          f"Report: {output / 'report.md'}")
    raise SystemExit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
