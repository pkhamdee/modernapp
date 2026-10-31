#!/usr/bin/env bash
# Is the environment actually serving this release (candidate)? Asks the cluster, not Git: the pin in
# clusters/local/<env>-release.yaml says what should run, this says what does.
#
#   e2e/check-serving.sh qa 0.3.0-rc.1      # exit 0: eshop-qa serves 0.3.0-rc.1 (prints the evidence)
#   e2e/check-serving.sh prod 0.2.0         # exit 1: not serving it, and why (stderr); exit 2: bad arguments
#
# Serving X means all of:
#   - Flux Kustomization apps-<env> is not suspended, has applied its latest spec, is Ready, its last applied
#     revision is the tag vX@sha1:..., and every image it sets (spec.images) has tag X;
#   - every Deployment in eshop-<env> has finished rolling out (no old pod left) and every eShop image
#     (docker.io/pkhamdee/...) it runs has tag X.
# The e2e workflow (.github/workflows/e2e.yml) runs this before and after a test run given a version, and sign-off
# relies on that (docs/setup.md, "End-to-end smoke test"). Needs kubectl (pointed at the cluster) and jq.
# Tests: e2e/check-serving.test.sh.
set -euo pipefail

env=${1:-}
version=${2:-}
ns=eshop-$env

usage() { echo "check-serving.sh: $*" >&2; echo "usage: e2e/check-serving.sh qa X.Y.Z-rc.N | prod X.Y.Z" >&2; exit 2; }
case "$env" in
  qa) [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$ ]] || usage "qa takes a release candidate X.Y.Z-rc.N, not '$version'" ;;
  prod) [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage "prod takes a release X.Y.Z, not '$version'" ;;
  dev) usage "dev follows main and has no release to check" ;;
  *) usage "unknown environment '$env'" ;;
esac

refuse() { echo "$ns is not serving $version: $*" >&2; exit 1; }

err=$(mktemp)
trap 'rm -f "$err"' EXIT
kustomization=$(kubectl -n flux-system get kustomization "apps-$env" -o json 2>"$err") ||
  refuse "no Kustomization apps-$env on this cluster ($(cat "$err"))"

field() { jq -r "$@" <<<"$kustomization"; }

[ "$(field '.spec.suspend // false')" = false ] ||
  refuse "apps-$env is suspended (the environment has no release yet, or Flux was paused)"
[ "$(field '.metadata.generation')" = "$(field '.status.observedGeneration // 0')" ] ||
  refuse "apps-$env has a change Flux has not applied yet (a promotion in progress); try again once it is Ready"
ready=$(field '.status.conditions[]? | select(.type == "Ready") | "\(.status): \(.message)"')
[[ "$ready" == "True: "* ]] || refuse "apps-$env is not Ready: ${ready#*: }"
revision=$(field '.status.lastAppliedRevision // ""')
[[ "$revision" == "v$version@sha1:"* ]] || refuse "apps-$env applied ${revision:-nothing yet}"
# shellcheck disable=SC2016 # $v is a jq variable
others=$(field --arg v "$version" '.spec.images[]? | select(.newTag != $v) | "\(.name):\(.newTag)"')
[ -z "$others" ] || refuse "apps-$env sets $(paste -sd ' ' - <<<"$others")"

deployments=$(kubectl -n "$ns" get deployment -o json 2>"$err") || refuse "cannot list Deployments ($(cat "$err"))"
[ "$(jq '.items | length' <<<"$deployments")" -gt 0 ] || refuse "no Deployments in $ns"
# Every eShop image (docker.io/pkhamdee/...) is the release's tag, and every Deployment has finished rolling out:
# its newest spec observed, all its pods updated and ready, and no old pod left.
problems=$(jq -r --arg v "$version" '.items[] | .metadata.name as $d
  | ([(.spec.template.spec.initContainers // []) + .spec.template.spec.containers | .[].image
      | select(startswith("docker.io/pkhamdee/")) | select(test(":" + ($v | gsub("\\."; "\\.")) + "(@|$)") | not)
      | "\($d) runs \(.)"]
    + (.status as $s | .spec.replicas as $r
      | if ($s.observedGeneration // 0) < .metadata.generation or ($s.replicas // 0) != $r
           or ($s.updatedReplicas // 0) != $r or ($s.readyReplicas // 0) != $r or ($s.availableReplicas // 0) != $r
        then ["\($d) has not finished rolling out (\($s.updatedReplicas // 0) updated, \($s.readyReplicas // 0) ready, \($s.replicas // 0) pods, \($r) wanted)"]
        else [] end))[]' <<<"$deployments")
[ -z "$problems" ] || refuse "$(paste -sd ';' - <<<"$problems" | sed 's/;/; /g')"

echo "$ns serves $version"
echo "apps-$env applied $revision"
jq -r '.items[] | .metadata.name as $d | .spec.template.spec.containers[] | "\($d): \(.image)"' <<<"$deployments"
