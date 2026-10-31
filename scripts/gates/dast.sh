#!/usr/bin/env bash
# DAST gate (ADR 0007): OWASP ZAP against the temporary copy, signed out, before any image is pushed.
#
#   scripts/gates/temporary-copy.sh up && scripts/gates/dast.sh; scripts/gates/temporary-copy.sh down
#
# Two scans, both from the pinned ZAP image on the copy's Compose network:
#   web  ZAP baseline (spider + passive rules) of the web app through the gateway, as a browser reaches it;
#   api  ZAP API scan (import + active rules) of every operation in eshop-api's OpenAPI description, sent through
#        the gateway as the web app sends them (the description itself is fetched from eshop-api directly: it is
#        outside /api and served only because the copy sets OpenApi__Enabled).
#
# Fails (exit 1) on any High-risk alert that is not accepted in scripts/gates/dast-rules.conf; Medium, Low and
# Informational alerts are reported, never blocking. The rules file is in ZAP's `-c` format, and every line in it
# needs a `# reason:` comment (dast-verdict.py). Exit 2 when a scan could not run or the rules file is malformed.
#
# Reports go to $REPORT_DIR (default reports/dast): <scan>.html, <scan>.json, <scan>.md (ZAP's, every alert),
# zap-<scan>.log, and summary.txt (the verdict: every alert, which are accepted and why, which block).
#
# TEMPORARY_COPY_PROJECT  the copy's Compose project (default eshop-temporary-copy); the scans join its network
# DAST_WEB_URL            what the baseline scans (default http://gateway:8080)
# DAST_OPENAPI_URL        the API description (default http://eshop-api:8080/openapi/v1.json)
# DAST_API_HOST           where the API scan sends requests (default http://gateway:8080)
# DAST_SCANS              which scans to run (default "web api")
#
# A signed-in scan (#72) is another entry in scan(): the same API scan with ZAP_AUTH_HEADER_VALUE set.
# On this Mac, point Docker at Rancher Desktop first: DOCKER_HOST=unix://$HOME/.rd/docker.sock.
set -euo pipefail

ZAP_IMAGE=ghcr.io/zaproxy/zaproxy:2.17.0@sha256:030d3df57735dacbb83464854758e674dd9ad01d79d12a129a8e58b1fd384238

root=$(cd "$(dirname "$0")/../.." && pwd)
report_dir=$(mkdir -p "${REPORT_DIR:-$root/reports/dast}" && cd "${REPORT_DIR:-$root/reports/dast}" && pwd)
network=${TEMPORARY_COPY_PROJECT:-eshop-temporary-copy}_default
web_url=${DAST_WEB_URL:-http://gateway:8080}
openapi_url=${DAST_OPENAPI_URL:-http://eshop-api:8080/openapi/v1.json}
api_host=${DAST_API_HOST:-http://gateway:8080}
read -r -a scans <<<"${DAST_SCANS:-web api}"

# ZAP runs as its own user (uid 1000) and writes its reports into /zap/wrk, the report folder.
rm -f "$report_dir"/*.json "$report_dir"/*.html "$report_dir"/*.md "$report_dir"/*.log "$report_dir"/*.yaml "$report_dir"/summary.txt
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
  docker run --rm --network "$network" -v "$report_dir:/zap/wrk:rw" ${zap_env[@]+"${zap_env[@]}"} "$ZAP_IMAGE" \
    "$@" -z -silent -I -J "$name.json" -r "$name.html" -w "$name.md" >"$report_dir/zap-$name.log" 2>&1 ||
    code=$?
  if [ "$code" -gt 2 ]; then
    echo "::error::ZAP $name scan did not complete (exit $code); see $report_dir/zap-$name.log"
    tail -n 30 "$report_dir/zap-$name.log"
    exit 2
  fi
  echo "ZAP $name scan done (exit $code)"
}

scan() {
  zap_env=() # docker run options for the scan, e.g. a session: -e ZAP_AUTH_HEADER_VALUE="Bearer ..." (#72)
  case "$1" in
    # Passive only (an active scan of the web app is out of scope), with the classic spider for one minute.
    web) zap web zap-baseline.py -t "$web_url" -m 1 ;;
    # Every operation of the description, signed out: refusals (401/403/400) are the expected answers.
    api) zap api zap-api-scan.py -t "$openapi_url" -f openapi -O "$api_host" ;;
    *)
      echo "unknown scan: $1 (known: web api)" >&2
      exit 2
      ;;
  esac
}

for name in "${scans[@]}"; do
  scan "$name"
done

reports=()
for name in "${scans[@]}"; do reports+=("$name=/zap/wrk/$name.json"); done
docker run --rm -v "$root:/src:ro" -w /src -v "$report_dir:/zap/wrk:rw" --entrypoint python3 "$ZAP_IMAGE" \
  -I scripts/gates/dast-verdict.py scripts/gates/dast-rules.conf /zap/wrk/summary.txt "${reports[@]}"
