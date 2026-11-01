# shellcheck shell=bash
# QA's evidence for sign-off (docs/git-workflow.md, "Sign-off"), read from origin/main and GitHub's Deployments, one
# way for scripts/sign-off-pr.sh (which opens the sign-off PR) and scripts/sign-off.sh (which re-checks at merge).
# Sourced after lib/repo.sh, in a clone with origin/main fetched; never run.
#
#   gh_read <gh args...>        gh with SIGN_OFF_READ_TOKEN when set (a workflow's own token may read Deployments,
#                               runs and PRs), else gh's own token
#   qa_pin                      prints the candidate origin/main pins eshop-qa to. Exit 1: its pin is unreadable;
#                               3: apps-qa is suspended (QA runs no candidate yet)
#   qa_pinned_at                prints when origin/main last changed a `# release-pin: qa` line, UTC (on main's
#                               first-parent line, so a promotion PR counts from its merge); empty when never
#   qa_deployment <candidate> <since>
#                               prints QA's latest Deployment of tag v<candidate> created at or after <since>, as
#                               `{id, created_at, state, description, log_url}` (its latest status); nothing when
#                               there is none. An older one tested an earlier deployment (rc.1 -> rc.2 -> rc.1)
gh_read() { if [ -n "${SIGN_OFF_READ_TOKEN:-}" ]; then GH_TOKEN=$SIGN_OFF_READ_TOKEN gh "$@"; else gh "$@"; fi; }

qa_pin() {
  local pins status=0 suspended=0 version=""
  pins=$(mktemp -d)
  git archive origin/main clusters/local | tar -x -C "$pins"
  PIN_DIR="$pins/clusters/local" "$(dirname "${BASH_SOURCE[0]}")/../pin-release.sh" --suspended qa 2>/dev/null \
    || suspended=$?
  case "$suspended" in
    0) status=3 ;;
    1) version=$(PIN_DIR="$pins/clusters/local" "$(dirname "${BASH_SOURCE[0]}")/../pin-release.sh" qa 2>/dev/null) \
         || status=1 ;;
    *) status=1 ;;
  esac
  rm -rf "$pins"
  [ "$status" -ne 0 ] || echo "$version"
  return "$status"
}

qa_pinned_at() {
  TZ=UTC git log -1 --first-parent -m -G '# release-pin(-until)?: qa$' \
    --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd origin/main -- clusters/local
}

qa_deployment() {
  local found id created
  # The newest 30 of the tag's Deployments to qa are plenty: each is one smoke test of it.
  found=$(gh_read api "repos/$REPO/deployments?environment=qa&ref=v$1&per_page=30" \
    --jq "[.[] | select(.created_at >= \"$2\")][0] // empty | \"\(.id) \(.created_at)\"") || return 1
  [ -n "$found" ] || return 0
  read -r id created <<<"$found"
  gh_read api "repos/$REPO/deployments/$id/statuses?per_page=1" \
    --jq "(.[0] // {}) | {id: $id, created_at: \"$created\", state: (.state // \"pending\"),
          description: (.description // \"\"), log_url: (.log_url // \"\")}"
}
