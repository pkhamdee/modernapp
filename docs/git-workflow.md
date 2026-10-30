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

- Pushes and PRs to `main` and `release/*` lint and test every service. Pushes to `release/*` publish nothing.
- Pushes to `main` also build the changed services' images as `main-<sha>`; Flux deploys them to `sphone-dev` (`https://sphone.localhost`).
- Pushing a `v*` tag lints and tests, validates the tag (must be `vX.Y.Z`, annotated, and on a `release/N.x` branch), builds **every** service in `.github/services.json` for arm64, scans each with Trivy (fails on critical), pushes `ghcr.io/pkhamdee/<service>:X.Y.Z`, and only then publishes the GitHub Release with generated notes.
- If the build system can't trigger on tags, this workflow doesn't fit; switch to the branch-based workflow (Workflow A in the source article).

### How a tag reaches `sphone-prod`

`sphone-prod` runs exactly one release: the manifests in `deploy/apps/prod` (and `deploy/apps/base`) **as they are in tag `vX.Y.Z`**, with the `X.Y.Z` images built from that same tag. Nothing is committed to a release branch or tag, and changes on `main` never reach prod until they are released.

```
git push origin vX.Y.Z
  └─ CI: test → validate tag → build + scan + push ghcr.io/pkhamdee/<service>:X.Y.Z (every service) → GitHub Release
       └─ Flux (clusters/local/prod-release.yaml):
            ImageRepository scans GHCR every minute → ImagePolicy sphone-release picks the newest plain X.Y.Z
            (never main-<sha>, never a 0.0.0-test.N dry run)
            → ImageUpdateAutomation sphone-prod commits ONE change to clusters/local on main
              ("sphone-prod: follow the newest release"):
                GitRepository sphone-release  ref.semver → X.Y.Z   (checks out tag vX.Y.Z)
                Kustomization apps-prod       images     → X.Y.Z
            → apps-prod applies deploy/apps/prod from tag vX.Y.Z with the X.Y.Z images (https://prod.sphone.localhost)
```

Prod moves to a tag only once its images exist, so it never runs one release's manifests with another release's images. Expect a few minutes from tag push to rollout. To check:

```bash
gh run list --workflow ci-release.yml --branch vX.Y.Z      # CI for the tag
flux get images policy sphone-release                      # latest image = X.Y.Z
flux get kustomization apps-prod                           # Applied revision: vX.Y.Z@sha1:...
kubectl -n sphone-prod get deploy -o wide                  # images :X.Y.Z
curl -k https://prod.sphone.localhost/api/product-categories
```

### Releasing

The first release (and every later minor release) is the lifecycle above, nothing more:

```bash
git checkout main && git pull origin main
git checkout -b release/0.x
git push origin release/0.x
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

Before the first release there is nothing for prod to run: the GitRepository `sphone-release` points at `v0.0.0` (which never exists), so it, the ImagePolicy `sphone-release` and `apps-prod` show not Ready (`no match found for semver: 0.0.0`). That is expected; they turn Ready a few minutes after `v0.1.0` is pushed.

Things to know:

- **Newest wins.** The ImagePolicy selects the highest semver release across all series, so a patch on an older series (`v1.0.5` while `v2.0.0` is out) is built and released but does not replace the newer version in `sphone-prod`.
- **Prod-only changes** (e.g. a prod patch in `deploy/apps/prod`) are released like code: land them on `main` (and the release branch, if it should ship as a patch), then tag.
- **Services finish building at different times.** The release is detected from `sphone-api`'s `X.Y.Z` tag; a service whose image is pushed a minute later just retries its image pull until it exists.
- **Rollback** = ship the next patch (tags are immutable). In an emergency, suspend the automation (`flux suspend image update sphone-prod`) and set `ref.semver` of `sphone-release` and the `images` of `apps-prod` in `clusters/local/` to an earlier release in a PR; resume afterwards.
- **Release dry run** without a tag: Actions → CI / Release → Run workflow with `version` = `0.0.0-test.N` (any branch). It builds, scans and pushes every service as that pre-release tag and publishes no Release. It is never deployed.
- **Adding a service** to releases: an entry in `.github/services.json` (and its lint/test job in `plan.needs`) is enough for CI to build it on every tag. To run it in prod, add it to `deploy/apps/prod` resources and an `images:` entry (with the `flux-system:sphone-release` marker) to `apps-prod` in `clusters/local/apps.yaml`; its HTTPRoutes are moved to `prod.sphone.localhost` automatically.

## Why tags rather than branches

| | Branches (Workflow A) | Tags (this project) |
|---|---|---|
| Build triggered by | Branch name | Tag name |
| Release snapshot | `release/1.0`, `release/1.0.1` branches | `v1.0.0`, `v1.0.1` tags |
| Patches per minor series | Accumulate on `staging/1.x` | Same `release/1.x` branch, multiple tags |
| Immutability | Convention | Tag points at exactly one commit (enforce with a tag ruleset) |
| Audit | Diff release branches | `git log v1.0.1..v1.0.2` |
| Branch count | More | Fewer, cleaner history |
