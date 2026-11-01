#!/usr/bin/env bash
# Refuse to overwrite a version's images: CI's push job runs it before pushing a release candidate's (or a dry run's)
# images (ci-release.yml). QA may already have tested X.Y.Z-rc.N, and sign-off copies exactly those digests, so a
# version tag, once pushed, is never pushed again: re-running an old candidate's CI must fail, not replace it.
# main builds need no check: each has its own main-<sha>-<commit-ts> tag.
#
#   scripts/check-new-images.sh docker.io/pkhamdee/eshop-api:0.3.0-rc.1 docker.io/pkhamdee/eshop-web:0.3.0-rc.1
#
# Exit 0 when none of the images exists (a repository that doesn't exist yet counts as having no tags), 1 naming
# those that do, or when the registry can't be read (unknown is not absent). Needs crane, logged in to the registry
# when the repositories are private. scripts/tests/release-scripts.sh tests it with a fake crane.
set -euo pipefail

[ $# -gt 0 ] || { echo "usage: scripts/check-new-images.sh <repository:tag>..." >&2; exit 2; }

err=$(mktemp)
trap 'rm -f "$err"' EXIT
existing=()
for image in "$@"; do
  repository=${image%:*}
  tag=${image##*:}
  if ! tags=$(crane ls "$repository" 2>"$err"); then
    grep -q NAME_UNKNOWN "$err" && continue # no repository yet: a new service
    cat "$err" >&2
    echo "could not list the tags of $repository, so can't tell whether $image exists" >&2
    exit 1
  fi
  if grep -qxF -- "$tag" <<<"$tags"; then existing+=("$image"); fi
done

if [ ${#existing[@]} -gt 0 ]; then
  printf '%s already exists\n' "${existing[@]}" >&2
  echo "A version's images are never overwritten (QA may have tested them; sign-off copies their digests):" \
    "cut the next release candidate (scripts/release.sh X.Y.Z-rc.N+1), or dispatch the dry run with a new" \
    "0.0.0-test.N." >&2
  exit 1
fi
echo "None of the $# images exists yet."
