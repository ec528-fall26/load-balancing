# Run the Lab with Docker Compose

From the repository root, with a running Docker Engine and Compose v2 or newer:

```sh
docker compose up -d --build --wait
```

Open [http://localhost:8080](http://localhost:8080). Set `LBSIM_PORT` to
change the loopback port. The gateway is the only service with a published port.
The web build uses the npm lockfile, and both Python services use `uv.lock`.

| Service | Responsibility | Replica behavior |
| --- | --- | --- |
| `gateway` | Nginx serves the web ingress and routes Python requests internally. | One gateway discovers web and compute replicas through Docker DNS. |
| `web` | Next.js UI and same-origin API proxy. | Scale independently. |
| `compute-api` | Independent regional runs, sharded runs, research comparisons, and the legacy summary endpoint. | Scale independently. Each replica has its own bounded admission gate. |
| `state-api` | Recorded-run creation and playback, exports, replays, and continuous sessions. | Keep one replica. Run and session IDs refer to local state and temporary recordings. |

Scale the stateless services without restarting the gateway or moving existing
state:

```sh
docker compose up -d --no-build --wait --scale web=2 --scale compute-api=2
docker compose ps
```

Nginx re-resolves Docker service names every two seconds and distributes
independent compute calls across the discovered peers. Compose replicas run
on the same Docker host. The state owner remains responsible for recorded
one-shot runs and session workers. Restarting that service expires its local
recordings and sessions.

To verify scaling, start a continuous session or create a recorded run before
scaling. After scaling, read its snapshot again and run several independent
sharded simulations. The gateway log reports the upstream address on each
request. Web traffic and independent compute should reach two addresses per
service while state requests continue to reach the same API.

```sh
docker compose logs gateway
docker compose down
```
