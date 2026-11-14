"""Local Python API. Start with: uv run uvicorn lbsim.api:app --host 127.0.0.1."""

from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from math import isfinite
import multiprocessing
from os import getenv
from threading import BoundedSemaphore
from typing import Any, Literal

from fastapi import FastAPI, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from lbsim.cpu_io_preview import preview as cpu_io_preview
from lbsim.exports import build_exports
from lbsim.saved_runs import load_configuration, load_results, verify_replay
from lbsim.fanout import experiment as fanout_experiment, run_fanout
from lbsim.runs import RunStore
from lbsim.settings import validate_config
from lbsim.regional import RegionalSimulation, run_regional, presets
from lbsim.regions import Region, validate_topology
from lbsim.simulation import run_simulation
from lbsim.sessions import SessionLimits, SessionManager, SessionError


@dataclass(frozen=True)
class Limits:
    body_bytes: int = 65536
    generated_requests: int = 100000
    servers: int = 1000
    slots: int = 4096
    waiting_places: int = 100000
    worker_seconds: float = 15.0


class APIError(Exception):
    def __init__(self, status, code, message, fields=None):
        self.status, self.code, self.message = status, code, message
        self.fields = fields or []


def error_response(status, code, message, fields=None):
    return JSONResponse(status_code=status, content={
        'api_version': '1', 'code': code, 'message': message,
        'field_errors': fields or []})


SAVED_COMPARISON_BODY_BYTES = 12 * 1024 * 1024


class BodyLimit:
    """Bound the actual streamed body, even without Content-Length."""
    def __init__(self, app, maximum):
        self.app, self.maximum = app, maximum

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        maximum = (SAVED_COMPARISON_BODY_BYTES
                   if scope['path'] == '/v1/saved/compare' and scope['method'] == 'POST'
                   else self.maximum)
        size, messages = 0, []
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            size += len(message.get('body', b''))
            if size > maximum:
                return await error_response(413, 'BODY_TOO_LARGE',
                    f'Request body exceeds {maximum} bytes.')(scope, receive, send)
            messages.append(message)
            if not message.get('more_body', False):
                break
        cursor = iter(messages)

        async def bounded_receive():
            return next(cursor, {'type': 'http.request', 'body': b'', 'more_body': False})

        await self.app(scope, bounded_receive, send)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    config: dict[str, Any]


class ReplayRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    configuration: str


class SavedComparisonRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    results: tuple[str, str]


class ExportRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    run_id: str


def checked_config(values, limits):
    allowed = {'server_count', 'concurrency', 'queue_limit', 'arrival_rate', 'duration',
               'service_min', 'service_max', 'seed', 'policy', 'processing_rates',
               'reliabilities', 'mean_repair_time',
               'request_model', 'io_fraction', 'outstanding_limit', 'io_capacity', 'io_heavy_probability'}
    extra = sorted(set(values) - allowed)
    if extra:
        raise APIError(422, 'INVALID_CONFIG', 'Unknown configuration fields.',
                       [{'field': f'config.{key}', 'message': 'Unknown field.'} for key in extra[:20]])
    try:
        config = validate_config(values)
    except (ValueError, OverflowError) as error:
        fields = []
        for part in str(error).split('; ')[:20]:
            key, sep, message = part.partition(': ')
            fields.append({'field': f'config.{key}' if sep else 'config',
                           'message': message if sep else part})
        raise APIError(422, 'INVALID_CONFIG', 'Configuration validation failed.', fields) from error
    if config.get('request_model') == 'cpu_io':
        fraction = .9 if 'io_heavy_probability' in config else config['io_fraction']
        for speed in config.get('processing_rates', (1.,)):
            low = config['service_min']*(1-fraction)/2/speed
            high = config['service_max']*(1-fraction)/2/speed
            if not isfinite(high) or not 1e-9 <= low <= high <= 3600 or config['service_max']*fraction > 3600:
                raise APIError(422, 'INVALID_CONFIG', 'CPU stages must be 1 ns–3,600 s and I/O delay at most 3,600 s.')
    product = config['arrival_rate'] * config['duration']
    exceeded = []
    if not isfinite(product) or product > limits.generated_requests:
        exceeded.append(('arrival_rate', f'Arrival rate × duration must be at most {limits.generated_requests:,}.'))
    for value, maximum, key in (
        (config['server_count'], limits.servers, 'server_count'),
        (config['server_count'] * config['concurrency'], limits.slots, 'concurrency'),
        (config['server_count'] * config['queue_limit'], limits.waiting_places, 'queue_limit'),
        (config['server_count'] * config.get('outstanding_limit', 0), limits.waiting_places, 'outstanding_limit'),
    ):
        if value > maximum:
            exceeded.append((key, f'Total {key} capacity exceeds the API limit of {maximum:,}.'))
    if exceeded:
        raise APIError(422, 'WORKLOAD_LIMIT', 'Reduce the workload to fit the API limits.',
                       [{'field': f'config.{key}', 'message': message} for key, message in exceeded])
    return config


def finite_number(value):
    try:
        return type(value) in (int, float) and isfinite(value)
    except OverflowError:
        return False


class SessionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    config: dict[str, Any]
    speed: StrictFloat | StrictInt = 1.0
    paused: StrictBool = False
    replace_session_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")


class SessionCommand(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['pause', 'resume', 'set_rate', 'set_speed']
    value: StrictFloat | StrictInt | None = None


def checked_session_config(values, limits, session_limits):
    if 'duration' in values:
        raise APIError(422, 'INVALID_CONFIG', 'Continuous sessions have no arrival-window duration.',
                       [{'field': 'config.duration', 'message': 'Omit duration for a continuous session.'}])
    rate = values.get('arrival_rate')
    if not finite_number(rate) or not 0 <= rate <= session_limits.max_arrival_rate:
        raise APIError(422, 'INVALID_CONFIG', 'Invalid continuous traffic rate.',
                       [{'field': 'config.arrival_rate', 'message': f'Use 0–{session_limits.max_arrival_rate:g} requests/s.'}])
    config = checked_config({**values, 'duration': 1, 'arrival_rate': rate or 1}, replace(limits, generated_requests=session_limits.max_arrival_rate))
    config.pop('duration')
    config['arrival_rate'] = rate
    rates = config.get('processing_rates', (1.0,))
    for speed in rates:
        low, high = config['service_min'] / speed, config['service_max'] / speed
        if not isfinite(high) or not 1e-9 <= low <= high <= 3600:
            raise APIError(422, 'INVALID_CONFIG', 'Effective service times must be between 1 ns and 3,600 seconds.')
    return config


def checked_regional_config(values, limits, session_limits, *, continuous=False):
    """Normalize a distinct regional schema; never reinterpret a server policy."""
    allowed = {'topology','regions','latency_ms','client_latency_ms','source','policy',
               'arrival_rate','service_min','service_max','seed'} | (set() if continuous else {'duration'})
    try:
        if set(values)-allowed or values.get('topology') != 'regions':
            raise ValueError('Use the regional schema; unknown fields or continuous duration are not allowed.')
        rows = values.get('regions')
        if not isinstance(rows,list) or not 1 <= len(rows) <= 12:
            raise ValueError('Use 1–12 regions.')
        regions = [Region(**r) for r in rows]
        if any(len(r.name) > 64 or r.name != r.name.strip() for r in regions):
            raise ValueError('Names must be trimmed and at most 64 characters.')
        matrix = values.get('latency_ms')
        validate_topology(regions, matrix)
        source = values.get('source',0)
        if type(source) is not int or not 0 <= source < len(rows):
            raise ValueError('Source must identify a region.')
        rate, low, high = (values.get(k) for k in ('arrival_rate','service_min','service_max'))
        if not finite_number(rate) or not 0 <= rate <= session_limits.max_arrival_rate:
            raise ValueError('Arrival rate must be between 0 and 100,000 requests/s.')
        if not all(finite_number(v) for v in (low,high)) or not 0 < low <= high:
            raise ValueError('Service bounds must be positive and ordered.')
        seed = values.get('seed',42)
        if type(seed) is not int or not 0 <= seed <= 2**32-1:
            raise ValueError('Seed must be an integer between 0 and 4,294,967,295.')
        duration = values.get('duration')
        if not continuous and (not finite_number(duration) or not 0 < duration <= 3600):
            raise ValueError('Arrival duration must be positive and at most 3,600 seconds.')
        if sum(r.servers for r in regions)>limits.servers or sum(r.slots for r in regions)>limits.slots or sum(r.queue_limit for r in regions)>limits.waiting_places:
            raise ValueError('Regional totals exceed the server, slot or queue limits.')
        if any(not 1e-9 <= low/r.compute <= high/r.compute <= 3600 for r in regions):
            raise ValueError('Effective service times must be between 1 ns and 3,600 seconds.')
        from dataclasses import asdict
        config = dict(topology='regions', regions=[asdict(r) for r in regions], latency_ms=matrix,
            client_latency_ms=values.get('client_latency_ms',matrix[source]), source=source,
            arrival_rate=rate,service_min=low,service_max=high,seed=seed,policy=values.get('policy','least_loaded'))
        # Verify the engine contract, including client RTT and regional policy.
        RegionalSimulation(config)
        if not continuous and rate*duration > limits.generated_requests:
            raise ValueError('Arrival rate × duration exceeds the request limit.')
        # Bound outstanding travel memory at the maximum permitted session rate,
        # even when a running session later changes traffic via a command.
        travel_rate = session_limits.max_arrival_rate if continuous else rate
        if travel_rate * max(config['client_latency_ms'])/1000 > 100000:
            raise ValueError('Client RTT × maximum traffic exceeds the 100,000 in-transit budget. Reduce RTT (or one-shot traffic).')
        if not continuous:
            config['duration'] = duration
        return config
    except (ValueError, TypeError, KeyError, OverflowError) as error:
        raise APIError(422,'INVALID_CONFIG','Regional configuration validation failed.',
            [{'field':'config','message':str(error)}]) from error


def checked_command(action, value, session_limits):
    if action in ('pause', 'resume'):
        if value is not None:
            raise APIError(422, 'INVALID_COMMAND', 'Pause/resume commands do not take a value.')
    elif not finite_number(value):
        raise APIError(422, 'INVALID_COMMAND', 'Command value must be finite.')
    elif action == 'set_rate' and not 0 <= value <= session_limits.max_arrival_rate:
        raise APIError(422, 'INVALID_COMMAND', f'Traffic must be between 0 and {session_limits.max_arrival_rate:g} requests/s.')
    elif action == 'set_speed' and not .25 <= value <= 10:
        raise APIError(422, 'INVALID_COMMAND', 'Simulation speed must be between 0.25 and 10.')


def _worker(connection, config):
    try:
        connection.send(('ok', run_regional(config) if config.get('topology') == 'regions' else run_simulation(config)))
    except ValueError as error:
        connection.send(('invalid', str(error)))
    except Exception:
        connection.send(('failed', None))
    finally:
        connection.close()


def isolated_run(config, limits, *, worker_target=_worker):
    """One bounded child per run; timed-out children are terminated and reaped."""
    context = multiprocessing.get_context('spawn')
    receiving, sending = context.Pipe(duplex=False)
    process = context.Process(target=worker_target, args=(sending, config))
    try:
        process.start()
        sending.close()
        if not receiving.poll(limits.worker_seconds):
            raise APIError(504, 'RUN_TIMEOUT', 'Simulation exceeded the runtime limit. Reduce the workload.')
        try:
            outcome, result = receiving.recv()
        except EOFError as error:
            raise APIError(500, 'ENGINE_FAILED', 'Simulation worker stopped unexpectedly.') from error
        if outcome == 'invalid':
            raise APIError(422, 'INVALID_CONFIG', 'The engine could not execute this configuration.',
                           [{'field': 'config', 'message': result}])
        if outcome != 'ok':
            raise APIError(500, 'ENGINE_FAILED', 'Simulation worker failed.')
        return result
    finally:
        receiving.close()
        sending.close()
        if process.pid is not None:
            process.join(timeout=0.2)
            if process.is_alive():
                process.terminate()
                process.join(timeout=1)
            if process.is_alive():
                process.kill()
                process.join()
            process.close()


def create_app(*, limits=None, runner=isolated_run, session_limits=None, session_manager=None, run_store=None):
    limits = limits or Limits()
    session_limits = session_limits or SessionLimits(
        startup_seconds=float(getenv("LBSIM_SESSION_STARTUP_SECONDS", "5"))
    )
    manager = session_manager or SessionManager(session_limits)
    recordings = run_store or RunStore()

    @asynccontextmanager
    async def lifespan(_app):
        manager.start()
        recordings.start()
        try:
            yield
        finally:
            await run_in_threadpool(manager.close)
            await run_in_threadpool(recordings.close)

    app = FastAPI(title='Load balancing engine API', version='1.0.0', lifespan=lifespan)
    app.state.sessions = manager
    app.state.runs = recordings
    app.add_middleware(BodyLimit, maximum=limits.body_bytes)
    gate = BoundedSemaphore(1)

    @app.exception_handler(SessionError)
    @app.exception_handler(APIError)
    async def api_error(_request, error):
        return error_response(error.status, error.code, error.message, error.fields)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_request, error):
        return error_response(422, 'INVALID_REQUEST', 'Request validation failed.', [
            {'field': '.'.join(map(str, item['loc'])), 'message': item['msg']}
            for item in error.errors()[:20]])

    @app.exception_handler(HTTPException)
    async def http_error(_request, error):
        code = {404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED'}.get(error.status_code, 'HTTP_ERROR')
        return error_response(error.status_code, code, str(error.detail))

    @app.exception_handler(Exception)
    async def unexpected_error(_request, _error):
        return error_response(500, 'INTERNAL_ERROR', 'The API could not complete the request.')

    @app.get('/health')
    async def health():
        return {'api_version': '1', 'status': 'ok', 'limits': {
            **vars(limits), 'concurrent_runs': 1}, 'live_limits': vars(session_limits), 'recorded_run_limits': vars(recordings.limits)}

    @app.post('/v1/research/cpu-io')
    async def research_cpu_io(request: RunRequest):
        if not gate.acquire(blocking=False):
            raise APIError(429, 'RUN_BUSY', 'Another simulation is running. Retry after it finishes.')
        try:
            return await run_in_threadpool(cpu_io_preview, request.config)
        except ValueError as error:
            raise APIError(422, 'INVALID_CONFIG', str(error)) from error
        finally:
            gate.release()

    @app.post('/v1/research/fan-out')
    async def research_fanout(request: RunRequest):
        return await fanout_request(request, fanout_experiment)

    @app.post('/v1/fan-out/run')
    async def fanout_run(request: RunRequest):
        return await fanout_request(request, run_fanout)

    async def fanout_request(request: RunRequest, operation):
        if not gate.acquire(blocking=False):
            raise APIError(429, 'RUN_BUSY', 'Another simulation is running. Retry after it finishes.')
        try:
            return await run_in_threadpool(operation, request.config)
        except ValueError as error:
            raise APIError(422, 'INVALID_CONFIG', str(error)) from error
        finally:
            gate.release()

    async def execute_single_pool(config, *, record=False, saved=None, compact=False):
        if not gate.acquire(blocking=False):
            raise APIError(429, 'RUN_BUSY', 'Another simulation is running. Retry after it finishes.')
        try:
            summary = await run_in_threadpool(runner, config, limits)
            if saved is not None:
                try:
                    await run_in_threadpool(verify_replay, saved, summary)
                except ValueError as error:
                    raise APIError(422, 'INVALID_EXPORT', str(error)) from error
            if record:
                return await run_in_threadpool(recordings.add, config, summary)
        finally:
            gate.release()
        if compact:
            summary = {**summary, 'events': [], 'response_times': []}
        return {'api_version': '1', 'config': config, 'summary': summary}

    @app.post('/v1/run')
    async def run(request: RunRequest):
        return await execute_single_pool(checked_config(request.config, limits))

    @app.post('/v1/run-summary')
    async def run_summary(request: RunRequest):
        return await execute_single_pool(checked_config(request.config, limits), compact=True)

    @app.post('/v1/runs', status_code=201)
    async def recorded_run(request: RunRequest):
        return await execute_single_pool(checked_config(request.config, limits), record=True)

    @app.post('/v1/saved/replay', status_code=201)
    async def replay(request: ReplayRequest):
        try:
            saved = load_configuration(request.configuration.encode('utf-8'))
        except ValueError as error:
            raise APIError(422, 'INVALID_EXPORT', str(error)) from error
        return await execute_single_pool(checked_config(saved.config, limits), record=True, saved=saved)

    @app.post('/v1/saved/compare')
    async def compare_saved(request: SavedComparisonRequest):
        def read_exports():
            runs = []
            for csv in request.results:
                saved = load_results(csv.encode('utf-8'))
                runs.append(dict(config=saved.config,
                                 summary={**saved.summary, 'events': [], 'response_times': []}))
            return runs

        try:
            return await run_in_threadpool(read_exports)
        except ValueError as error:
            raise APIError(422, 'INVALID_EXPORT', str(error)) from error

    @app.post('/v1/saved/exports')
    async def export_run(request: ExportRequest):
        run = await run_in_threadpool(recordings.get, request.run_id)
        try:
            exported = build_exports(run['config'], run['summary'])
        except ValueError as error:
            raise APIError(422, 'UNSUPPORTED_EXPORT', str(error)) from error
        return dict(run_id=exported.run_id, config_json=exported.config_json.decode('utf-8'),
                    results_csv=exported.results_csv.decode('utf-8'))

    @app.get('/v1/runs/{run_id}')
    async def recorded_summary(run_id: str):
        return await run_in_threadpool(recordings.get,run_id)

    @app.get('/v1/runs/{run_id}/events')
    async def recorded_events(run_id: str,offset: int=Query(0,ge=0,le=5*limits.generated_requests),limit: int=Query(min(500,recordings.limits.event_page),ge=1,le=recordings.limits.event_page)):
        return await run_in_threadpool(recordings.events,run_id,offset,limit)

    @app.get('/v1/runs/{run_id}/snapshot')
    async def recorded_snapshot(run_id: str,time: float=Query(0,ge=0),server_offset: int=Query(0,ge=0,le=limits.servers),server_limit: int=Query(min(32,recordings.limits.server_page),ge=1,le=recordings.limits.server_page)):
        if not isfinite(time):raise APIError(422,'INVALID_REQUEST','Time must be finite.')
        return await run_in_threadpool(recordings.snapshot,run_id,time,server_offset,server_limit)

    @app.delete('/v1/runs/{run_id}')
    async def delete_recording(run_id: str):
        return await run_in_threadpool(recordings.delete,run_id)

    @app.get('/v1/regions/presets')
    async def region_presets():
        return dict(api_version='1', presets=presets(), latency_assumptions='illustrative', model='aggregate_regional_pools')

    @app.post('/v1/regions/run')
    async def regional_run(request: RunRequest):
        config = checked_regional_config(request.config, limits, session_limits)
        if not gate.acquire(blocking=False):
            raise APIError(429, 'RUN_BUSY', 'Another simulation is running. Retry after it finishes.')
        try:
            summary = await run_in_threadpool(runner, config, limits)
        finally:
            gate.release()
        return dict(api_version='1', config=config, summary=summary)

    @app.post('/v1/sessions', status_code=201)
    async def create_session(request: SessionRequest):
        checked_command('set_speed', request.speed, session_limits)
        config = (checked_regional_config(request.config, limits, session_limits, continuous=True)
                  if request.config.get('topology') == 'regions' else
                  checked_session_config(request.config, limits, session_limits))
        return await run_in_threadpool(
            manager.create, config, speed=request.speed, paused=request.paused,
            replace_session_id=request.replace_session_id,
        )

    @app.get('/v1/sessions/{session_id}/snapshot')
    async def session_snapshot(session_id: str,
        server_offset: int = Query(0, ge=0, le=limits.servers),
        server_limit: int = Query(min(32, session_limits.server_page), ge=1, le=session_limits.server_page),
        history_limit: int = Query(min(120, session_limits.history_points), ge=0, le=session_limits.history_points)):
        return await run_in_threadpool(manager.request, session_id, 'snapshot', options=dict(
            server_offset=server_offset, server_limit=server_limit, history_limit=history_limit))

    @app.post('/v1/sessions/{session_id}/commands')
    async def session_command(session_id: str, request: SessionCommand):
        checked_command(request.action, request.value, session_limits)
        return await run_in_threadpool(manager.request, session_id, request.action, value=request.value)

    @app.delete('/v1/sessions/{session_id}')
    async def delete_session(session_id: str):
        return await run_in_threadpool(manager.delete, session_id)

    return app


app = create_app()
