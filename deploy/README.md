# Deployment

## Run the Lab with Docker Compose

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

## Run the Lab on Kubernetes

The Lab uses the same three images as [Docker Compose](#run-the-lab-with-docker-compose).
The Nginx gateway serves the Next.js UI and routes its API calls to either the
compute or state service. Kubernetes Services route connections to ready pods.

### Start a local cluster

From the repository root, with Docker, [kind](https://kind.sigs.k8s.io/docs/user/quick-start/)
and `kubectl` installed. Verified with kind v0.33.0 and Kubernetes v1.37.0.

```sh
docker build -t lbsim-web:local src/frontend
docker build -f deploy/python.Dockerfile -t lbsim-python:local .
docker build -f deploy/gateway.Dockerfile -t lbsim-gateway:local deploy

kind create cluster --name lbsim
kind load docker-image lbsim-web:local lbsim-python:local lbsim-gateway:local --name lbsim
kubectl --context kind-lbsim apply -f deploy/kubernetes/lbsim.yaml
kubectl --context kind-lbsim -n lbsim rollout status deployment --timeout=120s
kubectl --context kind-lbsim -n lbsim port-forward service/gateway 8080:8080
```

Open [http://localhost:8080](http://localhost:8080). The gateway's internal API
listener and the Python services are reachable inside the cluster.

For a cluster that pulls from a registry, push the three images and replace
their `image` references with registry-qualified tags or digests. If the
cluster uses a custom DNS domain, adjust the gateway's `LBSIM_SERVICE_SUFFIX`
accordingly.

### Scale web and compute

In another terminal:

```sh
kubectl --context kind-lbsim -n lbsim scale deployment/web deployment/compute-api --replicas=2
kubectl --context kind-lbsim -n lbsim rollout status deployment --timeout=120s
kubectl --context kind-lbsim -n lbsim get pods
```

Web and compute replica counts can be set independently. Keep `state-api` at
one replica because it owns active sessions and temporary recordings.
Restarting that pod expires its runs and sessions. Scaling is manual.

To check the deployment, start a live session and create a recorded run
before scaling. After scaling, reopen both and run several independent sharded
simulations. Use `kubectl --context kind-lbsim -n lbsim logs -l app=compute-api --prefix`
to see which compute pods served the requests.

Remove the local cluster with `kind delete cluster --name lbsim`.
