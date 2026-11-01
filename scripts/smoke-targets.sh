#!/usr/bin/env bash
# What the smoke test (.github/workflows/e2e.yml) tests: one line per target, `<environment> <what it must serve>`
# (ADR 0008): a version for qa and prod, a full main commit for dev. Run in a clone of the repository that has the
# commits named and origin/main fetched.
#
#   scripts/smoke-targets.sh push <before> <after>   # a push to main, its before and after commits
#   -> dev 3f2c...                                    #   dev at the pushed commit
#   scripts/smoke-targets.sh dispatch dev [commit]    # a manual run: main's head, or that main commit
#   scripts/smoke-targets.sh dispatch qa X.Y.Z-rc.N   #   QA's candidate (required: sign-off names the run by it)
#   scripts/smoke-targets.sh dispatch prod [X.Y.Z]    #   prod's pin on main when not given
#
# A push to main means dev at the pushed commit, whatever it changed: Flux deploys every main commit to eshop-dev,
# its own image-update commits included. The lines are the job matrix; e2e.yml waits for each environment to
# serve its target (e2e/check-serving.sh --wait) and records the result as a Deployment (scripts/deployment.sh).
# Exit 1: a commit or pin it can't find; 2: bad arguments. Tests: scripts/tests/release-scripts.sh.
set -euo pipefail
# shellcheck source=lib/versions.sh
. "$(dirname "$0")/lib/versions.sh"

usage() {
  [ $# -eq 0 ] || echo "smoke-targets.sh: $*" >&2
  echo "usage: scripts/smoke-targets.sh push <before> <after>   |   scripts/smoke-targets.sh dispatch" \
    "dev [commit] | qa X.Y.Z-rc.N | prod [X.Y.Z]" >&2
  exit 2
}

commit() { # commit <rev>: its full SHA, or fail naming it
  git rev-parse --verify --quiet "$1^{commit}" || { echo "smoke-targets.sh: no commit '$1' here" >&2; exit 1; }
}

case "${1:-} ${2:-}" in
  "push "*)
    [ $# -eq 3 ] || usage
    after=$(commit "$3")
    # The seam for the pinned environments (#88): a push that changes a `# release-pin: <env>` line between
    # <before> and <after> will mean that environment at the newly pinned version (a line each, so a push moving
    # both pins tests both), and a push changing nothing but pins will not test dev, whose deploy it doesn't
    # change. Until then every push is dev's.
    only_pins=false
    $only_pins || echo "dev $after"
    ;;
  "dispatch dev")
    [ $# -le 3 ] || usage
    echo "dev $(commit "${3:-origin/main}")"
    ;;
  "dispatch qa" | "dispatch prod")
    [ $# -le 3 ] || usage
    env=$2 version=${3:-}
    if [ -z "$version" ] && [ "$env" = prod ]; then
      # main's pin, whatever branch the workflow was dispatched from.
      pins=$(mktemp -d)
      trap 'rm -rf "$pins"' EXIT
      git archive origin/main clusters/local | tar -x -C "$pins"
      version=$(PIN_DIR="$pins/clusters/local" "$(dirname "$0")/pin-release.sh" prod)
    fi
    env_takes "$env" "$version" || usage "$env takes $(env_grammar "$env"), not '$version'"
    echo "$env $version"
    ;;
  *) usage ;;
esac
