import random
from collections import deque
from lbsim.reliability import outage_schedule
from lbsim.server import Request, Server
from lbsim.policies import RoutingContext, create_policy, supports_policy

def route(server_count: int, concurrency: int, queue_limit: int, policy: str, arrival_rate: float, duration: float, service_min: float, service_max: float, seed: int, events: list | None = None,
          processing_rates: tuple[float, ...] | None = None, reliabilities: tuple[float, ...] | None = None,
          mean_repair_time: float = 1.0, outages: dict | None = None):
    """Run the batch engine and return (completed executions, rejected request IDs).

    `reliabilities` generates a seeded outage schedule (see lbsim.reliability);
    `outages` supplies one directly as {server_id: [(down, up), ...]}. At equal
    timestamps a completion is handled first, then a server going down or up,
    then an arrival.
    """
    if not supports_policy(policy):
        raise ValueError("Select a supported routing policy.")
    if processing_rates is not None and len(processing_rates) != server_count:
        raise ValueError("processing_rates needs one value per server")
    if reliabilities is not None and len(reliabilities) != server_count:
        raise ValueError("reliabilities needs one value per server")
    if outages is None and reliabilities is not None:
        outages = outage_schedule(reliabilities, mean_repair_time, duration, seed)
    rng = random.Random(seed)
    server_map = {}
    for i in range(server_count):
        # Rates only change execution time; the seeded trace below is identical.
        rate = 1.0 if processing_rates is None else processing_rates[i]
        reliability = None if reliabilities is None else float(reliabilities[i])
        server_map[i] = Server(i, concurrency, queue_limit, None, reliability, processing_rate=rate)

    # Pre-store all requests
    requests = deque()
    total_requests = int(arrival_rate * duration)
    for request_id in range(total_requests):
        # Increment arrival time by a fixed amount
        arrival_time = request_id / arrival_rate
        service_time = rng.uniform(service_min, service_max)
        requests.append(Request(request_id, arrival_time, service_time))

    # Server down/up times as (time, server_id, "down"|"up"), in time order.
    changes = []
    for sid, intervals in (outages or {}).items():
        for start, end in intervals:
            changes += [(start, len(changes), sid, "down"), (end, len(changes) + 1, sid, "up")]
    transitions = deque((time, sid, kind) for time, _, sid, kind in sorted(changes))
    up_count = server_count

    pending = []  # Stores pending completions as tuples of (completion_time, server_id, request_id)
    completed = []
    rejected = []

    routing = create_policy(policy, RoutingContext(
        server_count, lambda i: server_map[i].running_count,
        demand=lambda i: server_map[i].running_count+server_map[i].waiting_count,
        routing_rng=random.Random(seed + 1000000),
        available=(lambda i: server_map[i].up) if transitions else None))

    # Continue until there are no more requests, pending completions or outages
    while requests or pending or transitions:
        next_arrival = requests[0].arrival_time if requests else float('inf')
        next_transition = transitions[0][0] if transitions else float('inf')

        # Get the earliest completion time
        if pending:
            pending.sort()
            next_completion = pending[0][0]
        else:
            next_completion = float('inf')

        # If the next completion happens no later than anything else, process that
        if next_completion <= next_arrival and next_completion <= next_transition:
            now = next_completion
            _, server_id, req_id = pending.pop(0)

            server = server_map[server_id]
            c = server.complete(req_id, now)

            routing.update(server_id)
            completed.append(c.finished)
            if events is not None:
                events.append((now, server_id, server.running_count, server.waiting_count, "completed", req_id))

            # If the server pulled a request from its queue, keep track of that
            if c.started:
                new_execution = c.started
                pending.append((new_execution.completion_time, server_id, new_execution.request.id))

        elif next_transition <= next_arrival:
            # A server goes down or comes back up
            now, server_id, kind = transitions.popleft()
            server = server_map[server_id]
            if kind == "up":
                server.recover(now)
                up_count += 1
                routing.update(server_id)
                
                if events is not None:
                    events.append((now, server.id, server.running_count, server.waiting_count, "server_up", None))
                continue
            dropped = server.fail(now)
            up_count -= 1
            gone = {r.id for r in dropped}
            pending = [p for p in pending if not (p[1] == server_id and p[2] in gone)]
            routing.update(server_id)
            if events is not None:
                events.append((now, server.id, server.running_count, server.waiting_count, "server_down", None))
            # Send its running and queued work back through the load balancer; it restarts.
            for req in dropped:
                if up_count == 0:
                    rejected.append(req.id)
                    if events is not None:
                        events.append((now, server.id, server.running_count, server.waiting_count, "reroute_rejected", req.id))
                    continue
                target = server_map[routing.choose()]
                admission = target.submit(req, now)
                routing.update(target.id)
                if admission.status == "rejected":
                    rejected.append(req.id)
                    if events is not None:
                        events.append((now, target.id, target.running_count, target.waiting_count, "reroute_rejected", req.id))
                    continue
                if admission.status == "started":
                    pending.append((admission.execution.completion_time, target.id, req.id))
                if events is not None:
                    events.append((now, target.id, target.running_count, target.waiting_count, "rerouted", req.id))

        else:
            # If the next arrival happens before the next completion, process that
            now = next_arrival
            req = requests.popleft()

            if up_count == 0:
                # Every server is down: nothing can accept the request.
                rejected.append(req.id)
                if events is not None:
                    events.append((now, server_map[0].id, server_map[0].running_count, server_map[0].waiting_count, "rejected", req.id))
                continue

            target_server = server_map[routing.choose()]

            admission = target_server.submit(req, now)
            routing.update(target_server.id)
            if events is not None:
                events.append((now, target_server.id, target_server.running_count,
                               target_server.waiting_count, admission.status, req.id))

            if admission.status == "started":
                # Request has been sent, put id in pending
                pending.append((admission.execution.completion_time, target_server.id, req.id))
            elif admission.status == "rejected":
                rejected.append(req.id)

            # Don't worry if admission.status is "queued", we add the id to pending when it gets pulled
            # from the server queue.
    return completed, rejected
