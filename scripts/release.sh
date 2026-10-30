#!/usr/bin/env bash
# Cut a release per docs/git-workflow.md: annotated tag vX.Y.Z on release/<MAJOR>.x, pushed, CI run confirmed.
#
#   scripts/release.sh 0.2.0      # creates release/0.x from origin/main first if it does not exist yet
#   scripts/release.sh 0.1.2      # patch: the fix must already be on release/0.x (and on main)
#
# Refuses when the commit to tag carries a GitHub skip-ci marker: GitHub would skip the tag push too, leaving a
# tag that never builds and, tags being immutable, can only be replaced by the next version. After pushing it
# waits for the tag's CI run to start and prints its URL. Releasing is a human step: agents are not allowed to
# push release tags.
set -euo pipefail

REPO=pkhamdee/modernapp
version=${1:-}
[[ "$version" =~ ^([0-9]+)\.[0-9]+\.[0-9]+$ ]] || { echo "usage: scripts/release.sh X.Y.Z" >&2; exit 2; }
tag="v$version"
branch="release/${BASH_REMATCH[1]}.x"

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet --tags origin
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "$tag already exists (tags are immutable: release the next version)" >&2; exit 1
fi

if git rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null; then
  commit=$(git rev-parse "origin/$branch")
  new_branch=false
else
  commit=$(git rev-parse origin/main)
  new_branch=true
fi

# GitHub's skip markers, matched case-insensitively anywhere in the head commit message.
if git log -1 --format=%B "$commit" | grep -qiE '\[(skip ci|ci skip|no ci|skip actions|actions skip)\]'; then
  git log -1 --format='%h %s' "$commit" >&2
  echo "carries a skip-ci marker, so GitHub would not build $tag. Land a commit without one on" \
    "$( $new_branch && echo main || echo "$branch" ) first." >&2
  exit 1
fi

echo "Release $tag"
echo "  commit  $(git log -1 --format='%h %s' "$commit")"
if $new_branch; then echo "  branch  $branch (new, from origin/main)"; else echo "  branch  $branch"; fi
read -r -p "Push? [y/N] " answer
[ "$answer" = y ] || [ "$answer" = Y ] || { echo "aborted"; exit 1; }

if $new_branch; then
  git push --quiet origin "$commit:refs/heads/$branch"
fi
git tag -a "$tag" -m "Release $version" "$commit"
git push --quiet origin "refs/tags/$tag"

# The run appears within seconds; none after a minute means GitHub skipped it.
for _ in $(seq 30); do
  run=$(gh run list --repo "$REPO" --workflow ci-release.yml --branch "$tag" --limit 1 --json url --jq '.[0].url // empty')
  if [ -n "$run" ]; then
    echo "CI: $run"
    echo "Then: Flux moves sphone-prod to $version; smoke test with e2e/run-on-actions.sh (docs/setup.md)."
    exit 0
  fi
  sleep 2
done
echo "No CI run for $tag after a minute: check Actions for a skipped or failed run." >&2
exit 1
