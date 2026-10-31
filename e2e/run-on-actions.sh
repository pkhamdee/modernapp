#!/usr/bin/env bash
# Run the E2E smoke test (.github/workflows/e2e.yml) on GitHub Actions, on an on-demand runner on this machine.
#
#   e2e/run-on-actions.sh qa 0.3.0-rc.1        # QA's test of release candidate 0.3.0-rc.1 (what sign-off needs)
#   e2e/run-on-actions.sh                       # eshop-prod: https://prod.eshop.localhost
#   e2e/run-on-actions.sh prod 0.2.0            # eshop-prod, refusing unless it serves 0.2.0
#   e2e/run-on-actions.sh dev                   # eshop-dev: https://eshop.localhost
#
# Given a version, it first checks here that the environment serves it (e2e/check-serving.sh) and stops before
# registering anything if not; the job checks again before and after the test. The run is named
# `E2E <environment>[ <version>]` (e.g. `E2E qa 0.3.0-rc.1`), which is how sign-off finds it.
#
# The cluster is local, so the job must run here. The repository is public, so no runner stays registered:
# this registers an ephemeral runner (label `eshop-e2e` only, no default `self-hosted` label), dispatches the
# workflow to it, and the runner unregisters itself after that one job. On exit (also Ctrl-C) whatever is left
# is stopped, unregistered and deleted.
#
# Needs: gh (logged in, repo admin), curl, shasum, jq; kubectl pointed at the cluster (the job checks the served
# version with it); sops + the age key, so the job can decrypt the Staff account (no Staff secrets are stored in
# GitHub).
set -euo pipefail

REPO=pkhamdee/modernapp
LABEL=eshop-e2e
ENVIRONMENT=${1:-prod}
VERSION=${2:-}
CACHE=${ESHOP_E2E_RUNNER_CACHE:-$HOME/.cache/eshop-e2e-runner}

case "$ENVIRONMENT" in
  qa) [ -n "$VERSION" ] || { echo "a QA run needs the release candidate QA serves: e2e/run-on-actions.sh qa X.Y.Z-rc.N" >&2; exit 2; } ;;
  prod | dev) ;;
  *) echo "usage: e2e/run-on-actions.sh [prod|qa|dev] [version]   (environment, not a URL)" >&2; exit 2 ;;
esac
# The same check the job makes, so a wrong version stops here instead of in a run.
if [ -n "$VERSION" ]; then "$(dirname "$0")/check-serving.sh" "$ENVIRONMENT" "$VERSION"; fi
TITLE="E2E $ENVIRONMENT${VERSION:+ $VERSION}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORM=osx-arm64 ;;
  Darwin-x86_64) PLATFORM=osx-x64 ;;
  Linux-x86_64) PLATFORM=linux-x64 ;;
  Linux-aarch64) PLATFORM=linux-arm64 ;;
  *) echo "unsupported platform $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

# 1. The runner package, downloaded once per version and checked against the SHA-256 in its release notes.
release=$(gh api repos/actions/runner/releases/latest)
version=$(jq -r .tag_name <<<"$release" | sed 's/^v//')
tarball="$CACHE/actions-runner-$PLATFORM-$version.tar.gz"
if [ ! -f "$tarball" ]; then
  mkdir -p "$CACHE"
  expected=$(jq -r .body <<<"$release" | sed -n "s/.*BEGIN SHA $PLATFORM -->\([0-9a-f]\{64\}\).*/\1/p")
  [ -n "$expected" ] || { echo "no SHA-256 for $PLATFORM in runner v$version release notes" >&2; exit 1; }
  curl -fsSL -o "$tarball.part" \
    "https://github.com/actions/runner/releases/download/v$version/actions-runner-$PLATFORM-$version.tar.gz"
  echo "$expected  $tarball.part" | shasum -a 256 -c - >/dev/null
  mv "$tarball.part" "$tarball"
fi

# 2. A fresh runner directory per run, removed with the registration on exit.
dir=$(mktemp -d "$CACHE/run.XXXXXX")
name="$LABEL-$(hostname -s)-$(date +%s)"
runner_pid=
cleanup() {
  if [ -n "$runner_pid" ] && kill "$runner_pid" 2>/dev/null; then wait "$runner_pid" 2>/dev/null || true; fi
  if [ -f "$dir/.runner" ]; then
    removal=$(gh api -X POST "repos/$REPO/actions/runners/remove-token" --jq .token)
    (cd "$dir" && ./config.sh remove --token "$removal" >/dev/null 2>&1) || true
  fi
  id=$(gh api "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$name\") | .id")
  if [ -n "$id" ]; then gh api -X DELETE "repos/$REPO/actions/runners/$id" >/dev/null || true; fi
  rm -rf "$dir"
}
trap cleanup EXIT

tar -xzf "$tarball" -C "$dir"
token=$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)
(cd "$dir" && ./config.sh --unattended --ephemeral --no-default-labels --labels "$LABEL" --name "$name" \
  --url "https://github.com/$REPO" --token "$token" --work _work >/dev/null)

# setup-node and friends cache their downloads across runs here.
RUNNER_TOOL_CACHE="$CACHE/tool" "$dir/run.sh" >"$dir/runner.log" 2>&1 &
runner_pid=$!
until gh api "repos/$REPO/actions/runners" --jq ".runners[] | select(.name == \"$name\") | .status" | grep -q online; do
  kill -0 "$runner_pid" 2>/dev/null || { cat "$dir/runner.log" >&2; exit 1; }
  sleep 2
done
echo "runner $name online"

# 3. Dispatch the workflow to it and follow the run.
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run e2e.yml --repo "$REPO" --ref main -f environment="$ENVIRONMENT" -f version="$VERSION" -f runner="$LABEL"
run_id=
until [ -n "$run_id" ]; do
  sleep 3
  run_id=$(gh run list --repo "$REPO" --workflow e2e.yml --event workflow_dispatch --limit 5 \
    --json databaseId,createdAt,displayTitle \
    --jq "[.[] | select(.createdAt >= \"$since\" and .displayTitle == \"$TITLE\")] | last | .databaseId // empty")
done
echo "run https://github.com/$REPO/actions/runs/$run_id"
gh run watch "$run_id" --repo "$REPO" --interval 15 --exit-status
