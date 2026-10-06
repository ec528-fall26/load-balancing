import random
from lbsim.server import Request, Server

def route(server_count: int, concurrency: int, queue_limit: int, policy: str, arrival_rate: float, duration: float, service_min: float, service_max: float, seed: int):
    if policy != "round_robin":
        raise ValueError("Only round-robin routing is implemented yet.")
    rng = random.Random(seed)
    server_map = {}
    for i in range(server_count):
        server_map[i] = Server(i, concurrency, queue_limit, None, None)

    # Pre-store all requests
    requests = []
    total_requests = int(arrival_rate * duration)
    for request_id in range(total_requests):
        # Increment arrival time by a fixed amount
        arrival_time = request_id / arrival_rate
        service_time = rng.uniform(service_min, service_max)
        requests.append(Request(request_id, arrival_time, service_time))

    pending = []  # Stores pending completions as tuples of (completion_time, server_id, request_id)
    completed = []
    rejected = []

    counter = 0

    # Continue until there are no more requests or pending completions
    while requests or pending:
        next_arrival = requests[0].arrival_time if requests else float('inf')
        
        # Get the earliest completion time
        if pending:
            pending.sort() 
            next_completion = pending[0][0] 
        else:
            next_completion = float('inf')

        # If the next completion happens earlier than the next arrival, process that
        if next_completion <= next_arrival:
            now = next_completion
            _, server_id, req_id = pending.pop(0)
            
            server = server_map[server_id]
            c = server.complete(req_id, now)
            
            completed.append(c.finished)
            
            # If the server pulled a request from its queue, keep track of that
            if c.started:
                new_execution = c.started
                pending.append((new_execution.completion_time, server_id, new_execution.request.id))

        else:
            # If the next arrival happens before the next completion, process that
            now = next_arrival
            req = requests.pop(0)
            
            # Routing policy logic
            if policy == "round_robin":
                target_server = server_map[counter % server_count]
                counter += 1
            
            admission = target_server.submit(req, now)
            
            if admission.status == "started":
                # Request has been sent, put id in pending
                pending.append((admission.execution.completion_time, target_server.id, req.id))
            elif admission.status == "rejected":
                rejected.append(req.id)
            
            # Don't worry if admission.status is "queued", we add the id to pending when it gets pulled
            # from the server queue.
    return completed, rejected
