#!/usr/bin/env bash
# Image-scan gate: Trivy (pinned image) over built images, read from their docker archives, before any is pushed.
#
#   scripts/gates/image-scan.sh <image.tar>...    # CI runs it in the `scan` job (ci-release.yml), one image per job
#
#   docker save temporary-copy/eshop-api:local -o eshop-api.tar && scripts/gates/image-scan.sh eshop-api.tar
#
# Fails (exit 1) when any image has a CRITICAL finding, fixed or not, as the dependency scan does; every image is
# scanned first. Other severities are reported but never fail. An unfixable CRITICAL is accepted in a `.trivyignore`
# at the repo root (CVE, reason, date), which Trivy reads from there. Trivy's own default scanners run
# (vulnerabilities and secrets).
#
# Reports go to $REPORT_DIR (default: reports/image-scan), per image: <name>.json (every severity), <name>.txt
# (readable table). <name> is the archive's name, or for an image.tar its folder's without `image-` (CI's artifact
# folder image-<service>/ gives <service>).
# Trivy's database is cached in $GATES_CACHE (default ~/.cache/eshop-gates).
set -euo pipefail

TRIVY_IMAGE=aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c

[ $# -gt 0 ] || { echo "usage: scripts/gates/image-scan.sh <image.tar>..." >&2; exit 2; }

root=$(cd "$(dirname "$0")/../.." && pwd)
report_dir=$(mkdir -p "${REPORT_DIR:-$root/reports/image-scan}" && cd "${REPORT_DIR:-$root/reports/image-scan}" && pwd)
cache=${GATES_CACHE:-$HOME/.cache/eshop-gates}/trivy
mkdir -p "$cache"

failed=()
for archive in "$@"; do
  [ -f "$archive" ] || { echo "no image archive at $archive" >&2; exit 2; }
  dir=$(cd "$(dirname "$archive")" && pwd)
  file=$(basename "$archive")
  if [ "$file" = image.tar ]; then name=$(basename "$dir"); name=${name#image-}; else name=${file%.tar}; fi
  trivy() {
    docker run --rm --user "$(id -u):$(id -g)" \
      -v "$root:/src:ro" -v "$dir:/image:ro" -v "$cache:/cache" -v "$report_dir:/reports" -w /src \
      "$TRIVY_IMAGE" --cache-dir /cache --quiet "$@"
  }
  echo "--- $name ($archive)"
  trivy image --input "/image/$file" --format json --output "/reports/$name.json"
  trivy convert --format table --output "/reports/$name.txt" "/reports/$name.json"
  if ! trivy convert --format table --severity CRITICAL --exit-code 1 --output "/reports/$name-critical.txt" \
    "/reports/$name.json"; then
    cat "$report_dir/$name-critical.txt"
    failed+=("$name")
  else
    echo "$name: no critical findings (report: $report_dir/$name.txt)"
  fi
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "image-scan gate: FAILED: critical findings in ${failed[*]} (reports: $report_dir)" >&2
  exit 1
fi
echo "image-scan gate: passed: no critical findings in $# image(s) (reports: $report_dir)"
