#!/usr/bin/env bash
# A smoke test's GitHub Deployment (ADR 0008): the record of which version or commit was tested in which environment,
# and how that went. e2e.yml makes one per target (scripts/smoke-targets.sh).
#
#   scripts/deployment.sh start <env> <ref> <log_url> <environment_url>
#       creates the Deployment of <ref> (a tag vX.Y.Z[-rc.N] or a main commit) to <env> (dev, qa or prod), in
#       progress, and prints its id
#   scripts/deployment.sh finish <id> success|failure|inactive <log_url> <environment_url> [description]
#       its outcome: success or failure, or inactive when a newer run superseded it (description `superseded`).
#       On success the environment's earlier successful Deployments become inactive, `replaced by <ref>`: the
#       environment no longer serves them (a promotion, or a rollback to an earlier release)
#   scripts/deployment.sh supersede <env> <id>
#       marks every other in-progress Deployment of <env> inactive, `superseded`: one run tests an environment at a
#       time (e2e.yml's concurrency), so any other still in progress belongs to a run that is gone
#
# Created through the Deployments API rather than a job's `environment:` key, which would record the workflow's
# ref (main) instead of what was tested. auto_merge is off (GitHub would otherwise merge main into the ref) and no
# commit status is required. GitHub's own auto_inactive skips production environments, so finish marks the earlier
# successful ones inactive itself rather than rely on how GitHub classifies qa and prod. Needs gh with Deployments write access (GITHUB_TOKEN: `deployments: write`).
# Tests: scripts/tests/release-scripts.sh.
set -euo pipefail
# shellcheck source=lib/repo.sh
. "$(dirname "$0")/lib/repo.sh"

usage() {
  echo "usage: scripts/deployment.sh start <dev|qa|prod> <ref> <log_url> <environment_url>" \
    "| finish <id> <success|failure|inactive> <log_url> <environment_url> [description]" \
    "| supersede <dev|qa|prod> <id>" >&2
  exit 2
}
is_env() { [[ "$1" =~ ^(dev|qa|prod)$ ]]; }
is_id() { [[ "$1" =~ ^[0-9]+$ ]]; }

# status <id> <state> [log_url] [environment_url] [description]: adds a status (the description cut to GitHub's 140)
status() {
  jq -n --arg state "$2" --arg log "${3:-}" --arg url "${4:-}" --arg d "${5:-}" \
    '{state: $state} + (if $log != "" then {log_url: $log} else {} end)
     + (if $url != "" then {environment_url: $url} else {} end)
     + (if $d != "" then {description: $d[0:140]} else {} end)' \
    | gh api "repos/$REPO/deployments/$1/statuses" --method POST --input - >/dev/null
}

case "${1:-}" in
  start)
    { [ $# -eq 5 ] && is_env "$2"; } || usage
    id=$(jq -n --arg ref "$3" --arg env "$2" \
        '{ref: $ref, environment: $env, auto_merge: false, required_contexts: [],
          description: "smoke test of \($ref) on \($env)"}' \
      | gh api "repos/$REPO/deployments" --method POST --input - --jq .id)
    status "$id" in_progress "$4" "$5"
    echo "$id"
    ;;
  finish)
    { [[ $# =~ ^[56]$ ]] && is_id "$2" && [[ "$3" =~ ^(success|failure|inactive)$ ]]; } || usage
    status "$2" "$3" "$4" "$5" "${6:-}"
    [ "$3" = success ] || exit 0
    # The environment now serves this ref: its earlier successful Deployments no longer describe it.
    read -r env ref < <(gh api "repos/$REPO/deployments/$2" --jq '"\(.environment) \(.ref)"')
    for id in $(gh api "repos/$REPO/deployments?environment=$env&per_page=30" --jq '.[].id'); do
      [ "$id" -lt "$2" ] || continue
      state=$(gh api "repos/$REPO/deployments/$id/statuses?per_page=1" --jq '.[0].state // ""')
      [ "$state" = success ] || continue
      status "$id" inactive "" "" "replaced by $ref"
    done
    ;;
  supersede)
    { [ $# -eq 3 ] && is_env "$2" && is_id "$3"; } || usage
    # The newest 30 are plenty: older ones were superseded by earlier runs.
    for id in $(gh api "repos/$REPO/deployments?environment=$2&per_page=30" --jq '.[].id'); do
      [ "$id" != "$3" ] || continue
      state=$(gh api "repos/$REPO/deployments/$id/statuses?per_page=1" --jq '.[0].state // ""')
      [ "$state" = in_progress ] || continue
      status "$id" inactive "" "" superseded
      echo "Deployment $id of $2 was still in progress: marked inactive, superseded" >&2
    done
    ;;
  *) usage ;;
esac
