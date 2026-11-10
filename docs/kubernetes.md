# Run the Lab on Kubernetes

The Lab uses the same three images as [Docker Compose](docker-compose.md).
The Nginx gateway serves the Next.js UI and routes its API calls to either the
compute or state service. Kubernetes Services route connections to ready pods.

## Start a local cluster

From the repository root, with Docker, [kind](https://kind.sigs.k8s.io/docs/user/quick-start/)
and `kubectl` installed:

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

## Scale web and compute

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
