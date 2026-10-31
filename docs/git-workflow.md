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
- Every push, PR and tag also runs the SAST gate (Semgrep, fails on ERROR) and the dependency-scan gate (Trivy over the lockfiles, fails on critical) from `scripts/gates/`, keeping their reports as artifacts (`docs/setup.md`, "Running the gates locally").
- Pushes to `main` also build the changed services' images as `main-<sha>`; Flux deploys them to `eshop-dev` (`https://eshop.localhost`).
- Pushing a `v*` tag lints and tests, validates the tag (must be `vX.Y.Z`, annotated, and on a `release/N.x` branch), builds **every** service in `.github/services.json` for arm64, gates and scans them (below), pushes `docker.io/pkhamdee/<service>:X.Y.Z`, and only then publishes the GitHub Release with generated notes.
- **Release gates before any push** (ADR 0007), on `main` pushes, release tags and release dry runs, never on pull requests:
  `build` (one arm64 job per image, handed on as an artifact) → `gate`: the **temporary copy** of eShop started from
  those images must become healthy and seeded (`scripts/gates/temporary-copy.sh up`; services a `main` push didn't
  rebuild run their newest `main-<sha>-<ts>` build, as `eshop-dev` does), then the gates against it (Locust and ZAP,
  #70–#72) → `scan`: Trivy on every image built (fails on critical) → `push`. If any step fails, no image is pushed,
  so `eshop-dev` never runs it. The temporary copy runs the same way locally (`docs/setup.md`, "Temporary copy").
- If the build system can't trigger on tags, this workflow doesn't fit; switch to the branch-based workflow (Workflow A in the source article).

### How a release reaches `eshop-prod`

`eshop-prod` runs exactly one release, **pinned in Git**: the manifests in `deploy/apps/prod` (and `deploy/apps/base`) **as they are in tag `vX.Y.Z`**, with the `X.Y.Z` images built from that same tag. Pushing a tag does **not** change prod; nothing follows tags automatically. Prod moves only when a **promotion PR** that changes the pin is merged into `main`, and merging it is the production approval. Nothing is committed to a release branch or tag, and changes on `main` never reach prod until they are released and promoted.

The pin is the lines ending in `# release-pin: prod` in `clusters/local/prod-release.yaml`, which always hold the same exact version:

| Line | Object | Means |
|---|---|---|
| `semver: "X.Y.Z" # release-pin: prod` | GitRepository `eshop-release`, `spec.ref` | the source at tag `vX.Y.Z` (an exact version selects exactly that tag) |
| `newTag: "X.Y.Z" # release-pin: prod` (one per service) | Kustomization `apps-prod`, `spec.images` | the `X.Y.Z` images |

```
promotion PR (scripts/pin-release.sh prod X.Y.Z) ── merged into main
  └─ Flux Kustomization flux-system applies clusters/local:
       GitRepository eshop-release checks out tag vX.Y.Z; apps-prod's images → X.Y.Z
       └─ apps-prod applies deploy/apps/prod from tag vX.Y.Z with the X.Y.Z images (https://prod.eshop.localhost)
```

To check what prod runs:

```bash
scripts/pin-release.sh prod                                 # the pinned release, from Git
flux get kustomization apps-prod                            # Applied revision: vX.Y.Z@sha1:...
kubectl -n eshop-prod get deploy -o wide                    # images :X.Y.Z
curl -k https://prod.eshop.localhost/api/product-categories
```

### QA (`eshop-qa`)

`eshop-qa` (`https://qa.eshop.localhost`) is pinned exactly like prod, to one **release candidate** (`vX.Y.Z-rc.N`): the lines ending in `# release-pin: qa` in `clusters/local/qa-release.yaml` (GitRepository `eshop-qa`, `spec.ref`, and Kustomization `apps-qa`'s `spec.images`). It moves only when a **QA promotion PR** changes that pin and is merged; merging is QA's approval. Its manifests come from `deploy/apps/qa` as it is in the candidate's tag, a copy of the prod overlay with QA's namespace, hostname, Samba share and Enterprise database. Its PostgreSQL keeps its data from one candidate to the next, as prod's does.

**No release yet.** A tag carries its own overlay (below), and `deploy/apps/qa` first appears in the first release candidate cut after #74 landed, so QA cannot run `v0.2.0` or any earlier tag. Until the first QA promotion, `apps-qa` is suspended by a line ending in `# release-pin-until: qa`, and the pin holds `0.2.0` only as a placeholder (`scripts/pin-release.sh qa` prints it and says QA is not deployed). The first QA promotion is the same one-command edit as any other: `scripts/pin-release.sh qa X.Y.Z-rc.N` sets the pin **and deletes the suspend line**, so merging it deploys QA for the first time. Everything else QA needs (namespace, Gateway listener, certificate name, thirdparty accounts, NetworkPolicies) is shared infrastructure that follows `main`, already in place.

To check what QA runs: `scripts/pin-release.sh qa` (what Git asks for), `e2e/check-serving.sh qa X.Y.Z-rc.N` (whether the cluster actually serves it), `flux get kustomization apps-qa` (`Applied revision: vX.Y.Z-rc.N@sha1:...`), `kubectl -n eshop-qa get deploy -o wide`.

### QA test run

Once QA serves a release candidate, QA tests it by running the Playwright UI suite against `https://qa.eshop.localhost` **through CI**, so the run is recorded against that candidate. From this Mac (the cluster is local, so the job runs on an on-demand runner here):

```bash
e2e/run-on-actions.sh qa X.Y.Z-rc.N      # E2E smoke test workflow, environment qa, version X.Y.Z-rc.N
```

or Actions → **E2E smoke test** → Run workflow (environment `qa`, version `X.Y.Z-rc.N`) while a runner labelled `eshop-e2e` is online. The run:

- **refuses unless QA is serving exactly that candidate**, asked of the cluster rather than Git (`e2e/check-serving.sh`): `apps-qa` not suspended, Ready, its latest spec applied, last applied revision `vX.Y.Z-rc.N@sha1:...` and every image it sets `X.Y.Z-rc.N`; every Deployment in `eshop-qa` rolled out with its `docker.io/pkhamdee/*` images at `X.Y.Z-rc.N`. `run-on-actions.sh` makes the same check before registering a runner. A merged pin that Flux hasn't applied yet, a suspended QA or a half-finished rollout all refuse; wait until Flux is Ready and run it again;
- checks the same again **after** the test, and fails if QA moved or was redeployed meanwhile;
- is named **`E2E qa X.Y.Z-rc.N`**, and its job summary records the environment, the version, the applied revision and every image, and the commit of the test code.

Sign-off looks for **the latest completed QA run of that candidate** by its name, on `main` only (a run dispatched from another branch runs that branch's copy of the workflow, which might skip the check), and requires it to have passed:

```bash
gh run list --repo pkhamdee/modernapp --workflow e2e.yml --branch main --event workflow_dispatch \
  --status completed --limit 100 --json databaseId,displayTitle,conclusion,url \
  --jq '[.[] | select(.displayTitle == "E2E qa X.Y.Z-rc.N")] | first'
# -> {"conclusion":"success", "databaseId":..., "url":"https://github.com/.../actions/runs/..."}; no run gives null
```

The same environment-and-version check applies to prod: `e2e/run-on-actions.sh prod X.Y.Z` (run named `E2E prod X.Y.Z`); without a version (`e2e/run-on-actions.sh`, `E2E prod`) it is the plain post-release smoke test, as is `e2e/run-on-actions.sh dev` (`E2E dev`; dev follows `main` and has no version).

### Promotion and rollback

A promotion PR changes **only the pin**. The edit is mechanical, and the same for a person or for CI, for prod or QA:

```bash
git checkout -b promote/prod-X.Y.Z origin/main
scripts/pin-release.sh prod X.Y.Z           # rewrites every `# release-pin: prod` line to "X.Y.Z"
git commit -am "eshop-prod: promote vX.Y.Z" # then push and open a PR into main

scripts/pin-release.sh qa X.Y.Z-rc.N        # a QA promotion: the same edit for `# release-pin: qa`
```

`scripts/pin-release.sh <env> <version>` accepts only an exact `X.Y.Z` or `X.Y.Z-rc.N` (never a range, never a `0.0.0-test.N` dry run), rewrites the value on every line ending in `# release-pin: <env>` in `clusters/local/*.yaml`, deletes any line ending in `# release-pin-until: <env>` (the suspend of an environment with no release yet) and prints the new pin; without a version it prints the current pin and fails if the lines are missing, disagree or hold anything but an exact version. CI's `repo rules` job runs it for every pinned environment (`scripts/validate-manifests.sh`), so a hand edit that misses a line fails the PR. Without the script, the edit is the same: replace the quoted version on each of those lines, nothing else.

Before opening the PR, check that the release exists: tag `vX.Y.Z` is pushed and every service's `X.Y.Z` image is on Docker Hub (`docker manifest inspect docker.io/pkhamdee/<service>:X.Y.Z`). A pin to a missing tag leaves `eshop-release` not Ready and prod on its previous release; a missing image leaves that one Deployment's new pod in `ImagePullBackOff` while the old pod keeps serving. Either way, fix it with another promotion PR.

Once merged, Flux applies it within a minute or two; `flux reconcile kustomization flux-system --with-source` hurries it.

**Rollback** is a promotion PR back to an earlier release (`scripts/pin-release.sh prod <earlier X.Y.Z>`), reviewed and merged the same way. It moves the manifests and images back but **never the data**: eshop-api migrates the database forwards on start-up and nothing migrates it backwards. A rollback is therefore safe **only when the schema is compatible**: the earlier release must work with the database as the later one left it. In practice that means no migration between the two releases removed, renamed or retyped anything the earlier release reads or writes (`git diff vEARLIER..vLATER -- services/eshop-api/src/Eshop.Data/Migrations`). If it did, roll forward instead: fix on the release branch, tag the next patch and promote that.

A release tag also carries **its own overlay**: the environment's manifests come from `deploy/apps/<env>` as it is in that tag, not from `main`. So an environment can be pinned (or rolled back) only to a release whose tag already contains that environment's overlay and the settings it needs: for prod, `v0.2.0` or later; for QA, the first release candidate cut after #74 or later ([QA](#qa-eshop-qa)). Releases before `v0.2.0` used the old names and can never be rolled back to (docs/setup.md, "Moving to eShop"). Likewise, a fix to an overlay reaches the environment only with the next release that contains it.

### Releasing

Releasing is a **human step**: agents are not allowed to push release tags, so an agent hands this to the user. `scripts/release.sh X.Y.Z` runs the lifecycle above (steps 2 to 4):
- It forks `release/<MAJOR>.x` from `origin/main` if that branch doesn't exist yet.
- It tags the branch head with an annotated `vX.Y.Z` and pushes it, after you confirm.
- It waits until the tag's CI run has started and prints its URL.

It refuses when the commit to tag carries a GitHub skip-ci marker (`[skip ci]`, `[ci skip]`, …). GitHub skips every push workflow on such a commit, and a tag push counts. The tag would then never build and, being immutable, could only be replaced by the next version. That is what happened to `v0.1.0`, so the first release is `v0.1.1`. For the same reason, Flux's commit templates carry no skip-ci marker: CI ignores pushes that only touch `deploy/**` or `clusters/**` instead, and CI's `repo rules` job fails if a marker comes back. Keep markers out of your own commit messages too, even quoted, unless you mean them.

A release tag does not deploy anything: once its CI run has pushed the images, promote it to prod with a promotion PR ([Promotion and rollback](#promotion-and-rollback)).

Things to know:

- **Any release can be promoted**, in any order: the pin names one exact version, so a patch on an older series (`v1.0.5` while `v2.0.0` is out) reaches prod only if someone promotes it.
- **Prod-only changes** (e.g. a prod patch in `deploy/apps/prod`) are released like code: land them on `main` (and the release branch, if it should ship as a patch), tag, then promote.
- **Wait for every image.** Services finish building at different times; promote once the tag's CI run has finished (`gh run list --workflow ci-release.yml --branch vX.Y.Z`).
- **A bad release** is fixed by the next patch (tags are immutable) and a promotion PR, or by a rollback PR when the schema allows ([Promotion and rollback](#promotion-and-rollback)).
- **Release dry run** without a tag: Actions → CI / Release → Run workflow with `version` = `0.0.0-test.N` (any branch). It builds, scans and pushes every service as that pre-release tag and publishes no Release. It is never deployed.
- **Adding a service** to releases: an entry in `.github/services.json` (and its lint/test job in `plan.needs`) is enough for CI to build it on every tag. To run it in prod, add it to `deploy/apps/prod` resources and an `images:` entry to `apps-prod` in `clusters/local/prod-release.yaml` whose `newTag` line ends in `# release-pin: prod` (holding the current pin); its HTTPRoutes are moved to `prod.eshop.localhost` automatically. Do the same for QA (`deploy/apps/qa`, `apps-qa` in `clusters/local/qa-release.yaml`, `# release-pin: qa`), so QA tests what prod will run. The entry can land before a release with the service is promoted: an `images:` entry that matches no Deployment in the pinned release changes nothing.

## Why tags rather than branches

| | Branches (Workflow A) | Tags (this project) |
|---|---|---|
| Build triggered by | Branch name | Tag name |
| Release snapshot | `release/1.0`, `release/1.0.1` branches | `v1.0.0`, `v1.0.1` tags |
| Patches per minor series | Accumulate on `staging/1.x` | Same `release/1.x` branch, multiple tags |
| Immutability | Convention | Tag points at exactly one commit (enforce with a tag ruleset) |
| Audit | Diff release branches | `git log v1.0.1..v1.0.2` |
| Branch count | More | Fewer, cleaner history |
