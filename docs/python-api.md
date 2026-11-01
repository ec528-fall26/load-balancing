# Python engine API (A-05)

The API wraps the existing seeded simulation engine. It does not change routing,
queueing, draining, metrics, or processing-rate behavior. The Next.js proxy is
not connected yet; that is A-06. Regional and continuous APIs are later tasks.

## Start locally

From the repository root:

```sh
uv sync --locked
PYTHONPATH=src uv run uvicorn lbsim.api:app --host 127.0.0.1 --port 8000 --workers 1
```

Health: `http://127.0.0.1:8000/health`. Interactive API reference:
`http://127.0.0.1:8000/docs`. OpenAPI: `/openapi.json`.

Use one API worker. Admission limits are in-process and are not shared across
multiple API workers. The service binds locally; public hosting, authentication,
and persistent sessions are outside A-05.

## Run a simulation

```sh
curl --fail-with-body http://127.0.0.1:8000/v1/run \
  -H 'Content-Type: application/json' \
  -d '{"config":{"server_count":2,"concurrency":2,"queue_limit":2,"policy":"round_robin","arrival_rate":10,"duration":2,"service_min":0.1,"service_max":1,"seed":42}}'
```

The request requires a `config` object. The nine original settings are required;
`processing_rates` is optional, with one positive finite multiplier per server.
Unknown envelope/configuration fields are rejected rather than ignored.

Success returns HTTP 200 with:

```json
{
  "api_version": "1",
  "config": {"...": "validated simulation configuration"},
  "summary": {"...": "existing engine summary, response_times and events"}
}
```

`api_version` versions the HTTP interface, independently of saved-run export
schema versions. Events are JSON arrays and server-utilization object keys are
strings on the wire. A uniform all-1 processing-rate list is normalized away
by the existing validator. Mixed rates remain in the returned configuration.
Saved-run v1 exports still do not support those rates.

## Limits and errors

Defaults, also returned by `/health`:

| Limit | Value |
| --- | ---: |
| Actual request body, including chunked uploads | 65,536 bytes |
| Arrival rate × duration | 100,000 |
| Servers | 1,000 |
| Total processing slots | 4,096 |
| Total waiting places | 100,000 |
| Concurrent simulations per API process | 1 |
| Worker response deadline | 15 seconds, plus bounded process cleanup |

Overlapping simulations receive 429 immediately rather than entering an
unbounded job queue. Simulation computation runs in a spawned child process;
the API waits in a thread so the async request loop remains available. The child
is terminated and reaped on timeout. Each request starts a fresh child, so a
failed run does not leave a broken persistent executor. Completed traces remain
bounded by the workload limits; they are still included in this first endpoint.
Snapshot aggregation and separate playback transfer belong to A-11.

All errors share an envelope:

```json
{
  "api_version": "1",
  "code": "INVALID_CONFIG",
  "message": "Configuration validation failed.",
  "field_errors": [{"field": "config.concurrency", "message": "must be an integer"}]
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 413 | BODY_TOO_LARGE | Reduce the request body |
| 422 | INVALID_REQUEST | Invalid JSON or request envelope |
| 422 | INVALID_CONFIG | Unsupported or invalid simulation configuration |
| 422 | WORKLOAD_LIMIT | Reduce workload/capacity to fit API limits |
| 429 | RUN_BUSY | Another simulation owns the worker slot; retry later |
| 504 | RUN_TIMEOUT | Reduce workload; the child process is cleaned up |
| 500 | ENGINE_FAILED / INTERNAL_ERROR | Worker or unexpected service failure |

Unknown routes and unsupported methods use the same envelope with 404/405.

## Checks

```sh
PYTHONPATH=src uv run python -m unittest discover -s tests -p test_api.py -v
PYTHONPATH=src uv run python -m unittest discover -s tests
```

API tests exercise both policies with mixed compute speeds against exact direct
engine output, input and workload errors, streamed body limits, concurrent-run
admission, health during an active run, timeout/crash cleanup, and slot recovery.
