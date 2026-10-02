#!/usr/bin/env bash
set -euo pipefail
forge_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
forge_tag="${FORGE_IMAGE_TAG:-dev}"
docker build -t "forge-tenant-web:$forge_tag" "$forge_root"
helm upgrade --install forge-tenant-web "$forge_root/charts/forge-tenant-web" \
  --kube-context orbstack --namespace "${FORGE_NAMESPACE:-forge-tenant}" --create-namespace \
  --set "image.tag=$forge_tag" --set-string "configRevision=$(date +%s)" --wait --timeout 180s
