#!/usr/bin/env bash
# Read or change the release an environment is pinned to (docs/git-workflow.md, "Promotion and rollback").
#
#   scripts/pin-release.sh prod            # prints prod's pinned release, e.g. 0.2.0
#   scripts/pin-release.sh prod 0.2.1      # pins prod to 0.2.1: the edit a promotion (or rollback) PR makes
#   scripts/pin-release.sh qa 0.3.0-rc.1   # release candidates too
#
# The pin is every line in clusters/local/*.yaml ending in `# release-pin: <env>`: the environment's
# GitRepository `ref.semver` (the source at tag vX.Y.Z) and each `newTag` of its Kustomization's images (the
# X.Y.Z images). They always hold the same exact version, so the release's manifests and images never diverge.
# Reading fails if the lines are missing, disagree, or hold anything but an exact X.Y.Z or X.Y.Z-rc.N.
#
# An environment with no release yet (QA before its first release candidate) also has a `suspend: true` line
# ending in `# release-pin-until: <env>`: its pin is only a placeholder and Flux deploys nothing. Reading says so
# on stderr; pinning a version deletes that line, so the first promotion also starts the environment.
# PIN_DIR overrides the folder (tests).
set -euo pipefail

usage() { echo "usage: scripts/pin-release.sh <env> [X.Y.Z | X.Y.Z-rc.N]" >&2; exit 2; }
env=${1:-}
version=${2:-}
[[ "$env" =~ ^[a-z]+$ ]] || usage
exact='^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$'

dir=${PIN_DIR:-"$(git rev-parse --show-toplevel)/clusters/local"}
marker="# release-pin: $env"
until="# release-pin-until: $env"
files=$(grep -l -- "$marker\$" "$dir"/*.yaml || true)
[ -n "$files" ] || { echo "no '$marker' lines in $dir" >&2; exit 1; }

if [ -n "$version" ]; then
  [[ "$version" =~ $exact ]] || usage
  for f in $files; do
    sed -E -e "s|: \"?[^\" #]*\"? +$marker\$|: \"$version\" $marker|" -e "/ $until\$/d" "$f" >"$f.pin"
    mv "$f.pin" "$f"
  done
fi

# shellcheck disable=SC2086 # $files is a list of paths without spaces
values=$(grep -h -- "$marker\$" $files | sed -E "s|.*: \"?([^\" #]*)\"? +$marker\$|\1|" | sort -u)
if [ "$(wc -l <<<"$values")" -ne 1 ] || ! [[ "$values" =~ $exact ]]; then
  echo "$env is not pinned to one exact release; '$marker' lines hold:" >&2
  echo "$values" >&2
  exit 1
fi
# shellcheck disable=SC2086 # $files is a list of paths without spaces
if grep -q -- " $until\$" $files; then
  echo "$env has no release yet: its Kustomization is suspended and $values is a placeholder (not deployed)" >&2
fi
echo "$values"
