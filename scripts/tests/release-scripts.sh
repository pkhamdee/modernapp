#!/usr/bin/env bash
# Tests for the release scripts, run against throwaway Git repos (a bare "origin" and clones of it), never GitHub:
#   scripts/release.sh             cuts release-candidate tags
#   scripts/check-release-tag.sh   CI's decision on a pushed v* tag
#   scripts/promotion-pr.sh        the promotion PR's branch, pin commit and body
# `gh` is a fake on PATH that records its arguments. Run from anywhere: scripts/tests/release-scripts.sh
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

# Fake gh: logs every call; `run list` finds a run, `pr list` finds no PR, `pr create` prints a PR URL.
mkdir -p "$work/bin"
cat >"$work/bin/gh" <<'GH'
#!/usr/bin/env bash
echo "gh $*" >>"$GH_LOG"
case "$1 $2" in
  "run list") echo "https://github.com/test/run/1" ;;
  "pr list") ;;
  "pr create") echo "https://github.com/test/pull/1" ;;
esac
GH
chmod +x "$work/bin/gh"
export PATH="$work/bin:$PATH" GH_LOG="$work/gh.log"

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
  mkdir -p "$dir/seed/clusters"
  cp -R "$root/scripts" "$dir/seed/"
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

[ "$failures" -eq 0 ] || { echo "$failures failed"; exit 1; }
echo "all passed"
