"""Bounded browser preview for the standalone CPU/I/O research model."""
from dataclasses import asdict
from math import isfinite
from lbsim.cpu_io import StagedRequest, make_workload, run_staged
from lbsim.policies import policy_options, supports_policy


def preview(values):
    allowed = {'mode', 'profile', 'rate', 'seed', 'policy'}
    if set(values) - allowed:
        raise ValueError('Unknown CPU/I/O preview settings.')
    mode = values.get('mode', 'walkthrough')
    profile = values.get('profile', 'io_heavy')
    rate = values.get('rate', 100)
    seed = values.get('seed', 42)
    policy = values.get('policy', 'round_robin')
    if mode not in ('walkthrough', 'workload') or profile not in ('io_heavy', 'cpu_heavy'):
        raise ValueError('Choose a supported example and workload profile.')
    if type(rate) not in (int, float) or not isfinite(rate) or not 1 <= rate <= 400:
        raise ValueError('Preview traffic must be between 1 and 400 requests/s.')
    if type(seed) is not int or not 0 <= seed <= 1000000 or not supports_policy(policy, 'cpu_io'):
        raise ValueError('Choose a supported policy and seed from zero to 1,000,000.')
    if mode == 'walkthrough':
        trace = (StagedRequest(0, 0, 1, 2, 1), StagedRequest(1, .1, 1, 2, 1))
        config = dict(servers=1, cpu_slots=1, outstanding_limit=2, duration=1)
    else:
        trace = make_workload(rate=rate, duration=2, seed=seed,
                              io_fraction=.9 if profile == 'io_heavy' else .1)
        config = dict(servers=8, cpu_slots=1, outstanding_limit=8, duration=2)
    results, selected = [], None
    for name in policy_options('cpu_io'):
        result = run_staged(trace, **config, policy=name, routing_seed=1000000 + seed,
                            record_events=name == policy)
        results.append({k:v for k,v in result.items() if k not in ('events', 'completions', 'rejected_ids')})
        if name == policy:
            selected = result
    return dict(api_version='1', mode=mode, profile=profile, rate=rate, seed=seed,
                config=config, policy=policy, policies=policy_options('cpu_io'),
                comparison=results, playback=selected,
                requests=[asdict(r) for r in trace] if mode == 'walkthrough' else [])
