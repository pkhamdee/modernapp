# Git Workflow: Version Control with Tags

This project uses the **tag-based release workflow**: one maintenance branch per minor series, and annotated tags marking each release. CI/CD builds releases from tags.

Source: [Git Workflow for Release Management: Branches vs Tags](https://pkhamdee.blog/2026/05/29/git-workflow-for-release-management-branches-vs-tags/) (Workflow B).

> This repo's integration branch is **`main`** (the article says `master`; read every `master` there as `main`).

## The one rule

**Every fix that lands on a `release/N.x` branch must also land on `main`.** If it doesn't, the next release regresses. Check this in code review before merging any fix to a release branch.

```bash
# Is the fix on main?
git log main --oneline | grep <short-hash>

# Which branches contain this commit?
git branch --contains <commit-hash>
```

Cherry-picked commits get new hashes, so when the hash doesn't match, search by subject instead: `git log main --oneline --grep "<subject>"`.

## Branches

| Branch | Purpose | Lifetime |
|---|---|---|
| `main` | Integration branch for active development. The only place new features land. Not production. | Permanent |
| `release/N.x` | Maintenance branch for one minor series (e.g. `release/1.x`). Fixes only. | Kept while the series is supported |
| `feature/*`, `issue/*` | Short-lived branches for one task | Deleted after merge |

Production state is defined by **tags**, not branches.

## Tags

- Format: `vMAJOR.MINOR.PATCH` (semantic versioning), e.g. `v1.0.0`, `v1.0.1`.
- Always **annotated**: `git tag -a vX.Y.Z -m "Release X.Y.Z"`. Never use lightweight tags for releases.
- Tag only on a `release/N.x` branch, never on `main`.
- Never move or delete a pushed release tag. If a release is bad, ship the next patch version.

Git itself does not stop anyone from force-moving or deleting a tag. On GitHub, the **"Protect release tags"** ruleset (Settings → Rules → Rulesets) blocks deletion, update and force-push of any `v*` tag, with no bypass.

## Lifecycle

### 1. Before the first release

Everyone works on `main` through `feature/*` / `issue/*` branches and pull requests.

```bash
git checkout main
git pull origin main
git checkout -b feature/<name>
# work, commit, push, open PR into main
```

### 2. Code freeze: fork the release branch

```bash
git checkout main
git pull origin main
git checkout -b release/1.x
git push origin release/1.x
```

After the freeze:
- New features go to `main` only.
- Fixes for 1.x go to `release/1.x` **and** `main`.

### 3. Tag a release

```bash
git checkout release/1.x
git pull origin release/1.x
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0
```

Pushing the tag triggers the CI/CD release build. The branch stays open for future patches.

### 4. Patch release (also used for hotfixes)

There's no separate hotfix process; urgent fixes take this same route.

```bash
# Fix on the release branch
git checkout release/1.x
git cherry-pick <fix-commit>        # or merge an issue/* branch
git push origin release/1.x

# Carry the fix to main (the one rule)
git checkout main
git cherry-pick <fix-commit>
git push origin main

# Tag the patch
git checkout release/1.x
git tag -a v1.0.1 -m "Release 1.0.1 — <what was fixed>"
git push origin v1.0.1
```

### 5. Next minor release

At the next freeze, fork the next series branch (e.g. `release/2.x`) from `main` and repeat from step 2. Older `release/N.x` branches remain for maintenance while supported.

## Fix routing at a glance

```
fix ──► release/1.x ──► tag v1.0.1 ──► CI/CD release build
          │
          └── cherry-pick ──► main
```

## Auditing

```bash
git tag -l "v*" --sort=-v:refname          # list releases, newest first
git log v1.0.0..v1.0.1 --oneline           # what changed between two releases
git show v1.0.1                            # tag message + commit
git log main..release/1.x --oneline        # commits on release/1.x not yet on main (check these)
```

## CI/CD

Defined in `.github/workflows/ci-release.yml`:

- Pushes and PRs to `main` and `release/*` run tests only; they don't publish anything.
- Pushing a `v*` tag runs tests, then validates the tag (must be `vX.Y.Z`, annotated, and on a `release/N.x` branch) and publishes a GitHub Release with generated notes. Add build and artifact steps there once the app has a toolchain.
- If the build system can't trigger on tags, this workflow doesn't fit; switch to the branch-based workflow (Workflow A in the source article).

## Why tags rather than branches

| | Branches (Workflow A) | Tags (this project) |
|---|---|---|
| Build triggered by | Branch name | Tag name |
| Release snapshot | `release/1.0`, `release/1.0.1` branches | `v1.0.0`, `v1.0.1` tags |
| Patches per minor series | Accumulate on `staging/1.x` | Same `release/1.x` branch, multiple tags |
| Immutability | Convention | Tag points at exactly one commit (enforce with a tag ruleset) |
| Audit | Diff release branches | `git log v1.0.1..v1.0.2` |
| Branch count | More | Fewer, cleaner history |
