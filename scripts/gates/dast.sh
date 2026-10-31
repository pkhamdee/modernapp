#!/usr/bin/env bash
# DAST gate (ADR 0007): OWASP ZAP against the temporary copy, signed out and signed in, before any image is pushed.
#
#   scripts/gates/temporary-copy.sh up && scripts/gates/dast.sh; scripts/gates/temporary-copy.sh down
#
# Four scans, all from the pinned ZAP image on the copy's Compose network:
#   web       ZAP baseline (spider + passive rules) of the web app through the gateway, as a browser reaches it;
#   api       ZAP API scan (import + active rules) of every operation in eshop-api's OpenAPI description, sent through
#             the gateway as the web app sends them (the description itself is fetched from eshop-api directly: it
#             is outside /api and served only because the copy sets OpenApi__Enabled), signed out;
#   customer  the same API scan signed in as a Customer (a fresh one, signed in by SMS code from the mock's inbox);
#   staff     the same API scan signed in as Staff (the copy's throwaway Staff account).
# The sessions come from dast-session.mjs, run on the copy's network as a user would sign in; ZAP sends the token as
# `Authorization: Bearer ...` on every request to the gateway (ZAP_AUTH_HEADER*). Customer runs before Staff, whose
# back-office attacks may retire Products or change the Auction the Customer scan works on. Tokens are stateless
# (no sign-out to hit) and Staff sign-in has no lockout, so neither session can be lost during its scan.
#
# Fails (exit 1) on any High-risk alert that is not accepted in scripts/gates/dast-rules.conf, or when a signed-in
# scan reached no endpoint of its role with a 2xx answer (a sign-in that silently stopped working must not pass as
# a clean scan); Medium, Low and Informational alerts are reported, never blocking. The rules file is in ZAP's `-c`
# format, and every line in it needs a `# reason:` comment (dast-verdict.py). Exit 2 when a scan could not run, a
# session could not be obtained, or the rules file is malformed.
#
# Reports go to $REPORT_DIR (default reports/dast): <scan>.html, <scan>.json, <scan>.md (ZAP's, every alert),
# <scan>-requests.tsv (API scans: every request ZAP kept, with its status), zap-<scan>.log, and summary.txt (the
# verdict: every alert, which are accepted and why, which block; the 2xx answers each signed-in scan got from
# endpoints only its role may use).
#
# TEMPORARY_COPY_PROJECT  the copy's Compose project (default eshop-temporary-copy); the scans join its network
# TEMPORARY_COPY_STAFF_USERNAME / _PASSWORD   the copy's Staff account (default staff / temporary-copy-staff)
# DAST_WEB_URL            what the baseline scans (default http://gateway:8080)
# DAST_OPENAPI_URL        the API description (default http://eshop-api:8080/openapi/v1.json)
# DAST_API_HOST           where the API scans send requests (default http://gateway:8080)
# DAST_SCANS              which scans to run (default "web api customer staff")
#
# On this Mac, point Docker at Rancher Desktop first: DOCKER_HOST=unix://$HOME/.rd/docker.sock.
set -euo pipefail

ZAP_IMAGE=ghcr.io/zaproxy/zaproxy:2.17.0@sha256:030d3df57735dacbb83464854758e674dd9ad01d79d12a129a8e58b1fd384238
# The same Node image as the copy's readiness check (temporary-copy/compose.yaml), for dast-session.mjs.
NODE_IMAGE=node:24.22.1-alpine3.24

# Endpoints only a signed-in role may use (paths under the gateway; Roles.Customer / Roles.Staff in eshop-api).
# A signed-in scan must get at least one 2xx answer from one of its role's endpoints.
CUSTOMER_ONLY='^/api/(applications|offers|contracts|eligibility|lots/won|lots/[0-9]+/bids)(/|$)'
STAFF_ONLY='^/api/back-office(/|$)'

root=$(cd "$(dirname "$0")/../.." && pwd)
report_dir=$(mkdir -p "${REPORT_DIR:-$root/reports/dast}" && cd "${REPORT_DIR:-$root/reports/dast}" && pwd)
network=${TEMPORARY_COPY_PROJECT:-eshop-temporary-copy}_default
web_url=${DAST_WEB_URL:-http://gateway:8080}
openapi_url=${DAST_OPENAPI_URL:-http://eshop-api:8080/openapi/v1.json}
api_host=${DAST_API_HOST:-http://gateway:8080}
read -r -a scans <<<"${DAST_SCANS:-web api customer staff}"

# ZAP runs as its own user (uid 1000) and writes its reports into /zap/wrk, the report folder.
rm -f "$report_dir"/*.json "$report_dir"/*.html "$report_dir"/*.md "$report_dir"/*.log "$report_dir"/*.yaml \
  "$report_dir"/*.tsv "$report_dir"/summary.txt
chmod a+rwx "$report_dir"

zap() {
  local name=$1
  shift
  # -silent: no add-on updates or other calls home, so the scan rules are exactly the pinned image's.
  # -I: ZAP's own WARN/FAIL levels don't decide; dast-verdict.py does, from the JSON report. Exit 0-2 is a finished
  # scan (2 = alerts at WARN); 3 or more is a scan that failed to run.
  # No -c: given a rules file, zap-api-scan.py swaps its API-Minimal policy for every active rule (minutes instead
  # of seconds, and the scan would change whenever an alert is accepted). The verdict applies dast-rules.conf.
  local code=0
  docker run --rm --network "$network" -v "$report_dir:/zap/wrk:rw" \
    -v "$root/scripts/gates/dast-hook.py:/zap/dast-hook.py:ro" -e DAST_SCAN="$name" ${zap_env[@]+"${zap_env[@]}"} \
    "$ZAP_IMAGE" "$@" -z -silent -I -J "$name.json" -r "$name.html" -w "$name.md" >"$report_dir/zap-$name.log" 2>&1 ||
    code=$?
  if [ "$code" -gt 2 ]; then
    echo "::error::ZAP $name scan did not complete (exit $code); see $report_dir/zap-$name.log"
    tail -n 30 "$report_dir/zap-$name.log"
    exit 2
  fi
  echo "ZAP $name scan done (exit $code)"
}

# The bearer token of a fresh session for a role (customer or staff), signed in through the gateway.
session() {
  local token
  if ! token=$(docker run --rm --network "$network" --read-only --cap-drop ALL \
    -v "$root/scripts/gates/dast-session.mjs:/dast/dast-session.mjs:ro" \
    -e STAFF_USERNAME="${TEMPORARY_COPY_STAFF_USERNAME:-staff}" \
    -e STAFF_PASSWORD="${TEMPORARY_COPY_STAFF_PASSWORD:-temporary-copy-staff}" \
    "$NODE_IMAGE" node /dast/dast-session.mjs "$1"); then
    echo "::error::Could not sign in as $1 for the signed-in ZAP scan (see above)" >&2
    exit 2
  fi
  printf '%s' "$token"
}

api_scan() {
  zap "$1" zap-api-scan.py -t "$openapi_url" -f openapi -O "$api_host" --hook /zap/dast-hook.py
}

signed_in_scan() {
  local token
  token=$(session "$1")
  # The header goes only to the gateway (the host the operations are sent to), never to eshop-api's description.
  zap_env=(-e ZAP_AUTH_HEADER=Authorization -e "ZAP_AUTH_HEADER_VALUE=Bearer $token" -e ZAP_AUTH_HEADER_SITE=gateway)
  api_scan "$1"
}

scan() {
  zap_env=() # docker run options for the scan: the session of a signed-in scan
  case "$1" in
    # Passive only (an active scan of the web app is out of scope), with the classic spider for one minute.
    web) zap web zap-baseline.py -t "$web_url" -m 1 ;;
    # Every operation of the description, signed out: refusals (401/403/400) are the expected answers.
    api) api_scan api ;;
    # Every operation again, signed in: the Customer's own Applications, Offers, Contracts and Bids, or the back office.
    customer | staff) signed_in_scan "$1" ;;
    *)
      echo "unknown scan: $1 (known: web api customer staff)" >&2
      exit 2
      ;;
  esac
}

for name in "${scans[@]}"; do
  scan "$name"
done

args=()
for name in "${scans[@]}"; do
  case "$name" in
    customer) args+=(--role-only "customer=$CUSTOMER_ONLY") ;;
    staff) args+=(--role-only "staff=$STAFF_ONLY") ;;
  esac
done
for name in "${scans[@]}"; do args+=("$name=/zap/wrk/$name.json"); done
docker run --rm -v "$root:/src:ro" -w /src -v "$report_dir:/zap/wrk:rw" --entrypoint python3 "$ZAP_IMAGE" \
  -I scripts/gates/dast-verdict.py scripts/gates/dast-rules.conf /zap/wrk/summary.txt "${args[@]}"
