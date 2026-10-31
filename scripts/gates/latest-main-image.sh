#!/usr/bin/env bash
# Prints the newest main build of an image: <repository>:main-<sha>-<commit-ts>, picked the way eshop-dev's
# ImagePolicy picks it (deploy/apps/dev/image-automation.yaml: highest <commit-ts>). CI uses it to start the temporary
# copy with the services a main push did not rebuild.
#
#   scripts/gates/latest-main-image.sh docker.io/pkhamdee/eshop-web    # -> docker.io/pkhamdee/eshop-web:main-93392bd-1793370318
#
# Lists the tags with crane in a container (no registry login needed for a public repository).
set -euo pipefail

CRANE=gcr.io/go-containerregistry/crane:v0.22.1

repository=${1:?usage: $0 <repository, e.g. docker.io/pkhamdee/eshop-web>}
tag=$(docker run --rm "$CRANE" ls "$repository" \
  | grep -E '^main-[a-f0-9]+-[0-9]+$' \
  | sort -t- -k3,3n \
  | tail -n 1 || true)
if [ -z "$tag" ]; then
  echo "No main-<sha>-<ts> tag in $repository" >&2
  exit 1
fi
echo "$repository:$tag"
