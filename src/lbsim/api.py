"""Local Python API. Start with: uv run uvicorn lbsim.api:app --host 127.0.0.1."""

from dataclasses import dataclass
from math import isfinite
import multiprocessing
from threading import BoundedSemaphore
from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException

from lbsim.settings import validate_config
from lbsim.simulation import run_simulation


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


class BodyLimit:
    """Bound the actual streamed body, even without Content-Length."""
    def __init__(self, app, maximum):
        self.app, self.maximum = app, maximum

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        size, messages = 0, []
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            size += len(message.get('body', b''))
            if size > self.maximum:
                return await error_response(413, 'BODY_TOO_LARGE',
                    f'Request body exceeds {self.maximum} bytes.')(scope, receive, send)
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


def checked_config(values, limits):
    allowed = {'server_count', 'concurrency', 'queue_limit', 'arrival_rate', 'duration',
               'service_min', 'service_max', 'seed', 'policy', 'processing_rates'}
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
    product = config['arrival_rate'] * config['duration']
    exceeded = []
    if not isfinite(product) or product > limits.generated_requests:
        exceeded.append(('arrival_rate', f'Arrival rate × duration must be at most {limits.generated_requests:,}.'))
    for value, maximum, key in (
        (config['server_count'], limits.servers, 'server_count'),
        (config['server_count'] * config['concurrency'], limits.slots, 'concurrency'),
        (config['server_count'] * config['queue_limit'], limits.waiting_places, 'queue_limit'),
    ):
        if value > maximum:
            exceeded.append((key, f'Total {key} capacity exceeds the API limit of {maximum:,}.'))
    if exceeded:
        raise APIError(422, 'WORKLOAD_LIMIT', 'Reduce the workload to fit the API limits.',
                       [{'field': f'config.{key}', 'message': message} for key, message in exceeded])
    return config


def _worker(connection, config):
    try:
        connection.send(('ok', run_simulation(config)))
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


def create_app(*, limits=None, runner=isolated_run):
    limits = limits or Limits()
    app = FastAPI(title='Load balancing engine API', version='1.0.0')
    app.add_middleware(BodyLimit, maximum=limits.body_bytes)
    gate = BoundedSemaphore(1)

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
            **vars(limits), 'concurrent_runs': 1}}

    @app.post('/v1/run')
    async def run(request: RunRequest):
        config = checked_config(request.config, limits)
        if not gate.acquire(blocking=False):
            raise APIError(429, 'RUN_BUSY', 'Another simulation is running. Retry after it finishes.')
        try:
            summary = await run_in_threadpool(runner, config, limits)
        finally:
            gate.release()
        return {'api_version': '1', 'config': config, 'summary': summary}

    return app


app = create_app()
