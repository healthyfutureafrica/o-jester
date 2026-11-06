# O-Jester — Kubernetes deployment & CI/CD

```
GitHub (main) ──► Jenkins ──► tests ─► security audit ─► validate manifests ─► build & push image
                                                                         │
                         ┌───────────────────────────────────────────────┘
                         ▼
                 STAGING (beta) ──► smoke tests ──► manual approval ──► PRODUCTION ──► smoke tests
                 o-jester-staging                                       o-jester       (auto-rollback)
```

## What runs in the cluster

| Resource | Purpose |
|---|---|
| `Deployment/o-jester-web` | The website, 2+ replicas (Waitress). Two init containers run first: `wait-db` waits for the database, then `migrate` creates the tables and the admin account. Rolling updates have zero downtime. Probes: `/api/health` (liveness) and `/api/ready` (readiness, also checks the database). |
| `Service/o-jester-web` + `Ingress/o-jester` | Public HTTPS entry. The cluster's default IngressClass is used, and cert-manager issues TLS certificates. |
| `CronJob/o-jester-refresh` | Every 3 h (Africa/Douala time). Fetches real fixtures, makes predictions, runs the optional AI, builds the combos and settles results. Runs **exactly once**, however many web pods exist. |
| `CronJob/o-jester-scores` | Every 15 min: live scores and settlement. It only calls the data provider while matches are in play. |
| `HorizontalPodAutoscaler` | Scales the web pods from 2 to 6 on CPU and memory (needs metrics-server). |
| `PodDisruptionBudget` | Keeps the site up during node maintenance. |
| `NetworkPolicy` | **Production:** web pods only accept port 5080, and job pods accept no inbound traffic. **Staging:** only O-Jester pods can reach the database. |
| `StatefulSet/o-jester-postgres` | **Staging only:** in-cluster PostgreSQL on a 5 Gi volume. Production uses a managed database. |

Security settings on every pod:

- runs as a non-root user (uid 10001);
- read-only root filesystem;
- all Linux capabilities dropped, plus the seccomp `RuntimeDefault` profile;
- namespaces enforce the **restricted** Pod Security Standard;
- no Kubernetes API token is mounted.

```
deploy/
├── k8s/
│   ├── base/                  shared resources + config.env (non-secret settings)
│   ├── components/postgres/   in-cluster PostgreSQL (staging / self-hosting)
│   ├── overlays/staging/      beta: 1 replica, BETA_MODE, sandbox payments, beta.<domain>
│   ├── overlays/production/   launch: managed DB, real payments, <domain>
│   └── secrets.example.env    template for the o-jester-secrets Secret
└── scripts/deploy.sh          render → dry-run → apply → rollout → smoke tests → rollback on failure
Jenkinsfile                    the CI/CD pipeline
jenkins/agent-pod.yaml         build agent pod (python + kaniko)
```

---

## 1. Cluster prerequisites (once)

- Kubernetes **1.27 or newer** (needed for CronJob `timeZone`). Any managed service works: DigitalOcean, Linode, AWS EKS, Google GKE, Azure AKS, or a self-hosted k3s.
- An **ingress controller** set as the default IngressClass. Traefik (bundled with k3s) or your cloud's load-balancer controller both work.
- **cert-manager**, with a `ClusterIssuer` named `letsencrypt-prod`. If you use another TLS approach, change the annotation in `base/ingress.yaml`.
- **metrics-server**, for autoscaling. It's preinstalled on most managed clusters.
- A **managed PostgreSQL** database for production.
- **DNS** (Hostinger → Domains → o-jester.com → DNS): point `www.o-jester.com`, `o-jester.com` and `beta.o-jester.com` at the ingress load balancer's IP. The hosts are already set in `base/ingress.yaml` (production) and `overlays/staging` (beta).

## 2. Secrets (once per environment — never committed to git)

```bash
# Image pull secret (the GHCR image is private):
#   create a GitHub personal access token with read:packages
kubectl create namespace o-jester-staging
kubectl -n o-jester-staging create secret docker-registry registry-pull \
  --docker-server=ghcr.io --docker-username=<github-user> --docker-password=<token>

# Staging database credentials (in-cluster PostgreSQL)
kubectl -n o-jester-staging create secret generic o-jester-postgres \
  --from-literal=POSTGRES_USER=ojester --from-literal=POSTGRES_DB=ojester \
  --from-literal=POSTGRES_PASSWORD="$(openssl rand -hex 24)"

# App secrets: copy deploy/k8s/secrets.example.env → deploy/k8s/secrets.staging.env (git-ignored), fill in, then:
kubectl -n o-jester-staging create secret generic o-jester-secrets --from-env-file=deploy/k8s/secrets.staging.env
```

Repeat for the `o-jester` namespace (production), using your managed `DATABASE_URL`, live payment keys and `secrets.production.env`. Production doesn't need the `o-jester-postgres` secret.

To change a secret later:

```bash
kubectl -n <ns> create secret generic o-jester-secrets --from-env-file=… --dry-run=client -o yaml | kubectl apply -f -
kubectl -n <ns> rollout restart deployment/o-jester-web
```

## 3. Jenkins setup (once)

1. **Plugins:** Pipeline, Kubernetes, Git, GitHub Branch Source, Credentials Binding, JUnit, Timestamper.
2. **Kubernetes cloud:** in *Manage Jenkins → Clouds*, point Jenkins at a cluster where build agents can run.
3. **Registry push credentials for kaniko:** in the agents' namespace, run:
   ```bash
   kubectl -n <jenkins-agents-ns> create secret docker-registry registry-credentials \
     --docker-server=ghcr.io --docker-username=<github-user> --docker-password=<token with write:packages>
   ```
4. **Credentials:** in *Manage Jenkins → Credentials*, add two *Secret file* entries, one kubeconfig per environment:
   - `kubeconfig-staging`
   - `kubeconfig-production`

   Use a ServiceAccount kubeconfig limited to that namespace rather than a cluster-admin one.
5. **Pipeline job:** create *New Item → Multibranch Pipeline* and add the GitHub source `obblysfinanceltd-byte/o-jester`. The script path is `Jenkinsfile`. Add a GitHub webhook to `https://<jenkins>/github-webhook/` so every push triggers a build.
6. **Approvers:** the production approval step accepts the Jenkins users or groups `admin` and `release-managers`. Edit `submitter` in the `Jenkinsfile` to match your users.

### What the pipeline does

| Branch | Stages |
|---|---|
| Any branch / pull request | Checkout → unit tests (JUnit report) → `pip-audit` → render & validate both overlays → **build** the image (not pushed) |
| `main` | All of the above, then push `ghcr.io/obblysfinanceltd-byte/o-jester:main-<sha>` and `:latest` → **deploy to staging** with smoke tests → **wait for approval** → **deploy to production** with smoke tests |

`deploy.sh` rolls back automatically (`kubectl rollout undo`) if the rollout or the smoke tests fail.

## 4. Deploy by hand (without Jenkins)

```bash
docker build -t ghcr.io/obblysfinanceltd-byte/o-jester:manual-1 .
docker push ghcr.io/obblysfinanceltd-byte/o-jester:manual-1
bash deploy/scripts/deploy.sh staging ghcr.io/obblysfinanceltd-byte/o-jester:manual-1
```

## 5. Day-2 operations

```bash
kubectl -n o-jester get pods,cronjobs,hpa
kubectl -n o-jester logs deploy/o-jester-web -f
kubectl -n o-jester create job refresh-now --from=cronjob/o-jester-refresh   # fetch data immediately
kubectl -n o-jester rollout undo deployment/o-jester-web                     # roll back
kubectl -n o-jester exec deploy/o-jester-web -c web -- python manage.py create-admin you@example.com "NewPassword"
```

**Database backups:**

- **Production:** use your managed provider's automated backups.
- **Staging:**
  ```bash
  kubectl -n o-jester-staging exec o-jester-postgres-0 -- pg_dump -U ojester ojester > backup.sql
  ```

**Schema changes:** the `migrate` init container only *creates* missing tables. If a future release changes an existing table, add a migration tool (Alembic) before deploying it.
