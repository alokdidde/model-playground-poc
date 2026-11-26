# Helm chart: Model FOMO on DigitalOcean Kubernetes

**Status: documentation only.** The PoC runs on App Platform (`.do/app.yaml`). This chart is the scale-out path described in [ARCHITECTURE §8](../../../docs/ARCHITECTURE.md#why-app-platform-and-when-doks); nothing in the account is provisioned for it.

## What it deploys

| Resource | Notes |
| --- | --- |
| `web` Deployment + Service | Next.js UI + API. Readiness probe on `/api/health` (checks the DB); liveness is a TCP check so a DB blip doesn't restart pods. 200 s grace period so in-flight SSE compares finish. |
| Ingress | ingress-nginx with proxy buffering off and a 200 s read timeout (SSE), TLS via cert-manager. |
| `worker` Deployment | DBOS worker. Scale replicas freely; DBOS coordinates through Postgres and resumes interrupted workflows. |
| `migrate` Job | `prisma migrate deploy` as a `pre-install,pre-upgrade` hook, so the schema is ready before new pods roll. |
| ConfigMap / Secret | Non-secret config in `values.config`; secrets via `secrets.existingSecret` (recommended) or values. |

## Install (outline)

```bash
# Cluster add-ons (once): ingress-nginx and cert-manager, e.g. from the DO 1-Click marketplace.
doctl kubernetes cluster registry add <cluster>          # lets nodes pull from DOCR
doctl databases firewalls append <db-id> --rule k8s:<cluster-id>   # trusted source for Managed Postgres

# Images (in CI): one Dockerfile, two targets.
docker build --build-arg COMPONENT=web    -t registry.digitalocean.com/<reg>/model-fomo-web:$SHA .
docker build --build-arg COMPONENT=worker -t registry.digitalocean.com/<reg>/model-fomo-worker:$SHA .

kubectl create secret generic fomo-secrets \
  --from-literal=DO_MODEL_ACCESS_KEY=... \
  --from-literal=DATABASE_URL=... --from-literal=DBOS_SYSTEM_DATABASE_URL=... \
  --from-file=DATABASE_CA_CERT=ca.crt

helm upgrade --install fomo deploy/helm/model-fomo \
  --set image.tag=$SHA --set secrets.existingSecret=fomo-secrets \
  --set ingress.host=fomo.example.com
```

Minimum cost for one node (2 vCPU / 4 GB, $24) + load balancer ($12) + DOCR Basic ($5) is about $41/mo, before the database.
