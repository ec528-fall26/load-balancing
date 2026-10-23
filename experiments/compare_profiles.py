"""D3-07: compare matching profiler reports without using instrumented timings."""

import argparse
import json
from pathlib import Path


def cases_by_config(report):
    return {json.dumps(case['config'], sort_keys=True): case for case in report['cases']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    before = json.loads(args.before.read_text())
    after = json.loads(args.after.read_text())
    for key in ('python', 'platform', 'machine', 'streamlit'):
        if before[key] != after[key]:
            raise ValueError(f'Environment differs: {key}')
    left, right = cases_by_config(before), cases_by_config(after)
    if left.keys() != right.keys():
        raise ValueError('Configurations differ')
    rows = []
    for config, old in left.items():
        new = right[config]
        for key in ('summary_sha256', 'event_count', 'completed_count', 'rejected_count'):
            if old[key] != new[key]:
                raise ValueError(f'Results differ: {config}: {key}')
        prior, current = old['median_unprofiled_seconds'], new['median_unprofiled_seconds']
        row = dict(config=old['config'], summary_sha256=old['summary_sha256'],
                   before_seconds=prior, after_seconds=current, speedup=prior/current,
                   runtime_reduction_percent=100*(1-current/prior))
        rows.append(row)
        print(f"{int(old['config']['arrival_rate']*old['config']['duration'])} requests / "
              f"{old['config']['server_count']} servers: {prior:.4f} → {current:.4f} s "
              f"({prior/current:.2f}×); exact summary match")
    args.output.write_text(json.dumps(dict(before_source_sha256=before['source_sha256'],
                                           after_source_sha256=after['source_sha256'],
                                           cases=rows), indent=2) + '\n')


if __name__ == '__main__':
    main()
