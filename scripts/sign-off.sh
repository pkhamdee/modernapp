#!/usr/bin/env bash
# Sign off a release candidate (docs/git-workflow.md, "Releasing"): the "Sign off release candidate" workflow
# (.github/workflows/sign-off.yml) runs it on main; it is not meant to be run by hand.
#
#   SIGN_OFF_ACTOR=<github login> scripts/sign-off.sh 0.3.0-rc.1
#
# Refuses, changing nothing, unless:
#   - SIGN_OFF_ACTOR is a maintainer of $REPO (repo role admin or maintain);
#   - tag vX.Y.Z-rc.N is on origin (annotated);
#   - origin/main pins eshop-qa to exactly that candidate and apps-qa is not suspended (scripts/pin-release.sh qa);
#   - the latest completed QA run of it on main, "E2E qa X.Y.Z-rc.N" (e2e.yml), created since main last changed
#     QA's pin (older runs tested an earlier deployment), passed. That run checked of the
#     cluster that QA served the candidate before and after the test (e2e/check-serving.sh), which a hosted runner
#     can't ask itself;
#   - every candidate image $IMAGE_REGISTRY/<service>:X.Y.Z-rc.N (.github/services.json) exists, and any X.Y.Z image
#     that already exists has the candidate's digest;
#   - tag vX.Y.Z is absent, or is this candidate's sign-off (same commit, made by this script).
# Then, in this order, each step skipped or updated when an earlier run already did it, so a failed sign-off is
# finished by running it again:
#   1. copies each candidate image to X.Y.Z by digest (crane copy; never rebuilt) and checks the digest;
#   2. tags vX.Y.Z (annotated) on the candidate's commit and pushes it; images first, so the tag never names
#      images that don't exist;
#   3. publishes (or updates) the GitHub Release vX.Y.Z: the images with digests, the QA run, who signed off;
#   4. opens (or updates) the prod promotion PR: scripts/promotion-pr.sh prod X.Y.Z.
#
# Environment: SIGN_OFF_ACTOR (required), REPO (default pkhamdee/modernapp), IMAGE_REGISTRY (default
# docker.io/pkhamdee), SIGN_OFF_RUN_URL (the workflow run, linked in the Release and PR), SIGN_OFF_READ_TOKEN (a
# token for the checks, e.g. the workflow's own; default: gh's token). Needs a clean checkout of main, push access to
# origin, `gh` with a token that may create Releases and PRs, crane logged in to the registry with push access, and
# jq. scripts/tests/release-scripts.sh tests it with fake gh and crane against a throwaway origin.
set -euo pipefail

usage() { echo "usage: scripts/sign-off.sh X.Y.Z-rc.N" >&2; exit 2; }
refuse() { echo "Sign-off refused: $*" >&2; exit 1; }
# The checks read GitHub with SIGN_OFF_READ_TOKEN when given (the workflow's token may read Actions runs).
gh_read() { if [ -n "${SIGN_OFF_READ_TOKEN:-}" ]; then GH_TOKEN=$SIGN_OFF_READ_TOKEN gh "$@"; else gh "$@"; fi; }

main() {
  local candidate=${1:-}
  [[ "$candidate" =~ ^([0-9]+\.[0-9]+\.[0-9]+)-rc\.[0-9]+$ ]] || usage
  local version=${BASH_REMATCH[1]}
  local rc_tag="v$candidate" tag="v$version"
  local actor=${SIGN_OFF_ACTOR:?SIGN_OFF_ACTOR (who signs off) is required}
  local repo=${REPO:-pkhamdee/modernapp}
  local registry=${IMAGE_REGISTRY:-docker.io/pkhamdee}
  cd "$(git rev-parse --show-toplevel)"

  # --- Checks: nothing is changed until every one passed ---

  local role
  role=$(gh_read api "repos/$repo/collaborators/$actor/permission" --jq .role_name) \
    || refuse "could not read $actor's role in $repo"
  if [ "$role" != admin ] && [ "$role" != maintain ]; then
    refuse "$actor is not a maintainer of $repo (role: $role); only admin or maintain may sign off"
  fi

  git fetch --quiet origin main
  git fetch --quiet --force origin "refs/tags/$rc_tag:refs/tags/$rc_tag" 2>/dev/null \
    || refuse "release candidate $rc_tag is not on origin"
  [ "$(git cat-file -t "refs/tags/$rc_tag")" = tag ] || refuse "$rc_tag is not an annotated tag"
  local commit
  commit=$(git rev-parse "$rc_tag^{commit}")

  local tagged=false
  if [ -n "$(git ls-remote --tags origin "refs/tags/$tag")" ]; then
    git fetch --quiet --force origin "refs/tags/$tag:refs/tags/$tag"
    if [ "$(git rev-parse "$tag^{commit}")" != "$commit" ] \
      || ! git cat-file tag "refs/tags/$tag" | grep -qF "Signed off from $rc_tag by @"; then
      refuse "$tag already exists and is not a sign-off of $rc_tag: $version is released; cut the next version"
    fi
    tagged=true # an earlier sign-off of this candidate got this far: finish it
  fi

  local pins
  pins=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: $pins is local
  trap "rm -rf '$pins'" EXIT
  git archive origin/main clusters/local | tar -x -C "$pins"
  local qa
  qa=$(PIN_DIR="$pins/clusters/local" scripts/pin-release.sh qa 2>/dev/null) || refuse "eshop-qa's pin on main is unreadable"
  if grep -q -- '# release-pin-until: qa$' "$pins"/clusters/local/*.yaml; then
    refuse "eshop-qa has no release yet on main (apps-qa is suspended): QA must be running $candidate"
  fi
  [ "$qa" = "$candidate" ] || refuse "eshop-qa is pinned to $qa on main, not $candidate: QA must be running the candidate it signs off"

  # Only runs created since main last changed QA's pin (on main's first-parent line, so a promotion PR counts from
  # its merge): after rc.1 -> rc.2 -> rc.1, a run of rc.1 from before rc.2 tested an earlier deployment of it.
  local pinned_at
  pinned_at=$(TZ=UTC git log -1 --first-parent -m -G '# release-pin(-until)?: qa$' \
    --date=format-local:%Y-%m-%dT%H:%M:%SZ --format=%cd origin/main -- clusters/local)
  [ -n "$pinned_at" ] || refuse "can't find the commit on main that pinned eshop-qa"
  local run conclusion qa_run
  run=$(gh_read run list --repo "$repo" --workflow e2e.yml --branch main --event workflow_dispatch --status completed \
    --limit 100 --json databaseId,displayTitle,conclusion,url,createdAt \
    --jq "[.[] | select(.displayTitle == \"E2E qa $candidate\" and .createdAt >= \"$pinned_at\")] | first") \
    || refuse "could not list QA runs"
  if [ -z "$run" ] || [ "$run" = null ]; then
    refuse "no completed QA run of $candidate on main since eshop-qa was pinned to it ($pinned_at)" \
      "(\"E2E qa $candidate\"): run e2e/run-on-actions.sh qa $candidate"
  fi
  conclusion=$(jq -r .conclusion <<<"$run")
  qa_run=$(jq -r .url <<<"$run")
  [ "$conclusion" = success ] || refuse "the latest QA run of $candidate did not pass ($conclusion): $qa_run"

  # Each service as "<service> <digest> <exists>": the candidate's digest, and whether X.Y.Z already exists.
  local images="" plan="" svc digest tags existing
  for svc in $(jq -r '.[].service' .github/services.json); do
    digest=$(crane digest "$registry/$svc:$candidate") || refuse "candidate image $registry/$svc:$candidate is missing"
    tags=$(crane ls "$registry/$svc") || refuse "could not list the tags of $registry/$svc"
    existing=false
    if grep -qxF -- "$version" <<<"$tags"; then
      [ "$(crane digest "$registry/$svc:$version")" = "$digest" ] \
        || refuse "$registry/$svc:$version already exists with a different digest than $candidate's ($digest); release images are never overwritten"
      existing=true
    fi
    plan+="$svc $digest $existing"$'\n'
    images+="$registry/$svc:$version@$digest"$'\n'
  done

  # --- Sign-off ---

  local copied
  while read -r svc digest existing; do
    [ -n "$svc" ] || continue
    if ! $existing; then crane copy "$registry/$svc@$digest" "$registry/$svc:$version"; fi
    copied=$(crane digest "$registry/$svc:$version")
    [ "$copied" = "$digest" ] || { echo "$registry/$svc:$version has digest $copied, not $digest" >&2; exit 1; }
    echo "$registry/$svc:$version@$digest"
  done <<<"$plan"

  if ! $tagged; then
    git tag --force -a "$tag" "$commit" -m "Release $version" \
      -m "Signed off from $rc_tag by @$actor. QA run: $qa_run"
    git push --quiet origin "refs/tags/$tag"
  fi
  echo "Tag $tag on $commit"

  local notes
  notes="$pins/notes.md"
  {
    echo "Release **$tag**, signed off by @$actor from release candidate **$rc_tag** (commit $commit)."
    echo
    echo "### Images"
    echo
    echo "Copied from $rc_tag by digest, never rebuilt:"
    echo
    while read -r image; do [ -z "$image" ] || echo "- \`$image\`"; done <<<"$images"
    echo
    echo "### QA"
    echo
    echo "QA's Playwright run of $candidate against https://qa.eshop.localhost passed: [E2E qa $candidate]($qa_run)."
    echo "It checked that eshop-qa served exactly this candidate before and after the test."
    if [ -n "${SIGN_OFF_RUN_URL:-}" ]; then echo; echo "Signed off in [this run]($SIGN_OFF_RUN_URL)."; fi
    echo
    echo "### Deploying"
    echo
    echo "A release deploys nothing by itself: eshop-prod moves to $tag when the prod promotion PR"
    echo "\"eshop-prod: deploy $tag\" is merged (docs/git-workflow.md, \"Promotion and rollback\")."
  } >"$notes"
  if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
    gh release edit "$tag" --repo "$repo" --notes-file "$notes" >/dev/null
  else
    gh release create "$tag" --repo "$repo" --verify-tag --title "$tag" --notes-file "$notes" >/dev/null
  fi
  local release
  release=$(gh release view "$tag" --repo "$repo" --json url --jq .url)
  echo "Release: $release"

  PROMOTION_IMAGES=$images PROMOTION_DETAILS=$(
    echo "### Sign-off"
    echo
    echo "Signed off by @$actor from release candidate $rc_tag. QA's run of it passed: [E2E qa $candidate]($qa_run)."
    echo "Release: $release${SIGN_OFF_RUN_URL:+ ([sign-off run]($SIGN_OFF_RUN_URL))}. The images are $rc_tag's, copied by digest."
  ) scripts/promotion-pr.sh prod "$version"
}

# All of it in main, read before it runs: promotion-pr.sh checks out another branch under this script.
main "$@"
