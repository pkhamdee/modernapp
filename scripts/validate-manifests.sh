#!/usr/bin/env bash
# Validate every manifest Flux applies, the way Flux builds it, against Kubernetes and CRD schemas.
#
#   scripts/validate-manifests.sh     # needs kubectl (kustomize) and docker; CI runs it in the repo-rules job
#
# Each Flux Kustomization path (deploy/..., clusters/local/flux-system) is built with kustomize; the plain files
# in clusters/local, which Flux reads without a kustomization.yaml, are validated as they are. kubeconform
# checks Kubernetes kinds against the cluster's version and custom resources (Flux, Gateway API, cert-manager,
# CloudNativePG) against the datreeio CRDs-catalog. A kind with no schema anywhere fails; SOPS-encrypted
# Secrets validate as ordinary Secrets.
set -euo pipefail

K8S_VERSION=1.36.0 # k3s v1.36 (docs/setup.md)
KUBECONFORM=ghcr.io/yannh/kubeconform:v0.7.0

cd "$(git rev-parse --show-toplevel)"

# Every pinned environment (`# release-pin: <env>` lines in clusters/local) names one exact release.
# prod must stay pinned.
envs=$(grep -ho '# release-pin: [a-z]*$' clusters/local/*.yaml | sed 's/.* //' | sort -u)
grep -qx prod <<<"$envs" || { echo "prod has no '# release-pin: prod' lines in clusters/local" >&2; exit 1; }
while read -r env; do
  pin=$(scripts/pin-release.sh "$env")
  echo "release pin $env: $pin"
done <<<"$envs"

out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

for path in $(grep -h '^  path: ./' clusters/local/*.yaml | sed 's|.*path: \./||' | sort -u) clusters/local/flux-system; do
  [ -f "$path/kustomization.yaml" ] || continue # clusters/local itself: validated file by file below
  kubectl kustomize "$path" >"$out/$(tr / _ <<<"$path").yaml"
done
cp clusters/local/*.yaml "$out/"

docker run --rm -v "$out:/manifests:ro" "$KUBECONFORM" \
  -summary -output text \
  -kubernetes-version "$K8S_VERSION" \
  -skip CustomResourceDefinition \
  -schema-location default \
  -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' \
  /manifests
