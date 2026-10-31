# shellcheck shell=bash
# The version grammar of releases (docs/git-workflow.md, "Tags"), defined once; sourced by the release scripts and
# e2e/check-serving.sh, never run. Versions here carry no `v`: the tag of version X is vX.
#
#   X.Y.Z          a release: made only by sign-off; what prod runs
#   X.Y.Z-rc.N     a release candidate: cut by scripts/release.sh; what QA runs
#   0.0.0-test.N   a release dry run's version (CI, workflow_dispatch): built and pushed, never pinned or deployed
#
# CANDIDATE's groups, for [[ =~ ]]: 1 X.Y.Z, 2 X, 3 Y, 4 Z, 5 N.
RELEASE='^[0-9]+\.[0-9]+\.[0-9]+$'
CANDIDATE='^(([0-9]+)\.([0-9]+)\.([0-9]+))-rc\.([0-9]+)$'
DRY_RUN='^0\.0\.0-test\.[0-9]+$'

is_release() { [[ "$1" =~ $RELEASE ]]; }
is_candidate() { [[ "$1" =~ $CANDIDATE ]]; }
is_dry_run() { [[ "$1" =~ $DRY_RUN ]]; }
# What an environment's pin may hold: a release or a release candidate.
is_pinnable() { is_release "$1" || is_candidate "$1"; }
# env_takes <env> <version>: QA runs release candidates, prod runs releases; no other environment is pinned.
env_takes() {
  case "$1" in
    qa) is_candidate "$2" ;;
    prod) is_release "$2" ;;
    *) return 1 ;;
  esac
}
# What each environment takes, for messages: env_grammar qa -> X.Y.Z-rc.N
env_grammar() {
  case "$1" in
    qa) echo "a release candidate X.Y.Z-rc.N" ;;
    prod) echo "a release X.Y.Z" ;;
    *) echo "nothing: only qa and prod are pinned to a release" ;;
  esac
}
# The release a candidate leads to: release_of 0.3.0-rc.2 -> 0.3.0
release_of() { echo "${1%-rc.*}"; }
