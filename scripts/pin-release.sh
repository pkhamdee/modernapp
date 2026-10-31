#!/usr/bin/env bash
# Read or change the release an environment is pinned to (docs/git-workflow.md, "Promotion and rollback").
#
#   scripts/pin-release.sh prod              # prints prod's pinned release, e.g. 0.2.0
#   scripts/pin-release.sh prod 0.2.1        # pins prod to 0.2.1: the edit a promotion (or rollback) PR makes
#   scripts/pin-release.sh qa 0.3.0-rc.1     # release candidates too
#   scripts/pin-release.sh --suspended qa    # exit 0: qa has no release yet (suspended); 1: it has one; 2: no pin
#
# The pin is every line in clusters/local/*.yaml ending in `# release-pin: <env>`: the environment's
# GitRepository `ref.semver` (the source at tag vX.Y.Z) and each `newTag` of its Kustomization's images (the
# X.Y.Z images). They always hold the same exact version, so the release's manifests and images never diverge.
# Reading fails if the lines are missing, disagree, or hold anything but an exact X.Y.Z or X.Y.Z-rc.N
# (scripts/lib/versions.sh).
#
# An environment with no release yet (QA before its first release candidate) also has a `suspend: true` line
# ending in `# release-pin-until: <env>`: its pin is only a placeholder and Flux deploys nothing. Reading says so
# on stderr, and --suspended answers it; pinning a version deletes that line, so the first promotion also starts the
# environment. PIN_DIR overrides the folder (tests, sign-off reading main's pins).
set -euo pipefail
# shellcheck source=lib/versions.sh
. "$(dirname "$0")/lib/versions.sh"

usage() { echo "usage: scripts/pin-release.sh <env> [X.Y.Z | X.Y.Z-rc.N]   |   scripts/pin-release.sh --suspended <env>" >&2; exit 2; }
ask_suspended=false
if [ "${1:-}" = --suspended ]; then ask_suspended=true; shift; fi
env=${1:-}
version=${2:-}
[[ "$env" =~ ^[a-z]+$ ]] || usage
if $ask_suspended && [ -n "$version" ]; then usage; fi

dir=${PIN_DIR:-"$(git rev-parse --show-toplevel)/clusters/local"}
marker="# release-pin: $env"
until="# release-pin-until: $env"
files=$(grep -l -- "$marker\$" "$dir"/*.yaml || true)
if [ -z "$files" ]; then
  echo "no '$marker' lines in $dir" >&2
  if $ask_suspended; then exit 2; else exit 1; fi
fi

# shellcheck disable=SC2086 # $files is a list of paths without spaces
suspended() { grep -q -- " $until\$" $files; }
if $ask_suspended; then
  suspended
  exit
fi

if [ -n "$version" ]; then
  is_pinnable "$version" || usage
  for f in $files; do
    sed -E -e "s|: \"?[^\" #]*\"? +$marker\$|: \"$version\" $marker|" -e "/ $until\$/d" "$f" >"$f.pin"
    mv "$f.pin" "$f"
  done
fi

# shellcheck disable=SC2086 # $files is a list of paths without spaces
values=$(grep -h -- "$marker\$" $files | sed -E "s|.*: \"?([^\" #]*)\"? +$marker\$|\1|" | sort -u)
if [ "$(wc -l <<<"$values")" -ne 1 ] || ! is_pinnable "$values"; then
  echo "$env is not pinned to one exact release; '$marker' lines hold:" >&2
  echo "$values" >&2
  exit 1
fi
if suspended; then
  echo "$env has no release yet: its Kustomization is suspended and $values is a placeholder (not deployed)" >&2
fi
echo "$values"
