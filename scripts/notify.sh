#!/usr/bin/env bash
# Emails a smoke test's result (ADR 0008; e2e.yml's notify job): which environment, what it was testing, how it went,
# and links to the run and its Playwright report.
#
#   scripts/notify.sh <env> <target> <result> [deployment id]
#       <env> <target>   a line of scripts/smoke-targets.sh: qa X.Y.Z-rc.N, prod X.Y.Z, or dev <main commit>
#       <result>         passed, retried (passed, but only on a retry), failed, or not-deployed (the environment
#                        never served the target, so nothing was tested)
#       deployment id    the run's Deployment of the target (scripts/deployment.sh), when it got that far: dev and
#                        prod look at the Deployments before it
#
# Who gets what:
#   - qa and prod: every result;
#   - dev: a failure (failed or not-deployed), and the first pass after one, judged from dev's previous Deployment
#     with an outcome (success or failure; one superseded or cancelled tested nothing). Any other dev pass: no email.
# A prod failure names the last release whose prod Deployment succeeded and how to roll back to it: a promotion PR,
# scripts/promotion-pr.sh prod <version> (its commit is scripts/pin-release.sh prod <version>).
#
# Settings from the environment (e2e.yml: repository variables SMTP_USERNAME and NOTIFY_EMAIL, secret SMTP_PASSWORD
# of environment smoke-test; docs/setup.md, "Smoke test email"):
#   SMTP_USERNAME   the sending account (Gmail), also the From address
#   SMTP_PASSWORD   its app password: handed to curl on stdin (--config -), never on its command line or printed
#   NOTIFY_EMAIL    the recipient; several separated by commas
#   SMTP_URL        default smtps://smtp.gmail.com:465 (TLS from the start; --ssl-reqd refuses anything less)
#   RUN_URL         the run; REPORT_URL the Playwright report artifact (default: the run, which lists it)
#   DETAIL          why it failed (the Deployment's description); RETRIED_FILE the tests that passed only on retry
# A missing setting is an error (exit 1, naming it) checked before anything else, whether or not an email is due:
# the notify step fails visibly. The Deployment is already finished by then, and this never changes it.
# Needs gh with Deployments read access (GITHUB_TOKEN: `deployments: read`), jq and curl.
# Tests: scripts/tests/release-scripts.sh (fake gh and curl: no email is sent).
set -euo pipefail
# shellcheck source=lib/repo.sh
. "$(dirname "$0")/lib/repo.sh"
# shellcheck source=lib/versions.sh
. "$(dirname "$0")/lib/versions.sh"

usage() {
  [ $# -eq 0 ] || echo "notify.sh: $*" >&2
  echo "usage: scripts/notify.sh qa X.Y.Z-rc.N | prod X.Y.Z | dev <commit>  passed|retried|failed|not-deployed" \
    "[deployment id]" >&2
  exit 2
}
[[ $# =~ ^[34]$ ]] || usage
env=$1 target=$2 result=$3 id=${4:-}
case "$env" in
  dev) [[ "$target" =~ ^[0-9a-f]{40}$ ]] || usage "dev takes a full commit SHA, not '$target'" ;;
  *) env_takes "$env" "$target" || usage "$env takes $(env_grammar "$env"), not '$target'" ;;
esac
[[ "$result" =~ ^(passed|retried|failed|not-deployed)$ ]] || usage "unknown result '$result'"
[[ "$id" =~ ^[0-9]*$ ]] || usage "a Deployment id is a number, not '$id'"

missing=()
for setting in SMTP_USERNAME SMTP_PASSWORD NOTIFY_EMAIL; do [ -n "${!setting:-}" ] || missing+=("$setting"); done
if [ ${#missing[@]} -gt 0 ]; then
  echo "notify.sh: no ${missing[*]}: can't email the $env result (docs/setup.md, \"Smoke test email\")" >&2
  exit 1
fi
RUN_URL=${RUN_URL:-}
REPORT_URL=${REPORT_URL:-$RUN_URL}

# last_outcome <env> <state regex> [ref to skip]: the newest Deployment of <env> before this run's whose outcome
# matches, as "<ref> success|failure"; nothing if none. The outcome is failure or success from any of its statuses
# (one marked inactive afterwards, `replaced by`, had succeeded first); one with neither (superseded, cancelled)
# tested nothing and is skipped. The newest 30 are plenty.
last_outcome() {
  local d state
  for d in $(gh api "repos/$REPO/deployments?environment=$1&per_page=30" --jq '.[] | "\(.id)/\(.ref)"'); do
    [ -z "$id" ] || [ "${d%%/*}" -lt "$id" ] || continue
    [ "${d#*/}" != "${3:-}" ] || continue
    state=$(gh api "repos/$REPO/deployments/${d%%/*}/statuses?per_page=100" \
      --jq 'map(.state) | if index("failure") then "failure" elif index("success") then "success" else "" end')
    if [ -n "$state" ] && [[ "$state" =~ $2 ]]; then echo "${d#*/} $state"; return; fi
  done
}

passed=false
[[ "$result" =~ ^(passed|retried)$ ]] && passed=true
if [ "$env" = dev ]; then
  what="commit ${target:0:7}" name=${target:0:7}
  if $passed; then
    previous=$(last_outcome dev '^(success|failure)$')
    if [ "${previous##* }" != failure ]; then
      echo "dev passed at ${target:0:7}, as before: no email (dev mails failures and the first pass after one)"
      exit 0
    fi
    recovered=${previous% *}
  fi
else
  what="version v$target" name="v$target"
fi

case "$result" in
  passed) outcome="deployed and smoke test passed" ;;
  retried) outcome="deployed and smoke test passed on retry" ;;
  failed) outcome="smoke test FAILED" ;;
  not-deployed) outcome="NOT DEPLOYED, smoke test FAILED" ;;
esac
subject="[eShop] $env $name: $outcome"

message=$(mktemp)
trap 'rm -f "$message"' EXIT
{
  echo "From: $SMTP_USERNAME"
  echo "To: $NOTIFY_EMAIL"
  echo "Subject: $subject"
  echo "Date: $(LC_ALL=C date -u '+%a, %d %b %Y %H:%M:%S +0000')"
  echo "MIME-Version: 1.0"
  echo "Content-Type: text/plain; charset=UTF-8"
  echo
  echo "Environment: $env"
  echo "Tested: $what${id:+ (Deployment $id)}"
  case "$result" in
    passed) echo "Result: deployed, and the smoke test passed." ;;
    retried) echo "Result: deployed, and the smoke test passed, but only on a retry." ;;
    failed) echo "Result: the smoke test FAILED${DETAIL:+: $DETAIL}." ;;
    not-deployed) echo "Result: NOT DEPLOYED, so not tested${DETAIL:+: $DETAIL}." ;;
  esac
  [ -z "${recovered:-}" ] || echo "Dev's previous smoke test, of ${recovered:0:7}, had failed: this is the first pass since."
  echo
  echo "Run: $RUN_URL"
  echo "Playwright report (artifact playwright-report-$env): $REPORT_URL"
  if [ -n "${RETRIED_FILE:-}" ] && [ -s "$RETRIED_FILE" ]; then
    echo
    echo "Passed only on retry (the first failure is in the Playwright report):"
    sed 's/^/- /' "$RETRIED_FILE"
  fi
  if [ "$env" = prod ] && ! $passed; then
    echo
    last=$(last_outcome prod '^success$' "v$target")
    last=${last% *} last=${last#v}
    if [ -n "$last" ]; then
      echo "Rollback: the last release that passed in prod is v$last. Roll prod back to it with a promotion PR,"
      echo "then merge it (its commit is scripts/pin-release.sh prod $last):"
      echo
      echo "  scripts/promotion-pr.sh prod $last"
    else
      echo "Rollback: no earlier release passed in prod, so there is none to roll back to."
    fi
  fi
} | sed 's/$/\r/' >"$message"

recipients=()
IFS=, read -ra to <<<"$NOTIFY_EMAIL"
for r in "${to[@]}"; do r=${r// /}; [ -z "$r" ] || recipients+=(--mail-rcpt "$r"); done
# The password goes to curl on stdin, never on its command line (which any process on the runner can read).
printf 'user = "%s:%s"\n' "$SMTP_USERNAME" "$(sed 's/[\\"]/\\&/g' <<<"$SMTP_PASSWORD")" \
  | curl --silent --show-error --fail --ssl-reqd --url "${SMTP_URL:-smtps://smtp.gmail.com:465}" \
      --mail-from "$SMTP_USERNAME" "${recipients[@]}" --config - --upload-file "$message"
echo "emailed $NOTIFY_EMAIL: $subject"
