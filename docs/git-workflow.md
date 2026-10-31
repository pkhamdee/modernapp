# Git workflow and releases

How a change gets from a branch to `eshop-dev`, and how a release gets through QA to `eshop-prod`. The reasons are
in [ADR 0007](adr/0007-release-gates-in-ci-and-promotion-prs.md); the one-off human setup is in
[setup.md](setup.md) ("Releasing").

```
issue/* ── PR (required checks) ──► main ── CI: gates, scan, push main-<sha> ──► Flux ──► eshop-dev
                                     │
         scripts/release.sh X.Y.Z-rc.N (tag on release/N.x)
                                     ▼
              CI: gates, scan, push X.Y.Z-rc.N ──► QA promotion PR ── merged (QA's approval) ──► eshop-qa
                                                                                                    │
                                                    QA's Playwright run "E2E qa X.Y.Z-rc.N" ◄───────┘
                                                                     │
              "Sign off release candidate": tag vX.Y.Z, copy images, GitHub Release, prod promotion PR
                                                                     │
                                        merged (production approval) ──► eshop-prod
```

Nothing deploys because a tag appeared: `eshop-dev` follows `main`, and `eshop-qa` and `eshop-prod` each run exactly
the version pinned in Git, which changes only when a **promotion PR** is merged.

The branching model is the **tag-based release workflow**: one maintenance branch per major series, annotated tags
for release candidates and releases. Source: [Git Workflow for Release Management: Branches vs
Tags](https://pkhamdee.blog/2026/05/29/git-workflow-for-release-management-branches-vs-tags/) (Workflow B). This
repo's integration branch is **`main`** (read every `master` in the article as `main`).

## The one rule

**Every fix that lands on a `release/N.x` branch must also land on `main`.** If it doesn't, the next release
regresses. Check this in review before merging any fix to a release branch. `scripts/release.sh` enforces it when a
new minor's first candidate brings `main` into the release branch ([Releasing](#releasing)).

```bash
git cherry -v origin/main origin/release/0.x   # "+" = on the release branch but not on main (by patch-id)
git log main --oneline --grep "<subject>"       # cherry-picked commits get new hashes: search by subject
```

## Branches

| Branch | Purpose | Lifetime |
|---|---|---|
| `main` | Integration branch; the only place new work lands. Deployed to `eshop-dev`, never to prod directly. Protected ([Protecting main](#protecting-main)) | Permanent |
| `release/N.x` | One per major series (e.g. `release/0.x`): its release candidates and releases are tagged here. Fixes only, between minors | Kept while the series is supported |
| `issue/*`, `feature/*` | One task, merged into `main` by PR | Deleted after merge |
| `promote/qa-X.Y.Z-rc.N`, `promote/prod-X.Y.Z` | A promotion PR's branch: one commit changing a pin | Deleted after merge |

## Tags

- `vMAJOR.MINOR.PATCH-rc.N`: a **release candidate**, e.g. `v0.3.0-rc.1`. Cut by a person with `scripts/release.sh`.
- `vMAJOR.MINOR.PATCH`: a **release**, e.g. `v0.3.0`. Made only by the **"Sign off release candidate"** workflow, on
  the signed-off candidate's own commit. `scripts/release.sh X.Y.Z` refuses.
- Always **annotated**, always on a `release/N.x` branch; CI rejects anything else (`scripts/check-release-tag.sh`).
- Never moved or deleted. A bad candidate is followed by the next `rc.N`, a bad release by the next patch.

Two tag rulesets, kept as code in `scripts/protect-main.sh` (Settings → Rules → Rulesets):

- **"Protect release tags"** blocks deleting, moving and force-pushing any `v*` tag, with no bypass: QA and prod are
  pinned to a tag, so a moved tag would change what Flux deploys without a promotion PR.
- **"Create release tags"** lets only repository admins and maintainers create `v*` tags (its bypass actors are the
  repository roles admin and maintain). A pushed tag runs CI in the `release` environment, so anyone else could
  otherwise reach its secrets by pushing a tag. `scripts/release.sh` (run by a maintainer) and sign-off (pushing with
  `PROMOTION_TOKEN`, a maintainer's token) create them. It is a ruleset of its own because a bypass actor bypasses
  every rule of its ruleset: in "Protect release tags" it would also let maintainers move and delete tags.

## Protecting main

`main` is protected by the branch ruleset **"Protect main"**, kept as code in `scripts/protect-main.sh` and applied by
a maintainer (docs/setup.md, "Releasing"). Run it again after changing it; it updates the ruleset in place.

- **Pull requests only.** Nobody pushes to `main` directly, force-pushes or deletes it, admins included.
- **Required checks**: every job `ci-release.yml` runs on a pull request, by its name, from GitHub Actions:
  `eshop-api (lint, test)`, `eshop-web (lint, build)`, `thirdparty-mock (lint, type-check)`,
  `eshop-node-api (lint, test)`, `SAST (Semgrep, fail on ERROR)`, `dependency scan (Trivy, fail on critical)` and
  `repo rules (manifests, workflows, scripts, e2e)`. The script reads them from the workflow (jobs with no `needs:`
  and no `if:`). The temporary copy, gates, scan and push never run on a pull request, so they can't be required;
  they guard the push instead (a failure means no image). A PR doesn't have to be up to date with `main` first.
  **Renaming or adding a PR job changes the checks: run `scripts/protect-main.sh` again** after it merges, or PRs
  wait for a check that never comes (or skip the new one).
- **Who merges**: anyone with write access, which is only maintainers. With 0 required approvals, merging is the
  approval: GitHub doesn't let an author approve their own PR, and with one maintainer that is the only possible
  rule.
- **Flux's dev image commits** still go straight to `main`: Flux pushes over SSH with the deploy key
  `flux-system-main-flux-system-./clusters/local`, and the ruleset lets **deploy keys** (the repo has only that one)
  bypass it. Those commits touch only `deploy/**` and `clusters/**`, which CI ignores. Adding another deploy key
  with write access would also bypass `main`'s protection: don't.
- **Promotion PRs** go through the same rules; they run every required check because `pull_request` has no path
  filter, and they are opened with `PROMOTION_TOKEN` (a PR opened with the workflow's own token would run none).

**Switching on 2 approvals**, once there are two approvers other than the author:

```bash
scripts/protect-main.sh --dry-run --approvals 2 && scripts/protect-main.sh --approvals 2
```

This also dismisses approvals when new commits are pushed and requires the last push to be approved by someone
other than its pusher. Nothing else changes: promotion PRs then need two approvals too, so QA's and the production
approver's decisions become two-person decisions. A promotion PR opened by CI shows the token's owner as author, who
then can't approve it.

**In an emergency** (CI itself broken, and a fix must land): an admin sets the ruleset's enforcement to *Disabled*
(Settings → Rules → Rulesets → Protect main), merges the fix by PR, and immediately runs `scripts/protect-main.sh`
to put it back. There is deliberately no standing admin bypass: it would let the only maintainer skip failing checks.

### The `release` environment

The jobs that hold release secrets run in the GitHub environment **`release`**: `ci-release.yml`'s `push` (Docker
Hub token) and `promote-qa` (`PROMOTION_TOKEN`), and `sign-off.yml` (both). `scripts/protect-main.sh` makes it
deployable only from the branch `main` and from `v*` tags, and the secrets `DOCKERHUB_TOKEN` and `PROMOTION_TOKEN`
live in it, not in the repository (docs/setup.md, "Release secrets"). So a workflow file changed on another branch and
dispatched from there can't reach them; the job fails at "Branch ... is not allowed to deploy to release". A release
dry run therefore pushes only when dispatched from `main`.

What stays open: anyone who can push a `v*` tag can run the workflow as it is in the tagged commit with these
secrets. Only maintainers have write access, and pushing release tags is a maintainer's step.

## Day to day: `main` → `eshop-dev`

```bash
git checkout -b issue/<n>-<name> origin/main
# work, commit, push, open a PR into main; merge once every required check is green
```

`ci-release.yml` on a pull request (to `main` or `release/*`) runs each service's lint, tests and build, the SAST gate
(Semgrep, fails on ERROR) and the dependency scan (Trivy over the lockfiles, fails on critical), and the repo rules
(manifests, workflows, ShellCheck, the release-script tests). Reports are kept as artifacts; each gate also runs
locally (docs/setup.md, "Running the gates locally").

On the push to `main`, CI runs the same and then the **release gates** before any image exists (ADR 0007):
`build` (the changed services, one arm64 job each, handed on as artifacts) → `gate`: a **temporary copy** of eShop
started from those images (services not rebuilt run their newest `main-<sha>-<ts>` build, as `eshop-dev` does) must
become healthy and seeded, then Locust and ZAP run against it → `scan`: Trivy on every image (fails on critical) →
`push` as `docker.io/pkhamdee/<service>:main-<sha>` and `main-<sha>-<unix-ts>`. A failure anywhere means nothing is
pushed. Flux's image automation (`deploy/apps/dev/image-automation.yaml`) then picks the newest `main-<sha>-<ts>` tag,
commits it to `main` and deploys it to `eshop-dev` (`https://eshop.localhost`). It never takes release-candidate or
release tags. Pushes to `release/*` lint and test only.

Manual runs: Actions → CI / Release → Run workflow on `main` without input rebuilds, gates and pushes every service as
`main-<sha>`; with `version` = `0.0.0-test.N` it is a **release dry run**: every service built, gated, scanned and
pushed as that tag, exactly as for a candidate, but no promotion PR and never deployable. It pushes only from `main`
([The release environment](#the-release-environment)). A version's images are pushed once: the push job refuses
when any `<service>:<version>` already exists (`scripts/check-new-images.sh`), so a re-run of an old candidate's CI
can't replace images QA tested, and a dry run needs a new `N` each time.

## Releasing

A release goes **release candidate → QA promotion → QA test run → sign-off → prod promotion**, each a separate,
recorded decision. Before the first one, the human setup in docs/setup.md ("Releasing") must be done.

### 1. Cut a release candidate

A **human step** (agents can't push release tags):

```bash
scripts/release.sh 0.3.0-rc.1
```

It shows what it will do, asks for confirmation, pushes an annotated `v0.3.0-rc.1` and prints the tag's CI run.
Which commit it tags:

- **A new minor's first candidate** (`X.Y.0-rc.1`):
  - no `release/N.x` yet (a new major): it forks the branch from `origin/main` and tags it;
  - `release/N.x` exists (it holds the previous minor): it first **merges `origin/main` into it**, a merge commit
    whose tree is exactly `main`'s ("Merge main into release/0.x for v0.3.0-rc.1", parents the branch head and
    `main`), pushes the branch and tags the merge. It refuses unless every commit on the branch since its last merge
    from `main` is already on `main` by patch-id (`git cherry`), so no release-branch fix is dropped. (v0.2.0 was
    made the same way by hand, in `f613dcb`.)
- **Any other candidate** (`X.Y.Z-rc.N` with N > 1, or Z > 0): the head of `release/N.x` as it is. A fix found in QA
  lands on `release/N.x` **and** `main` (the one rule), then `scripts/release.sh X.Y.Z-rc.<N+1>`.

It refuses plain `X.Y.Z` (sign-off tags releases), a candidate whose tag exists, a version already released (cut the
next one), and a commit with a GitHub skip-ci marker (`[skip ci]`, `[ci skip]`, …): GitHub skips every push workflow
on such a commit, tag pushes included, so the tag would never build (that is how `v0.1.0` was lost). For the same
reason Flux's commit templates carry no marker (CI ignores `deploy/**` and `clusters/**` pushes instead), and CI's
`repo rules` job fails if one comes back.

### 2. CI builds it and opens the QA promotion PR

For a `vX.Y.Z-rc.N` tag CI lints and tests, validates the tag (annotated, on `release/N.x`), builds **every** service
in `.github/services.json`, runs the same gates and scan as for `main`, pushes `docker.io/pkhamdee/<service>:X.Y.Z-rc.N`,
and only then its `promote-qa` job runs `scripts/promotion-pr.sh qa X.Y.Z-rc.N`: a branch `promote/qa-X.Y.Z-rc.N` from
`main` whose only commit is the pin edit, and a PR **`eshop-qa: deploy vX.Y.Z-rc.N`** listing the candidate's
commit, its images with digests, each gate's result and the CI run (whose artifacts are the gate reports).

**Merging it is QA's approval**; nothing reaches QA otherwise. A newer candidate's PR supersedes an unmerged older
one: close the old one. Without `PROMOTION_TOKEN` the job fails after the push and says so; set the secret and re-run
the job, or open the PR yourself with the same script.

### 3. QA (`eshop-qa`)

`eshop-qa` (`https://qa.eshop.localhost`) runs one release candidate, pinned by the lines ending in
`# release-pin: qa` in `clusters/local/qa-release.yaml` (GitRepository `eshop-qa`'s `spec.ref`, Kustomization
`apps-qa`'s `spec.images`): the manifests in `deploy/apps/qa` **as they are in tag `vX.Y.Z-rc.N`**, with the
`X.Y.Z-rc.N` images. Its PostgreSQL keeps its data from one candidate to the next, as prod's does. Flux applies a
merged pin within a minute or two (`flux reconcile kustomization flux-system --with-source` hurries it).

**No release yet.** `deploy/apps/qa` first appears in the first candidate cut after #74 landed, so QA can't run
`v0.2.0` or earlier. Until the first QA promotion, `apps-qa` is suspended by a line ending in
`# release-pin-until: qa`, and the pin holds `0.2.0` as a placeholder. The first QA promotion PR deletes that line
in the same edit, so merging it deploys QA for the first time.

What QA runs: `scripts/pin-release.sh qa` (what Git asks for), `e2e/check-serving.sh qa X.Y.Z-rc.N` (whether the
cluster serves it), `flux get kustomization apps-qa`, `kubectl -n eshop-qa get deploy -o wide`.

### 4. QA test run

QA runs the Playwright UI suite against `https://qa.eshop.localhost` **through CI**, so the run is recorded against
the candidate. The cluster is on this Mac, so the job runs on an on-demand runner here:

```bash
e2e/run-on-actions.sh qa X.Y.Z-rc.N      # workflow "E2E smoke test", environment qa, version X.Y.Z-rc.N
```

The run refuses unless QA is serving exactly that candidate, asked of the cluster (`e2e/check-serving.sh`: `apps-qa`
not suspended and Ready, applied revision `vX.Y.Z-rc.N@sha1:…`, every Deployment in `eshop-qa` rolled out with
`X.Y.Z-rc.N` images), before and again after the test. It is named **`E2E qa X.Y.Z-rc.N`**, and its summary records
the version, revision, images and the test code's commit. Sign-off finds the latest completed run of that name on
`main`:

```bash
gh run list --repo pkhamdee/modernapp --workflow e2e.yml --branch main --event workflow_dispatch \
  --status completed --limit 100 --json databaseId,displayTitle,conclusion,url \
  --jq '[.[] | select(.displayTitle == "E2E qa X.Y.Z-rc.N")] | first'
```

The same check works for prod (`e2e/run-on-actions.sh prod X.Y.Z`, run `E2E prod X.Y.Z`); without a version it is
the plain smoke test (`e2e/run-on-actions.sh`, `e2e/run-on-actions.sh dev`).

### 5. Sign-off

Once the candidate's QA run passed, a maintainer signs it off:

```bash
gh workflow run sign-off.yml --repo pkhamdee/modernapp --ref main -f version=X.Y.Z-rc.N
```

or Actions → **Sign off release candidate** → Run workflow (branch `main`). `.github/workflows/sign-off.yml` only
supplies tokens and tools; the decisions are `scripts/sign-off.sh`. It **refuses, changing nothing**, unless:

- it runs from `main` and was started by a maintainer (repo role admin or maintain);
- `vX.Y.Z-rc.N` exists, and `main` pins `eshop-qa` to exactly that candidate, not suspended;
- the latest completed QA run of it on `main` passed (no run, or a newer failed or cancelled one, refuses);
- every candidate image exists, and no `X.Y.Z` image exists with another digest;
- `vX.Y.Z` doesn't exist, unless an earlier sign-off of this same candidate made it.

Then it copies each image to `docker.io/pkhamdee/<service>:X.Y.Z` **by digest** (never rebuilt), tags **`vX.Y.Z`** on
the candidate's commit (CI's `plan` skips a plain release tag: nothing is built), publishes the **GitHub Release**
(images, candidate, QA run, who signed off) and opens the **prod promotion PR** `eshop-prod: deploy vX.Y.Z`. Each step
is skipped or updated when already done, so a sign-off that failed half-way is finished by running it again.

### 6. Prod promotion

`eshop-prod` (`https://prod.eshop.localhost`) runs one release, pinned like QA by the lines ending in
`# release-pin: prod` in `clusters/local/prod-release.yaml`:

| Line | Object | Means |
|---|---|---|
| `semver: "X.Y.Z" # release-pin: prod` | GitRepository `eshop-release`, `spec.ref` | the source at tag `vX.Y.Z` (an exact version selects exactly that tag) |
| `newTag: "X.Y.Z" # release-pin: prod` (one per service) | Kustomization `apps-prod`, `spec.images` | the `X.Y.Z` images |

**Merging the prod promotion PR is the production approval.** Flux then applies `deploy/apps/prod` as it is in tag
`vX.Y.Z` with the `X.Y.Z` images. Pushing a tag never changes prod, and changes on `main` reach prod only once they are
released and promoted. Afterwards, the post-release smoke test: `cd e2e && npm run e2e:prod`, or
`e2e/run-on-actions.sh prod X.Y.Z`.

```bash
scripts/pin-release.sh prod                     # the pinned release, from Git
flux get kustomization apps-prod                # Applied revision: vX.Y.Z@sha1:...
kubectl -n eshop-prod get deploy -o wide        # images :X.Y.Z
```

### Promotion and rollback

A promotion PR changes **only the pin**, the same edit for CI or a person, for QA or prod:

```bash
git checkout -b promote/prod-X.Y.Z origin/main
scripts/pin-release.sh prod X.Y.Z               # rewrites every `# release-pin: prod` line
git commit -am "eshop-prod: deploy vX.Y.Z"      # push, open a PR into main
# or, with the PR description CI and sign-off write: scripts/promotion-pr.sh prod X.Y.Z (PROMOTION_PUSH=0 to preview)
```

`scripts/pin-release.sh <env> <version>` accepts only an exact `X.Y.Z` or `X.Y.Z-rc.N`, rewrites every line ending in
`# release-pin: <env>` in `clusters/local/*.yaml`, deletes any `# release-pin-until: <env>` line and prints the new
pin; without a version it prints the current one. CI's `repo rules` job checks every pin (`scripts/validate-manifests.sh`),
so a hand edit that misses a line fails the PR. Before promoting by hand, check that tag `vX.Y.Z` and every
`docker.io/pkhamdee/<service>:X.Y.Z` image exist: a missing tag leaves `eshop-release` not Ready and prod on its
previous release; a missing image leaves that Deployment's new pod in `ImagePullBackOff` while the old one serves.

**Rollback** is a promotion PR back to an earlier release, reviewed and merged the same way:

```bash
git checkout -b promote/prod-0.2.0 origin/main
scripts/pin-release.sh prod 0.2.0
git commit -am "eshop-prod: roll back to v0.2.0"   # push, open a PR into main, merge it
```

It moves manifests and images back but **never the data**: eshop-api migrates the database forwards on start-up and
nothing migrates it back. A rollback is safe only when the earlier release works with the schema the later one left:
no migration between them removed, renamed or retyped anything the earlier release uses
(`git diff vEARLIER..vLATER -- services/eshop-api/src/Eshop.Data/Migrations`). Otherwise roll forward: fix on the
release branch, cut the next patch's candidate and promote it.

A tag carries **its own overlay**: an environment can be pinned only to a version whose tag contains that
environment's overlay (prod: `v0.2.0` or later; QA: the first candidate after #74 or later). Releases before `v0.2.0`
used the old names and can't be rolled back to (docs/setup.md, "Moving to eShop"). A fix to an overlay reaches the
environment with the next release that contains it.

### Things to know

- **Any release can be promoted**, in any order: a patch on an older series reaches prod only if someone promotes it.
- **Prod-only changes** (`deploy/apps/prod`) are released like code: land on `main` (and the release branch for a
  patch), cut a candidate, promote.
- **Adding a service** to releases: an entry in `.github/services.json` and its lint/test job in `plan.needs` (then
  re-run `scripts/protect-main.sh`: the new job is a required check). To run it in prod and QA, add it to
  `deploy/apps/prod` and `deploy/apps/qa`, and an `images:` entry to `apps-prod` / `apps-qa` whose `newTag` line ends
  in `# release-pin: prod` / `# release-pin: qa` (holding the current pin). It can land before a release that
  contains the service: an `images:` entry that matches no Deployment changes nothing.

## Patch release (also hotfixes)

There is no separate hotfix process: an urgent fix takes this route.

```bash
git checkout -b issue/<n>-fix origin/release/0.x   # fix, PR into release/0.x (or cherry-pick onto it)
git checkout -b issue/<n>-fix-main origin/main     # the same fix, PR into main (the one rule)
scripts/release.sh 0.3.1-rc.1                      # tags the head of release/0.x; then QA, sign-off, promotion
```

```
fix ──► release/0.x ──► v0.3.1-rc.1 ──► CI ──► QA promotion ──► QA run ──► sign-off: v0.3.1 ──► prod promotion
          └── same fix ──► main
```

A **new major** (`1.0.0-rc.1`) forks `release/1.x` from `main`; older `release/N.x` branches stay for patches while
supported.

## Auditing

```bash
git tag -l "v*" --sort=-v:refname          # releases and candidates, highest version first
git log v0.2.0..v0.3.0 --oneline           # what changed between two releases
git show v0.3.0                            # tag message ("Signed off from v0.3.0-rc.N by @..."), commit
git cherry -v origin/main origin/release/0.x   # release-branch commits not on main ("+")
gh release view v0.3.0                     # images with digests, QA run, who signed off
git log --oneline -- clusters/local/prod-release.yaml   # every prod promotion and rollback
```

## Why tags rather than branches

| | Branches (Workflow A) | Tags (this project) |
|---|---|---|
| Build triggered by | Branch name | Tag name |
| Release snapshot | `release/1.0`, `release/1.0.1` branches | `v1.0.0`, `v1.0.1` tags |
| Patches per series | Accumulate on `staging/1.x` | Same `release/N.x` branch, multiple tags |
| Immutability | Convention | Tag points at exactly one commit (enforced by the tag ruleset) |
| Audit | Diff release branches | `git log v1.0.1..v1.0.2` |
| Branch count | More | Fewer, cleaner history |
