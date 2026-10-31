#!/usr/bin/env bash
# Tests for the release scripts, run against throwaway Git repos (a bare "origin" and clones of it), never GitHub:
#   scripts/release.sh             cuts release-candidate tags
#   scripts/check-release-tag.sh   CI's decision on a pushed v* tag
#   scripts/promotion-pr.sh        the promotion PR's branch, pin commit and body
#   scripts/sign-off.sh            the "Sign off release candidate" workflow: its refusals, the release, re-runs
#   scripts/check-new-images.sh    CI's push job: a version's images are never overwritten
#   scripts/protect-main.sh        main's ruleset, the tag rulesets and the release environment (dry run and apply)
# `gh` and `crane` are fakes on PATH that record their arguments and keep GitHub's and the registry's state in files.
# Run from anywhere: scripts/tests/release-scripts.sh
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# Fake gh: logs every call and keeps GitHub's state (Releases, PRs) as files in $GH_STATE.
#   run list   of e2e.yml (sign-off's QA run query): applies its --jq to $FAKE_QA_RUNS (the runs, newest first);
#              of any other workflow (release.sh): prints a run URL
#   api .../collaborators/<user>/permission: prints $FAKE_ROLE, the --jq .role_name result (default admin)
#   api .../rulesets, .../deployment-branch-policies: print $FAKE_RULESETS, $FAKE_BRANCH_POLICIES (GitHub's JSON;
#              FAKE_NO_ENVIRONMENT=1: the environment doesn't exist, 404); api <path> --method <M>: a write, its
#              body kept as $GH_STATE/api-<M>-<path with / as _>
#   (only the calls these scripts make; gh's own --jq is not emulated beyond that)
#   release view/create/edit, pr list/create/edit: against $GH_STATE (a Release's notes, a PR's body)
mkdir -p "$work/bin" "$work/gh-state"
cat >"$work/bin/gh" <<'GH'
#!/usr/bin/env bash
echo "gh $*" >>"$GH_LOG"
arg() { local name=$1; shift; while [ $# -gt 0 ]; do [ "$1" = "$name" ] && { echo "$2"; return; }; shift; done; }
case "$1 $2" in
  "run list") if [[ " $* " == *" e2e.yml "* ]]; then jq "$(arg --jq "$@")" <<<"${FAKE_QA_RUNS:-[]}"; else echo "https://github.com/test/run/1"; fi ;;
  "api "*)
    if [[ " $* " == *" --method "* ]]; then # a write: its JSON body (stdin) kept as $GH_STATE/api-<METHOD>-<path>
      method=$(arg --method "$@"); path=${2//\//_}
      if [[ " $* " == *" --input - "* ]]; then cat >"$GH_STATE/api-$method-$path"; else : >"$GH_STATE/api-$method-$path"; fi
      echo '{}'
    elif [[ "$2" == */permission ]]; then echo "${FAKE_ROLE:-admin}"
    elif [[ "$2" == */rulesets ]]; then echo "${FAKE_RULESETS:-[]}"
    elif [[ "$2" == */deployment-branch-policies ]]; then
      [ -z "${FAKE_NO_ENVIRONMENT:-}" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
      none='{"total_count":0,"branch_policies":[]}'; echo "${FAKE_BRANCH_POLICIES:-$none}"
    fi ;;
  "release view") [ -f "$GH_STATE/release-$3" ] || { echo "release not found" >&2; exit 1; }
    echo "https://github.com/test/releases/tag/$3" ;;
  "release create") cp "$(arg --notes-file "$@")" "$GH_STATE/release-$3"; echo "https://github.com/test/releases/tag/$3" ;;
  "release edit") cp "$(arg --notes-file "$@")" "$GH_STATE/release-$3" ;;
  "pr list") head=$(arg --head "$@"); [ ! -f "$GH_STATE/pr-${head//\//_}" ] || echo "https://github.com/test/pull/1" ;;
  "pr create") head=$(arg --head "$@"); cp "$(arg --body-file "$@")" "$GH_STATE/pr-${head//\//_}"
    echo "https://github.com/test/pull/1" ;;
  "pr edit") ;;
esac
GH

# Fake crane: a registry kept as files, $REGISTRY/<repository>/<tag> holding the digest; logs every call.
# FAKE_CRANE_FAIL_COPY=<repository> makes copying into that repository fail (a sign-off interrupted half-way);
# FAKE_CRANE_LS_ERROR=1 makes listing tags fail as a registry error would.
cat >"$work/bin/crane" <<'CRANE'
#!/usr/bin/env bash
echo "crane $*" >>"$CRANE_LOG"
resolve() { # resolve <repo:tag | repo@digest>: prints the digest, or fails as for a missing manifest
  if [[ "$1" == *@* ]]; then
    grep -rqx -- "${1#*@}" "$REGISTRY/${1%@*}" 2>/dev/null && { echo "${1#*@}"; return; }
  else
    cat "$REGISTRY/${1%:*}/${1##*:}" 2>/dev/null && return
  fi
  echo "MANIFEST_UNKNOWN: $1" >&2; return 1
}
case "$1" in
  digest) resolve "$2" ;;
  ls) [ -z "${FAKE_CRANE_LS_ERROR:-}" ] || { echo "GET https://index.docker.io/v2/: TOOMANYREQUESTS" >&2; exit 1; }
    [ -d "$REGISTRY/$2" ] || { echo "NAME_UNKNOWN: $2" >&2; exit 1; }; ls "$REGISTRY/$2" ;;
  copy) digest=$(resolve "$2") || exit 1
    [ "${3%:*}" != "${FAKE_CRANE_FAIL_COPY:-}" ] || { echo "copy to $3 failed" >&2; exit 1; }
    mkdir -p "$REGISTRY/${3%:*}" && echo "$digest" >"$REGISTRY/${3%:*}/${3##*:}" ;;
  *) echo "fake crane: unexpected $*" >&2; exit 1 ;;
esac
CRANE
chmod +x "$work/bin/gh" "$work/bin/crane"
export PATH="$work/bin:$PATH" GH_LOG="$work/gh.log" GH_STATE="$work/gh-state" CRANE_LOG="$work/crane.log"

failures=0
check() { # check <description> <command...>: passes when the command succeeds
  local what=$1; shift
  if "$@"; then echo "ok   $what"; else echo "FAIL $what"; sed 's/^/     /' "$work/out" 2>/dev/null; failures=$((failures + 1)); fi
}

# A fresh origin with one commit on main holding this checkout's scripts and clusters/local; prints a clone's path.
fresh() {
  local dir="$work/$1"
  git init -q --bare -b main "$dir/origin.git"
  git clone -q "$dir/origin.git" "$dir/seed" 2>/dev/null
  mkdir -p "$dir/seed/clusters" "$dir/seed/.github"
  cp -R "$root/scripts" "$dir/seed/"
  cp "$root/.github/services.json" "$dir/seed/.github/"
  cp -R "$root/clusters/local" "$dir/seed/clusters/"
  git -C "$dir/seed" add -A
  git -C "$dir/seed" commit -qm "initial"
  git -C "$dir/seed" push -q origin main
  git clone -q "$dir/origin.git" "$dir/clone"
  echo "$dir/clone"
}
origin() { git -C "$clone/../origin.git" "$@"; }

# release.sh <args> in $clone, answering the confirmation with $answer (default y). Output in $work/out.
release() { (cd "$clone" && printf '%s\n' "${answer:-y}" | scripts/release.sh "$@") >"$work/out" 2>&1; }

# --- scripts/release.sh ---

rc_on_new_series() {
  release 0.3.0-rc.1 \
    && [ "$(origin cat-file -t refs/tags/v0.3.0-rc.1)" = tag ] \
    && [ "$(origin rev-parse 'refs/tags/v0.3.0-rc.1^{commit}')" = "$(origin rev-parse refs/heads/release/0.x)" ] \
    && [ "$(origin rev-parse refs/heads/release/0.x)" = "$(origin rev-parse refs/heads/main)" ]
}
clone=$(fresh rc-new-series)
check "release.sh X.Y.Z-rc.N pushes an annotated vX.Y.Z-rc.N tag on a new release/N.x forked from main" rc_on_new_series

# Tags exist on origin now; a refused run must leave origin's refs exactly as they were.
refs_before() { origin for-each-ref --format='%(refname) %(objectname)' >"$work/refs"; }
refs_unchanged() { origin for-each-ref --format='%(refname) %(objectname)' | diff -q - "$work/refs" >/dev/null; }
refused() { # refused <expected message part> <release.sh args...>
  local expected=$1; shift
  refs_before
  ! release "$@" && grep -qF -- "$expected" "$work/out" && refs_unchanged
}

next_rc_on_existing_branch() {
  # A fix lands on release/0.x after rc.1 (and main moves on): rc.2 tags the branch head, not main.
  git -C "$clone" checkout -q -b fix origin/release/0.x
  git -C "$clone" commit -q --allow-empty -m "fix"
  git -C "$clone" push -q origin HEAD:refs/heads/release/0.x
  git -C "$clone" commit -q --allow-empty -m "feature on main"
  git -C "$clone" push -q origin HEAD:refs/heads/main --force
  release 0.3.0-rc.2 \
    && [ "$(origin rev-parse 'refs/tags/v0.3.0-rc.2^{commit}')" = "$(origin rev-parse refs/heads/release/0.x)" ] \
    && [ "$(origin log -1 --format=%s 'refs/tags/v0.3.0-rc.2^{commit}')" = fix ]
}
check "release.sh tags the head of an existing release/N.x" next_rc_on_existing_branch
check "release.sh refuses plain X.Y.Z and points to sign-off" \
  refused 'Sign off release candidate' 0.3.0
check "release.sh refuses a malformed version" refused 'usage: scripts/release.sh X.Y.Z-rc.N' 0.3.0-rc
check "release.sh refuses a dry-run version (dispatched, never tagged)" \
  refused 'usage: scripts/release.sh X.Y.Z-rc.N' 0.0.0-test.1
check "release.sh refuses an existing candidate tag" refused 'v0.3.0-rc.1 already exists' 0.3.0-rc.1
released_version_refused() {
  git -C "$clone" tag -a v0.3.0 -m "Release 0.3.0" origin/release/0.x
  git -C "$clone" push -q origin refs/tags/v0.3.0
  refused 'v0.3.0 is already released' 0.3.0-rc.3
}
check "release.sh refuses a candidate for a released version" released_version_refused
answer=n check "release.sh pushes nothing when not confirmed" refused 'aborted' 0.3.1-rc.1

# The first candidate of a new minor (X.Y.0-rc.1) on an existing release/N.x must carry main's work: release.sh
# merges origin/main in first (a merge commit whose tree is main's), as v0.2.0 was made by hand (f613dcb).
commit_file() { # commit_file <file> <subject>: a commit in $clone changing <file>
  echo "$2" >>"$clone/$1"; git -C "$clone" add "$1"; git -C "$clone" commit -qm "$2"
}
clone=$(fresh new-minor)
git -C "$clone" push -q origin HEAD:refs/heads/release/0.x
git -C "$clone" checkout -q -b rel origin/release/0.x
commit_file old-fix.txt "old fix, on release/0.x only"          # superseded by the next merge from main, like #39
git -C "$clone" push -q origin HEAD:refs/heads/release/0.x
git -C "$clone" checkout -q main
commit_file feature-a.txt "feature a"
git -C "$clone" push -q origin HEAD:main
git -C "$clone" checkout -q rel
git -C "$clone" fetch -q origin
merge=$(git -C "$clone" commit-tree 'origin/main^{tree}' -p HEAD -p origin/main -m "Merge main into release/0.x for v0.2.0")
git -C "$clone" reset -q --hard "$merge"
git -C "$clone" tag -a v0.2.0 -m "Release 0.2.0"
commit_file fix.txt "fix on release/0.x and main"
git -C "$clone" push -q origin HEAD:refs/heads/release/0.x refs/tags/v0.2.0
git -C "$clone" checkout -q main
git -C "$clone" cherry-pick -x rel >/dev/null
commit_file feature-b.txt "feature b"
git -C "$clone" push -q origin HEAD:main
answer=n check "release.sh X.Y.0-rc.1 on an existing release/N.x pushes nothing when not confirmed" \
  refused 'aborted' 0.3.0-rc.1
new_minor_merges_main() {
  local old_head
  old_head=$(origin rev-parse refs/heads/release/0.x)
  release 0.3.0-rc.1 || return 1
  local tagged
  tagged=$(origin rev-parse 'refs/tags/v0.3.0-rc.1^{commit}')
  [ "$tagged" = "$(origin rev-parse refs/heads/release/0.x)" ] \
    && [ "$(origin rev-parse "$tagged^1")" = "$old_head" ] \
    && [ "$(origin rev-parse "$tagged^2")" = "$(origin rev-parse refs/heads/main)" ] \
    && [ "$(origin rev-parse "$tagged^{tree}")" = "$(origin rev-parse 'refs/heads/main^{tree}')" ] \
    && [ "$(origin log -1 --format=%s "$tagged")" = "Merge main into release/0.x for v0.3.0-rc.1" ] \
    && grep -qF 'merge origin/main into release/0.x' "$work/out"
}
check "release.sh X.Y.0-rc.1 on an existing release/N.x merges origin/main in (main's tree) and tags the merge" \
  new_minor_merges_main
patch_rc_tags_head() {
  release 0.2.1-rc.1 \
    && [ "$(origin rev-parse 'refs/tags/v0.2.1-rc.1^{commit}')" = "$(origin rev-parse refs/heads/release/0.x)" ] \
    && [ "$(origin rev-parse 'refs/tags/v0.2.1-rc.1^{commit}')" = "$(origin rev-parse 'refs/tags/v0.3.0-rc.1^{commit}')" ]
}
check "release.sh X.Y.Z-rc.1 with Z > 0 tags the branch head (merges nothing)" patch_rc_tags_head

clone=$(fresh new-minor-unmerged-fix)
git -C "$clone" push -q origin HEAD:refs/heads/release/0.x
git -C "$clone" checkout -q -b rel origin/release/0.x
commit_file fix.txt "fix only on release/0.x"
git -C "$clone" push -q origin HEAD:refs/heads/release/0.x
git -C "$clone" checkout -q main
commit_file feature.txt "feature"
git -C "$clone" push -q origin HEAD:main
unmerged_fix_refused() {
  refused 'not on main' 0.3.0-rc.1 && grep -qF 'fix only on release/0.x' "$work/out"
}
check "release.sh X.Y.0-rc.1 refuses while release/N.x has a commit that is not on main (git cherry)" \
  unmerged_fix_refused

clone=$(fresh skip-ci)
git -C "$clone" commit -q --allow-empty -m "eshop-dev: update images [skip ci]"
git -C "$clone" push -q origin HEAD:main
check "release.sh refuses a commit with a skip-ci marker" refused 'skip-ci marker' 0.3.0-rc.1

# --- scripts/check-release-tag.sh (CI's plan job, in a full clone with the tag fetched) ---

clone=$(fresh tags)
git -C "$clone" push -q origin HEAD:refs/heads/release/0.x
git -C "$clone" fetch -q origin
git -C "$clone" tag -a v0.3.0-rc.1 -m "Release candidate 0.3.0-rc.1"
git -C "$clone" tag -a v0.3.0 -m "Release 0.3.0"
git -C "$clone" tag v0.3.0-rc.2                             # lightweight
git -C "$clone" tag -a v0.3.0-beta.1 -m "not a candidate"
git -C "$clone" commit -q --allow-empty -m "on main only"
git -C "$clone" tag -a v0.4.0-rc.1 -m "Release candidate 0.4.0-rc.1"
tag_check() { (cd "$clone" && scripts/check-release-tag.sh "$1") >"$work/out" 2>"$work/err"; }
builds() { tag_check "$1" && [ "$(cat "$work/out")" = "$2" ]; }
skipped() { tag_check "$1" && [ ! -s "$work/out" ] && grep -qF 'Sign off release candidate' "$work/err"; }
rejected() { ! tag_check "$1" && grep -qF -- "$2" "$work/err"; }

check "check-release-tag.sh builds an annotated candidate on release/N.x as X.Y.Z-rc.N" builds v0.3.0-rc.1 0.3.0-rc.1
check "check-release-tag.sh skips a plain vX.Y.Z (sign-off made it; not built)" skipped v0.3.0
check "check-release-tag.sh rejects a lightweight candidate" rejected v0.3.0-rc.2 lightweight
check "check-release-tag.sh rejects a tag that is neither" rejected v0.3.0-beta.1 'not vX.Y.Z-rc.N'
check "check-release-tag.sh rejects a candidate on no release/N.x branch" rejected v0.4.0-rc.1 'release/N.x'

# --- scripts/promotion-pr.sh (CI's QA promotion job; sign-off's prod promotion) ---

clone=$(fresh promotion)
git -C "$clone" tag -a v0.3.0-rc.1 -m "Release candidate 0.3.0-rc.1"
git -C "$clone" push -q origin refs/tags/v0.3.0-rc.1
rc_commit=$(git -C "$clone" rev-parse 'v0.3.0-rc.1^{commit}')
git -C "$clone" commit -q --allow-empty -m "main moves on"
git -C "$clone" push -q origin HEAD:main
git -C "$clone" reset -q --hard HEAD~1                       # a stale checkout: the PR must start from origin/main
export PROMOTION_IMAGES="docker.io/pkhamdee/eshop-api:0.3.0-rc.1@sha256:aaaa
docker.io/pkhamdee/eshop-web:0.3.0-rc.1@sha256:bbbb"
export PROMOTION_DETAILS="### Gates
CI run: https://github.com/test/run/1"
promote() { (cd "$clone" && scripts/promotion-pr.sh "$@") >"$work/out" 2>&1; }

pin_commit_and_body() {
  : >"$GH_LOG"
  PROMOTION_PUSH=0 promote qa 0.3.0-rc.1 || return 1
  local branch=promote/qa-0.3.0-rc.1
  [ "$(git -C "$clone" rev-parse "$branch~1")" = "$(origin rev-parse main)" ] \
    && [ "$(git -C "$clone" log -1 --format=%s "$branch")" = "eshop-qa: deploy v0.3.0-rc.1" ] \
    && [ "$(git -C "$clone" diff --name-only "$branch~1" "$branch")" = clusters/local/qa-release.yaml ] \
    && (cd "$clone" && git checkout -q "$branch" && [ "$(scripts/pin-release.sh qa 2>/dev/null)" = 0.3.0-rc.1 ]) \
    && ! grep -q 'release-pin-until: qa$' "$clone/clusters/local/qa-release.yaml" \
    && grep -qF 'docker.io/pkhamdee/eshop-web:0.3.0-rc.1@sha256:bbbb' "$work/out" \
    && grep -qF 'CI run: https://github.com/test/run/1' "$work/out" \
    && grep -qF "$rc_commit" "$work/out" \
    && grep -qF 'https://qa.eshop.localhost' "$work/out" \
    && grep -qF 'starts eshop-qa' "$work/out" \
    && [ ! -s "$GH_LOG" ] \
    && ! origin rev-parse -q --verify refs/heads/$branch >/dev/null
}
check "promotion-pr.sh commits only the pin on a branch from origin/main and writes the PR body (no push)" \
  pin_commit_and_body

pushes_and_opens_pr() {
  git -C "$clone" checkout -q main
  : >"$GH_LOG"
  promote qa 0.3.0-rc.1 \
    && [ "$(origin log -1 --format=%s refs/heads/promote/qa-0.3.0-rc.1)" = "eshop-qa: deploy v0.3.0-rc.1" ] \
    && grep -qF 'gh pr create --base main --head promote/qa-0.3.0-rc.1 --title eshop-qa: deploy v0.3.0-rc.1' "$GH_LOG" \
    && grep -qF 'https://github.com/test/pull/1' "$work/out"
}
check "promotion-pr.sh pushes the branch and opens the PR into main" pushes_and_opens_pr

missing_tag_refused() { ! PROMOTION_PUSH=0 promote qa 0.3.0-rc.9 && grep -qF 'v0.3.0-rc.9' "$work/out"; }
check "promotion-pr.sh refuses a version with no tag" missing_tag_refused
dry_run_refused() { ! PROMOTION_PUSH=0 promote qa 0.0.0-test.1 && grep -qF 'usage: scripts/promotion-pr.sh' "$work/out"; }
check "promotion-pr.sh refuses a dry-run version" dry_run_refused

# --- scripts/sign-off.sh (the "Sign off release candidate" workflow) ---

services=$(jq -r '.[].service' "$root/.github/services.json")
fake_digest() { echo "sha256:$(echo "$1" | git hash-object --stdin)$(echo "x$1" | git hash-object --stdin | cut -c1-24)"; }
image() { echo "$REGISTRY/docker.io/pkhamdee/$1/$2"; } # the fake registry's file for image <service> tag <tag>
# QA runs of e2e.yml as `gh run list --json` gives them (newest first). Main pins QA to 0.3.0-rc.1 in a commit made
# at $pinned_at (sign_off_setup); this run of it passed after that.
pinned_at=2026-10-30T00:00:00Z
passed_qa_run='{"conclusion":"success","createdAt":"2026-10-30T01:00:00Z","databaseId":7,"displayTitle":"E2E qa 0.3.0-rc.1","url":"https://github.com/test/actions/runs/7"}'

# A fresh origin where candidate v0.3.0-rc.1 is tagged on release/0.x, main pins QA to it, and the registry holds
# its images. QA's run of it passed ($FAKE_QA_RUNS), and the person signing off is a maintainer ($FAKE_ROLE).
sign_off_setup() {
  clone=$(fresh "$1")
  rm -f "$GH_STATE"/*
  git -C "$clone" push -q origin HEAD:refs/heads/release/0.x
  git -C "$clone" tag -a v0.3.0-rc.1 -m "Release candidate 0.3.0-rc.1"
  git -C "$clone" push -q origin refs/tags/v0.3.0-rc.1
  rc_commit=$(git -C "$clone" rev-parse 'v0.3.0-rc.1^{commit}')
  (cd "$clone" && scripts/pin-release.sh qa 0.3.0-rc.1 >/dev/null 2>&1)
  GIT_COMMITTER_DATE=$pinned_at git -C "$clone" commit -qam "eshop-qa: deploy v0.3.0-rc.1"
  git -C "$clone" push -q origin HEAD:main
  export REGISTRY="$work/$1/registry" FAKE_QA_RUNS="[$passed_qa_run]"
  for svc in $services; do mkdir -p "$(dirname "$(image "$svc" x)")"; fake_digest "$svc" >"$(image "$svc" 0.3.0-rc.1)"; done
}
sign_off() { (cd "$clone" && SIGN_OFF_ACTOR=qa-person scripts/sign-off.sh "$@") >"$work/out" 2>&1; }

# A refused sign-off changes nothing: no ref on origin, no image, no Release, no PR.
registry_state() { (cd "$REGISTRY" && find . -type f -exec grep -H . {} + | sort); }
sign_off_refused() { # sign_off_refused <expected message part> <sign-off.sh args...>
  local expected=$1; shift
  refs_before; registry_state >"$work/registry"; : >"$GH_LOG"; : >"$CRANE_LOG"
  ! sign_off "$@" && grep -qF -- "$expected" "$work/out" && refs_unchanged \
    && [ "$(registry_state)" = "$(cat "$work/registry")" ] \
    && ! grep -qE '^gh (release (create|edit)|pr (create|edit))' "$GH_LOG" && ! grep -q '^crane copy' "$CRANE_LOG"
}

sign_off_setup sign-off-refusals
FAKE_ROLE="write" check "sign-off.sh refuses someone who is not a maintainer (admin or maintain)" \
  sign_off_refused 'qa-person is not a maintainer' 0.3.0-rc.1
check "sign-off.sh refuses a version that is not a release candidate" \
  sign_off_refused 'usage: scripts/sign-off.sh X.Y.Z-rc.N' 0.3.0
check "sign-off.sh refuses a candidate whose tag is not on origin" \
  sign_off_refused 'release candidate v0.3.0-rc.9 is not on origin' 0.3.0-rc.9

git -C "$clone" tag -a v0.3.0-rc.2 -m "Release candidate 0.3.0-rc.2" 'v0.3.0-rc.1^{commit}'
git -C "$clone" push -q origin refs/tags/v0.3.0-rc.2
check "sign-off.sh refuses a candidate QA is not running (main pins QA to another)" \
  sign_off_refused 'eshop-qa is pinned to 0.3.0-rc.1 on main, not 0.3.0-rc.2' 0.3.0-rc.2

qa_suspended_refused() {
  # main pins QA to the candidate but still suspends apps-qa: QA runs nothing.
  sed 's/"0.2.0" # release-pin: qa$/"0.3.0-rc.1" # release-pin: qa/' "$root/clusters/local/qa-release.yaml" \
    >"$clone/clusters/local/qa-release.yaml"
  git -C "$clone" commit -qam "suspend QA"
  git -C "$clone" push -q origin HEAD:main
  sign_off_refused 'eshop-qa has no release yet on main (apps-qa is suspended)' 0.3.0-rc.1
  local refused=$?
  git -C "$clone" reset -q --hard HEAD~1
  git -C "$clone" push -q --force origin HEAD:main
  return $refused
}
check "sign-off.sh refuses while apps-qa is suspended on main" qa_suspended_refused

no_qa_run_refused() {
  sign_off_refused 'no completed QA run of 0.3.0-rc.1 on main since eshop-qa was pinned to it' 0.3.0-rc.1 \
    && grep -qF '("E2E qa 0.3.0-rc.1"): run e2e/run-on-actions.sh qa 0.3.0-rc.1' "$work/out" \
    && grep -qF 'gh run list --repo pkhamdee/modernapp --workflow e2e.yml --branch main --event workflow_dispatch --status completed' "$GH_LOG" \
    && grep -qF '.displayTitle == "E2E qa 0.3.0-rc.1"' "$GH_LOG"
}
FAKE_QA_RUNS="[]" check "sign-off.sh refuses a candidate with no completed QA run on main (the documented query)" \
  no_qa_run_refused
failed_qa_run=${passed_qa_run/success/failure}
failed_qa_run=${failed_qa_run/T01:00/T02:00}
FAKE_QA_RUNS="[$failed_qa_run, $passed_qa_run]" check "sign-off.sh refuses when the latest QA run did not pass" \
  sign_off_refused 'did not pass (failure): https://github.com/test/actions/runs/7' 0.3.0-rc.1
# rc.1 -> rc.2 -> rc.1: a run of rc.1 from before main last pinned QA to it tested an earlier deployment of it.
stale_qa_run=${passed_qa_run/2026-10-30T01:00/2026-10-29T23:00}
FAKE_QA_RUNS="[$stale_qa_run]" check "sign-off.sh ignores QA runs created before main last changed QA's pin" \
  sign_off_refused "no completed QA run of 0.3.0-rc.1 on main since eshop-qa was pinned to it ($pinned_at)" 0.3.0-rc.1

missing_image_refused() {
  mv "$(image eshop-sync-master 0.3.0-rc.1)" "$work/held"
  sign_off_refused 'candidate image docker.io/pkhamdee/eshop-sync-master:0.3.0-rc.1 is missing' 0.3.0-rc.1
  local refused=$?
  mv "$work/held" "$(image eshop-sync-master 0.3.0-rc.1)"
  return $refused
}
check "sign-off.sh refuses when a candidate image is missing (copies none)" missing_image_refused

other_release_image_refused() {
  echo sha256:other >"$(image eshop-web 0.3.0)"
  sign_off_refused 'docker.io/pkhamdee/eshop-web:0.3.0 already exists with a different digest' 0.3.0-rc.1
  local refused=$?
  rm "$(image eshop-web 0.3.0)"
  return $refused
}
check "sign-off.sh refuses to overwrite a release image with another digest" other_release_image_refused

released_refused() {
  git -C "$clone" tag -a v0.3.0 -m "Release 0.3.0" origin/main # not this candidate's commit, not a sign-off
  git -C "$clone" push -q origin refs/tags/v0.3.0
  sign_off_refused 'v0.3.0 already exists and is not a sign-off of v0.3.0-rc.1' 0.3.0-rc.1
}
check "sign-off.sh refuses when vX.Y.Z already exists (released otherwise)" released_refused

same_digests() { # every service's 0.3.0 image exists with its candidate's digest
  local svc
  for svc in $services; do
    [ -f "$(image "$svc" 0.3.0)" ] && [ "$(cat "$(image "$svc" 0.3.0)")" = "$(fake_digest "$svc")" ] || return 1
  done
}
lists_images() { # lists_images <file>: names every 0.3.0 image with its digest
  local svc
  for svc in $services; do grep -qF "docker.io/pkhamdee/$svc:0.3.0@$(fake_digest "$svc")" "$1" || return 1; done
}
signs_off() {
  sign_off_setup sign-off
  : >"$GH_LOG"; : >"$CRANE_LOG"
  sign_off 0.3.0-rc.1 || return 1
  local release="$GH_STATE/release-v0.3.0" pr="$GH_STATE/pr-promote_prod-0.3.0"
  [ "$(origin cat-file -t refs/tags/v0.3.0)" = tag ] \
    && [ "$(origin rev-parse 'refs/tags/v0.3.0^{commit}')" = "$rc_commit" ] \
    && origin cat-file tag refs/tags/v0.3.0 | grep -qF 'Signed off from v0.3.0-rc.1 by @qa-person' \
    && same_digests \
    && grep -qE '^crane copy docker.io/pkhamdee/eshop-api@sha256:[0-9a-f]+ docker.io/pkhamdee/eshop-api:0.3.0$' "$CRANE_LOG" \
    && lists_images "$release" \
    && grep -qF 'https://github.com/test/actions/runs/7' "$release" && grep -qF '@qa-person' "$release" \
    && grep -qF 'gh release create v0.3.0 --repo pkhamdee/modernapp --verify-tag' "$GH_LOG" \
    && [ "$(origin log -1 --format=%s refs/heads/promote/prod-0.3.0)" = "eshop-prod: deploy v0.3.0" ] \
    && [ "$(origin show refs/heads/promote/prod-0.3.0:clusters/local/prod-release.yaml | grep -c '"0.3.0" # release-pin: prod$')" -ge 2 ] \
    && lists_images "$pr" && grep -qF 'https://github.com/test/actions/runs/7' "$pr" && grep -qF '@qa-person' "$pr" \
    && grep -qF 'https://github.com/test/releases/tag/v0.3.0' "$pr" \
    && grep -qF 'Promotion PR: https://github.com/test/pull/1' "$work/out"
}
check "sign-off.sh tags vX.Y.Z on the candidate's commit, copies its images by digest, publishes the Release and opens the prod promotion PR" \
  signs_off

signs_off_again() { # after signs_off: the same sign-off again finds every step done and updates the Release and PR
  local tag_object
  tag_object=$(origin rev-parse refs/tags/v0.3.0)
  git -C "$clone" checkout -q main
  : >"$GH_LOG"; : >"$CRANE_LOG"
  sign_off 0.3.0-rc.1 \
    && [ "$(origin rev-parse refs/tags/v0.3.0)" = "$tag_object" ] && same_digests \
    && ! grep -q '^crane copy' "$CRANE_LOG" \
    && grep -q '^gh release edit v0.3.0' "$GH_LOG" && ! grep -q '^gh release create' "$GH_LOG" \
    && grep -q '^gh pr edit' "$GH_LOG" && ! grep -q '^gh pr create' "$GH_LOG"
}
check "sign-off.sh run again changes no tag or image and updates the Release and the PR" signs_off_again

finishes_interrupted_sign_off() {
  sign_off_setup sign-off-interrupted
  FAKE_CRANE_FAIL_COPY=docker.io/pkhamdee/eshop-web sign_off 0.3.0-rc.1 && return 1
  grep -qF 'copy to docker.io/pkhamdee/eshop-web:0.3.0 failed' "$work/out" || return 1
  # Stopped while copying images: no tag, Release or PR names images that don't exist.
  [ -z "$(origin tag -l v0.3.0)" ] && [ ! -e "$GH_STATE/release-v0.3.0" ] || return 1
  git -C "$clone" checkout -q main
  sign_off 0.3.0-rc.1 && same_digests \
    && [ "$(origin rev-parse 'refs/tags/v0.3.0^{commit}')" = "$rc_commit" ] \
    && [ -e "$GH_STATE/release-v0.3.0" ] && [ -e "$GH_STATE/pr-promote_prod-0.3.0" ]
}
check "sign-off.sh interrupted half-way is finished by running it again" finishes_interrupted_sign_off

# --- scripts/check-new-images.sh (CI's push job, before pushing a version's images) ---

export REGISTRY="$work/new-images/registry"
mkdir -p "$REGISTRY/docker.io/pkhamdee/eshop-api" "$REGISTRY/docker.io/pkhamdee/eshop-web"
echo sha256:aaaa >"$REGISTRY/docker.io/pkhamdee/eshop-api/0.3.0-rc.1"
echo sha256:bbbb >"$REGISTRY/docker.io/pkhamdee/eshop-web/0.2.0"
new_images() { (cd "$root" && scripts/check-new-images.sh "$@") >"$work/out" 2>&1; }

all_new_passes() { # eshop-web has other tags only; eshop-new has no repository yet
  new_images docker.io/pkhamdee/eshop-web:0.3.0-rc.1 docker.io/pkhamdee/eshop-new:0.3.0-rc.1
}
check "check-new-images.sh passes when no image exists yet (also in a repository not created yet)" all_new_passes
existing_refused() {
  ! new_images docker.io/pkhamdee/eshop-web:0.3.0-rc.1 docker.io/pkhamdee/eshop-api:0.3.0-rc.1 \
    && grep -qF 'docker.io/pkhamdee/eshop-api:0.3.0-rc.1' "$work/out" \
    && ! grep -qF 'eshop-web:0.3.0-rc.1' "$work/out" && grep -qF 'never overwritten' "$work/out"
}
check "check-new-images.sh refuses a version image that already exists, naming it" existing_refused
registry_error_fails() {
  ! FAKE_CRANE_LS_ERROR=1 new_images docker.io/pkhamdee/eshop-web:0.3.0-rc.1 \
    && grep -qF 'could not list the tags of docker.io/pkhamdee/eshop-web' "$work/out"
}
check "check-new-images.sh fails when it can't tell (a registry error is not \"absent\")" registry_error_fails
usage_refused() { ! new_images && grep -qF 'usage: scripts/check-new-images.sh' "$work/out"; }
check "check-new-images.sh needs at least one image" usage_refused

# --- scripts/protect-main.sh (main's ruleset and the release environment; applied by a maintainer) ---

repo_api=repos/pkhamdee/modernapp
protect() { (cd "$root" && scripts/protect-main.sh "$@") >"$work/out" 2>&1; }
# sent <METHOD path>: the JSON bodies printed under that request in a --dry-run's output, as a JSON array
sent() { awk -v h="$1" '$0 == h { on = 1; next } /^[^ {}[\]]/ { on = 0 } on' "$work/out" | jq -s .; }
writes() { grep -c -- ' --method ' "$GH_LOG" || true; }
# The required checks: every job a pull request runs in ci-release.yml, by its name (the check's context).
required_checks='[
  "SAST (Semgrep, fail on ERROR)",
  "dependency scan (Trivy, fail on critical)",
  "eshop-api (lint, test)",
  "eshop-node-api (lint, test)",
  "eshop-web (lint, build)",
  "repo rules (manifests, workflows, scripts, e2e)",
  "thirdparty-mock (lint, type-check)"
]'
# The tag rulesets: v* tags never deleted, moved or force-pushed by anyone; created only by admins (repository role
# 5) and maintainers (2). Separate, since a bypass actor bypasses every rule of its ruleset.
tag_rulesets='[
  {"name": "Create release tags", "target": "tag", "enforcement": "active",
   "conditions": {"ref_name": {"include": ["refs/tags/v*"], "exclude": []}},
   "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"},
                     {"actor_id": 2, "actor_type": "RepositoryRole", "bypass_mode": "always"}],
   "rules": [{"type": "creation"}]},
  {"name": "Protect release tags", "target": "tag", "enforcement": "active",
   "conditions": {"ref_name": {"include": ["refs/tags/v*"], "exclude": []}},
   "bypass_actors": [],
   "rules": [{"type": "deletion"}, {"type": "update"}, {"type": "non_fast_forward"}]}
]'

dry_run_prints_and_changes_nothing() {
  rm -f "$GH_STATE"/*; : >"$GH_LOG"
  FAKE_NO_ENVIRONMENT=1 protect --dry-run || return 1
  local ruleset env policies
  ruleset=$(sent "POST $repo_api/rulesets"); env=$(sent "PUT $repo_api/environments/release")
  policies=$(sent "POST $repo_api/environments/release/deployment-branch-policies")
  [ "$(writes)" = 0 ] && [ -z "$(ls "$GH_STATE")" ] \
    && jq -e --argjson tags "$tag_rulesets" '[.[] | select(.target == "tag")] | sort_by(.name) == $tags' \
      <<<"$ruleset" >/dev/null \
    && jq -e --argjson checks "$required_checks" '[.[] | select(.target == "branch")] | length == 1 and (.[0] |
         .name == "Protect main" and .target == "branch" and .enforcement == "active"
         and .conditions.ref_name.include == ["refs/heads/main"]
         and .bypass_actors == [{"actor_id": null, "actor_type": "DeployKey", "bypass_mode": "always"}]
         and ([.rules[].type] | sort) == ["deletion", "non_fast_forward", "pull_request", "required_status_checks"]
         and (.rules[] | select(.type == "pull_request") | .parameters.required_approving_review_count == 0
              and .parameters.dismiss_stale_reviews_on_push == false and .parameters.require_last_push_approval == false)
         and (.rules[] | select(.type == "required_status_checks") | .parameters
              | ([.required_status_checks[].context] | sort) == $checks
              and all(.required_status_checks[]; .integration_id == 15368)))' <<<"$ruleset" >/dev/null \
    && jq -e '. == [{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}]' \
      <<<"$env" >/dev/null \
    && jq -e 'sort_by(.name) == [{"name": "main", "type": "branch"}, {"name": "v*", "type": "tag"}]' \
      <<<"$policies" >/dev/null
}
check "protect-main.sh --dry-run prints main's ruleset (every PR check required, 0 approvals, Flux's deploy key bypasses), the tag rulesets (v* immutable, created by admins and maintainers only) and the release environment (main and v* tags only), sending nothing" \
  dry_run_prints_and_changes_nothing

applies_idempotently() {
  rm -f "$GH_STATE"/*; : >"$GH_LOG"
  FAKE_RULESETS='[{"id":7,"name":"Protect release tags","target":"tag"},{"id":42,"name":"Protect main","target":"branch"}]' \
  FAKE_BRANCH_POLICIES='{"total_count":2,"branch_policies":[{"id":1,"name":"main","type":"branch"},{"id":9,"name":"release/*","type":"branch"}]}' \
    protect || return 1
  local s="$GH_STATE/api"
  jq -e '.name == "Protect main"' "$s-PUT-${repo_api//\//_}_rulesets_42" >/dev/null \
    && jq -e '.name == "Protect release tags" and ([.rules[].type] == ["deletion", "update", "non_fast_forward"])
              and .bypass_actors == []' "$s-PUT-${repo_api//\//_}_rulesets_7" >/dev/null \
    && [ "$(grep -c "api $repo_api/rulesets --method POST" "$GH_LOG")" = 1 ] \
    && jq -e '.name == "Create release tags" and .rules == [{"type": "creation"}]' \
      "$s-POST-${repo_api//\//_}_rulesets" >/dev/null \
    && [ -e "$s-PUT-${repo_api//\//_}_environments_release" ] \
    && [ "$(grep -c "api $repo_api/environments/release/deployment-branch-policies --method POST" "$GH_LOG")" = 1 ] \
    && jq -e '. == {"name": "v*", "type": "tag"}' \
      "$s-POST-${repo_api//\//_}_environments_release_deployment-branch-policies" >/dev/null \
    && [ -e "$s-DELETE-${repo_api//\//_}_environments_release_deployment-branch-policies_9" ] \
    && [ ! -e "$s-DELETE-${repo_api//\//_}_environments_release_deployment-branch-policies_1" ]
}
check "protect-main.sh updates existing rulesets in place (release tags keep their rules), creates a missing one and leaves the environment exactly main and v* tags" \
  applies_idempotently

two_approvals() {
  protect --dry-run --approvals 2 \
    && sent "POST $repo_api/rulesets" | jq -e '.[0].rules[] | select(.type == "pull_request") | .parameters
         | .required_approving_review_count == 2 and .dismiss_stale_reviews_on_push == true
           and .require_last_push_approval == true' >/dev/null
}
check "protect-main.sh --approvals 2 requires two approvals, dismisses stale ones and the last push's approval" \
  two_approvals
bad_approvals_refused() {
  : >"$GH_LOG"; ! protect --approvals two && grep -qF 'usage: scripts/protect-main.sh' "$work/out" && [ ! -s "$GH_LOG" ]
}
check "protect-main.sh refuses a malformed --approvals and calls nothing" bad_approvals_refused

[ "$failures" -eq 0 ] || { echo "$failures failed"; exit 1; }
echo "all passed"
