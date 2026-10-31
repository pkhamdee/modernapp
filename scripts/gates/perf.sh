#!/usr/bin/env bash
# Performance gate: Locust, headless, from its pinned image, against the temporary copy (ADR 0007).
#
#   scripts/gates/temporary-copy.sh up && scripts/gates/perf.sh   # CI runs it in the `gate` job (ci-release.yml)
#
# About 50 Customers for 60 s over the main Customer flows (catalog, Product, sign-in by SMS code, Auction and Lot;
# scripts/gates/perf/locustfile.py). Fails (exit 1) when the p95 of all requests is over 500 ms or more than 1% of
# them failed. The load and the thresholds are in scripts/gates/perf/locust.conf.
#
# Reports go to $REPORT_DIR (default: reports/perf): summary.txt (the verdict and the slowest endpoints),
# locust.html, and locust_stats.csv / _failures.csv / _exceptions.csv / _stats_history.csv (per endpoint).
#
# Target: the copy's gateway on its Compose network (the copy's TEMPORARY_COPY_PROJECT, default
# eshop-temporary-copy). PERF_NETWORK and PERF_HOST point Locust elsewhere.
set -euo pipefail

LOCUST_IMAGE=locustio/locust:2.47.0@sha256:90fdf5b9632e67bb556d17784095652871be68318c5074731d911d4caaa42cc3

# shellcheck source=lib.sh
. "$(dirname "$0")/lib.sh"
root=$GATES_ROOT
report_dir=$(gate_report_dir perf)
network=${PERF_NETWORK:-${TEMPORARY_COPY_PROJECT:-eshop-temporary-copy}_default}
host=${PERF_HOST:-http://gateway:8080}
rm -f "$report_dir"/locust* "$report_dir/summary.txt"

# LOCUST_* variables of this shell (e.g. LOCUST_RUN_TIME=20s) override locust.conf for one run.
overrides=()
while IFS= read -r name; do overrides+=(-e "$name"); done < <(env | sed -n 's/^\(LOCUST_[A-Z_]*\)=.*/\1/p')

docker run --rm --network "$network" --user "$(id -u):$(id -g)" -e HOME=/tmp ${overrides[@]+"${overrides[@]}"} \
  -v "$root/scripts/gates/perf:/mnt/locust:ro" -v "$report_dir:/reports" -w /mnt/locust \
  "$LOCUST_IMAGE" --config /mnt/locust/locust.conf --host "$host"
