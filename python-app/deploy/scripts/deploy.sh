#!/usr/bin/env bash
# Deploy O-Jester to a Kubernetes environment and verify it.
#
#   deploy/scripts/deploy.sh <staging|production> <image>   e.g. ghcr.io/org/o-jester:main-1a2b3c4d
#
# Requires kubectl (with built-in kustomize) and a KUBECONFIG pointing at the cluster.
# Steps: render the overlay with the exact image → server-side dry run → apply →
# wait for the rollout → smoke tests → automatic rollback if anything fails.
set -euo pipefail

ENVIRONMENT="${1:?usage: deploy.sh <staging|production> <image>}"
IMAGE="${2:?usage: deploy.sh <staging|production> <image>}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-6m}"

case "$ENVIRONMENT" in
  staging) NAMESPACE=o-jester-staging ;;
  production) NAMESPACE=o-jester ;;
  *) echo "Unknown environment: $ENVIRONMENT" >&2; exit 64 ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OVERLAY="$ROOT/deploy/k8s/overlays/$ENVIRONMENT"
RELEASE_DIR="$ROOT/deploy/k8s/.release/$ENVIRONMENT"
IMAGE_NAME="${IMAGE%:*}"
IMAGE_TAG="${IMAGE##*:}"

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

# 1. Pin the image for this release (a throw-away overlay on top of the environment).
mkdir -p "$RELEASE_DIR"
cat > "$RELEASE_DIR/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../overlays/$ENVIRONMENT
images:
  - name: ghcr.io/obblysfinanceltd-byte/o-jester
    newName: $IMAGE_NAME
    newTag: "$IMAGE_TAG"
EOF
kubectl kustomize "$RELEASE_DIR" > "$RELEASE_DIR/manifest.yaml"
log "Rendered $(grep -c '^kind:' "$RELEASE_DIR/manifest.yaml") resources for $ENVIRONMENT ($IMAGE)"

# 2. Pre-flight checks.
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl apply -f "$OVERLAY/namespace.yaml"
for secret in o-jester-secrets registry-pull; do
  if ! kubectl -n "$NAMESPACE" get secret "$secret" >/dev/null 2>&1; then
    if [ "$secret" = registry-pull ]; then
      echo "WARNING: secret '$secret' missing in $NAMESPACE — fine for a public image, required for a private registry." >&2
    else
      echo "ERROR: secret '$secret' missing in namespace $NAMESPACE (see deploy/README.md)." >&2
      exit 1
    fi
  fi
done
if [ "$ENVIRONMENT" = staging ] && ! kubectl -n "$NAMESPACE" get secret o-jester-postgres >/dev/null 2>&1; then
  echo "ERROR: secret 'o-jester-postgres' missing in $NAMESPACE (see deploy/README.md)." >&2
  exit 1
fi
log "Server-side dry run"
kubectl apply --dry-run=server -f "$RELEASE_DIR/manifest.yaml" >/dev/null

# 3. Apply and wait for the new pods (init containers create/upgrade the schema first).
log "Applying"
kubectl apply -f "$RELEASE_DIR/manifest.yaml"
if [ "$ENVIRONMENT" = staging ]; then
  kubectl -n "$NAMESPACE" rollout status statefulset/o-jester-postgres --timeout="$ROLLOUT_TIMEOUT"
fi

rollback() {
  echo "Deployment failed — rolling back to the previous version." >&2
  kubectl -n "$NAMESPACE" get pods -l app.kubernetes.io/component=web -o wide >&2 || true
  kubectl -n "$NAMESPACE" logs deploy/o-jester-web --all-containers --tail=50 >&2 || true
  kubectl -n "$NAMESPACE" rollout undo deployment/o-jester-web || true
  kubectl -n "$NAMESPACE" rollout status deployment/o-jester-web --timeout="$ROLLOUT_TIMEOUT" || true
  # The CronJobs were updated too — point them back at the image that is running again.
  local previous
  previous="$(kubectl -n "$NAMESPACE" get deployment/o-jester-web -o jsonpath='{.spec.template.spec.containers[?(@.name=="web")].image}')"
  if [ -n "$previous" ]; then
    kubectl -n "$NAMESPACE" set image cronjob/o-jester-refresh "refresh=$previous" || true
    kubectl -n "$NAMESPACE" set image cronjob/o-jester-scores "scores=$previous" || true
    echo "Restored CronJobs to $previous" >&2
  fi
  exit 1
}

log "Waiting for rollout"
kubectl -n "$NAMESPACE" rollout status deployment/o-jester-web --timeout="$ROLLOUT_TIMEOUT" || rollback

# 4. Smoke tests from inside a running pod (no public DNS needed).
log "Smoke tests"
smoke() {
  kubectl -n "$NAMESPACE" exec -i deploy/o-jester-web -c web -- python - <<'PY'
import sys, urllib.request
base = "http://127.0.0.1:5080"
checks = [("/api/health", 200, '"ok":true'), ("/api/ready", 200, '"database":"up"'), ("/legal", 200, "O-BBLYS"), ("/", 200, "18+")]
failed = 0
for path, status, needle in checks:
    try:
        with urllib.request.urlopen(base + path, timeout=10) as r:
            body = r.read().decode()
            ok = r.status == status and needle in body
    except Exception as exc:  # noqa: BLE001
        ok, body = False, str(exc)
    print(f"{'PASS' if ok else 'FAIL'}  {path}")
    failed += not ok
sys.exit(1 if failed else 0)
PY
}
smoke || rollback

log "Deployed $IMAGE to $ENVIRONMENT"
kubectl -n "$NAMESPACE" get deploy,pods,cronjobs -l app.kubernetes.io/name=o-jester
