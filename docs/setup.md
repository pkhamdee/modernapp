# Local setup

Takes a fresh Mac (Apple Silicon) to a Rancher Desktop k3s cluster that Flux manages from this repo, serving `https://sphone.localhost` (`sphone-dev`) and `https://prod.sphone.localhost` (`sphone-prod`).

## 1. Rancher Desktop

1. Install [Rancher Desktop](https://rancherdesktop.io/) (`brew install --cask rancher`).
2. **Preferences → Virtual Machine**: memory **12 GB** (SQL Server under Rosetta needs about 2 GB; both app namespaces and the shared mocks need the rest), 4+ CPUs.
3. **Preferences → Virtual Machine → Emulation**: VZ with **Rosetta** enabled, so `linux/amd64` images (SQL Server) run.
4. **Preferences → Kubernetes**: **enabled**, Traefik **enabled** (it is the Gateway API implementation, ADR-0002).
5. **Preferences → Container Engine**: either works; `dockerd (moby)` is assumed by the commands in this repo.

Check:

```sh
kubectl config use-context rancher-desktop
kubectl get nodes
```

Rancher Desktop forwards host ports 80 and 443 to Traefik, and macOS resolves every `*.localhost` name to `127.0.0.1`, so `https://sphone.localhost` and `https://prod.sphone.localhost` reach the cluster without editing `/etc/hosts`.

### Environments and hostnames

Both environments share the one `sphone` Gateway on port 443 and run the same apps with the same paths (`/`, `/api`, `/images`); they are told apart by hostname, so neither ever shadows the other's routes:

| Environment | Namespace | Follows | URL | Gateway listener |
| --- | --- | --- | --- | --- |
| dev | `sphone-dev` | `main` (`main-<sha>` images) | `https://sphone.localhost` | `https` |
| prod | `sphone-prod` | the newest release tag `vX.Y.Z` (its manifests and its `X.Y.Z` images, docs/git-workflow.md) | `https://prod.sphone.localhost` | `https-prod` (accepts routes from `sphone-prod` only) |

Base HTTPRoutes are written for dev; `deploy/apps/prod/kustomization.yaml` patches every HTTPRoute to the prod hostname and listener. The one certificate `gateway/sphone-localhost-tls` carries both names, and plain HTTP on either name redirects to HTTPS. Each environment has its own PostgreSQL (`sphone-db` in its namespace) with its own SOPS-encrypted credentials.

### DOCKER_HOST gotcha

If `docker` commands fail with a context error (for example a stale `rd-ssh` context), point the CLI and Testcontainers at Rancher Desktop's socket directly:

```sh
export DOCKER_HOST=unix://$HOME/.rd/docker.sock
```

## 2. Tools

```sh
brew install flux sops age gh
gh auth login            # needs repo scope; used to bootstrap Flux
```

## 3. age key (SOPS)

Secrets in Git are encrypted with [SOPS](https://github.com/getsops/sops) for the age public key in `.sops.yaml`. The private key lives only on your Mac and in the cluster; **never commit it**.

Use the team's existing key if you have it, placed at `~/.config/sops/age/keys.txt`. Only when starting a new environment, generate one and put its public key into `.sops.yaml` (then re-encrypt every `*.sops.yaml`):

```sh
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
chmod 600 ~/.config/sops/age/keys.txt
```

Give the cluster the private key, out of band (Flux's Kustomizations reference the secret `flux-system/sops-age`):

```sh
kubectl create namespace flux-system --dry-run=client -o yaml | kubectl apply -f -
grep '^AGE-SECRET-KEY' ~/.config/sops/age/keys.txt |
  kubectl -n flux-system create secret generic sops-age \
    --from-file=age.agekey=/dev/stdin --dry-run=client -o yaml | kubectl apply -f -
```

## 4. Bootstrap Flux

```sh
export GITHUB_TOKEN=$(gh auth token)
flux bootstrap github \
  --owner=pkhamdee --repository=modernapp --branch=main --personal \
  --path=clusters/local \
  --components-extra=image-reflector-controller,image-automation-controller \
  --read-write-key
```

Bootstrap installs Flux, commits `clusters/local/flux-system/` to `main` if it changed, and adds a read-write deploy key (image automation commits image tag updates back to Git). Re-running it is safe.

## 5. Check

```sh
flux get kustomizations          # flux-system, infra-controllers, infra-configs, thirdparty, apps-dev: Ready; apps-prod: see below
kubectl get gateway -n gateway   # sphone, PROGRAMMED True
curl -k https://sphone.localhost/api/product-categories   # catalog JSON from sphone-api
curl -k https://sphone.localhost                          # sphone-web
curl -kI https://sphone.localhost/images/public/demo-iphone-17.svg   # a Product photo from sphone-node-api
curl -I http://sphone.localhost  # 301 to https
curl -k https://prod.sphone.localhost/api/product-categories   # sphone-prod (after the first release; own database)
open https://sphone.localhost/thirdparty-mock/sms/inbox   # mock SMS inbox: sign-in codes for any mobile number
open https://sphone.localhost/thirdparty-mock/enterprise/ # mock Enterprise System: pushed Contracts, simulate Payment, cancel
```

**`sphone-prod` before the first release.** Prod runs only what a release tag says (docs/git-workflow.md). Until the first `vX.Y.Z` tag has been pushed and its images built, there is nothing to deploy, so the GitRepository `sphone-release`, the ImagePolicy `flux-system/sphone-release` and the Kustomization `apps-prod` are not Ready (`no match found for semver: 0.0.0`) and `https://prod.sphone.localhost` serves nothing. That is expected; they turn Ready a few minutes after the first release (docs/git-workflow.md, "Releasing"). On a cluster bootstrapped before this change, the old `sphone-prod` objects keep running until then and the first release replaces them.

The certificate comes from a local CA created by cert-manager. To stop browser warnings, trust the CA once:

```sh
kubectl -n cert-manager get secret sphone-local-ca -o jsonpath='{.data.ca\.crt}' | base64 -d > /tmp/sphone-local-ca.crt
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/sphone-local-ca.crt
```

Recreating the cluster creates a new CA; remove the old "S Phone Local CA" from Keychain Access and trust the new one.

## Staff back office (demo account)

The back office is at `https://sphone.localhost/staff` (prod: `https://prod.sphone.localhost/staff`). Each environment has
one demo Staff account; its username and password live **only** in the SOPS-encrypted Secret
`deploy/apps/<env>/sphone-api-staff.sops.yaml` (never in plain text in git). Read them with:

```sh
SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt sops -d deploy/apps/dev/sphone-api-staff.sops.yaml   # or prod
```

sphone-api provisions the account at startup from `Staff__Accounts__0__Username|Password|DisplayName` (stored as a salted
PBKDF2 hash). To change the password: `sops deploy/apps/<env>/sphone-api-staff.sops.yaml`, commit, and once Flux applies
it restart sphone-api (`kubectl -n sphone-<env> rollout restart deploy/sphone-api`); the Secret is the source of truth.
More accounts: add `Staff__Accounts__1__*` env vars from the same kind of Secret.

Running sphone-api locally, give it a Staff account the same way (any password you like, not committed):
`Staff__Accounts__0__Username=staff Staff__Accounts__0__Password=<choose one> dotnet run --project src/Sphone.Api`.
Product photo upload needs sphone-node-api (`npm run dev`, port 8081; `ImageService__BaseUrl` overrides it).

## Auction demo

Staff open `/staff/auctions`, create an Auction (default: next Monday 10:00 to Sunday 20:00 Asia/Bangkok; tick
"กำหนดเวลาเอง" to choose times, e.g. one that is already open for a demo) and add Lots with photos. Visitors browse
`/auction`; a Lot page (`/auction/lots/<id>`) polls the current highest Bid every 3 s. Only Customers who passed ID
Verification may bid, and the only way to pass it is to apply for hire purchase: use a thirdparty-mock ID number ending
`02` (ID Verification passes, Credit Check fails) to make a bidder without taking on a Contract. A Bid must be at least the
starting price, then at least ฿100 above the current highest; Bids before opening or from the closing time on are refused.

## Mock Enterprise System (SQL Server)

The Enterprise System is a real SQL Server 2022 (`mcr.microsoft.com/mssql/server`, amd64 only, so it runs under Rosetta;
about 2 GB of memory and a slow first start) in the `thirdparty` namespace, shared by both environments:
databases `enterprise_dev` and `enterprise_prod`, fake schema `hp.contract` / `hp.payment`
(`deploy/thirdparty/mssql/enterprise-schema.sql`). The pod's `schema` container creates the databases, applies the
schema and (re)sets the logins on every start. Passwords are in the SOPS Secret
`deploy/thirdparty/mssql/mssql-credentials.sops.yaml` (`sa`, `enterprise_admin` for the admin tool, `sphone_sync_dev` /
`sphone_sync_prod` for sphone-sync-master). Each environment's copy of its sync login is in
`deploy/apps/<env>/sphone-sync-master-enterprise.sops.yaml` and must match.

**Admin tool** (story 62): `https://sphone.localhost/thirdparty-mock/enterprise/` → `dev/` or `prod/` lists the Contracts
sphone-sync-master pushed (newest first) with their Payments, and per Contract: **Simulate Payment** (one Installment by
default; the last one makes it `PAID_OFF`), **Mark overdue / Mark active**, **Cancel Contract**. The same as JSON for
scripts:

```sh
B=https://sphone.localhost/thirdparty-mock/enterprise/dev
curl -k $B/contracts                                                          # Contracts + Payments
curl -k -H 'content-type: application/json' -d '{}' $B/contracts/SP-202610-000001/payments    # {amount?, channel?}
curl -k -H 'content-type: application/json' -d '{"status":"OVERDUE"}' $B/contracts/SP-202610-000001/status
curl -k -H 'content-type: application/json' -d '{"reason":"demo"}' $B/contracts/SP-202610-000001/cancel
```

**sphone-sync-master** (`deploy/apps/base/sphone-sync-master`) runs a sync cycle every 30 s: it pushes Contracts waiting in
`contract_outbox` to `hp.contract` (MERGE on the Contract number, insert only: pushing twice leaves one copy and never
overwrites what the Enterprise System changed), then sets `pushed_at`. From then on the Enterprise System owns the
Contract (ADR-0001). In the same cycle it then pulls what changed there since the last pull: Contract status
(`active | overdue | paid-off | cancelled`, plus `cancelled_at`) into `contracts`, and Payments into `payments` (unique
on the Enterprise `payment_id`). It finds changes by the `row_ver` rowversion watermark, one row per table in
`sync_watermarks`, stored in the same transaction as the copied rows; only committed changes are read
(`row_ver < MIN_ACTIVE_ROWVERSION()`). The Customer's Contract page therefore lags the admin tool by at most one
cycle (≈30 s). A Contract cancelled there stops its Handover (ADR-0004). eShop never computes overdue itself.
Logs: `kubectl -n sphone-dev logs deploy/sphone-sync-master`.

Read-only look at the database (sa password from the Secret, never printed):

```sh
kubectl -n thirdparty exec deploy/mssql -c mssql -- bash -c \
  '/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -d enterprise_dev -Q "SELECT contract_no, status, last_updated_at FROM hp.contract"'
```

## End-to-end smoke test (Seam 4)

`e2e/` holds one Playwright browser test of the definition-of-done demo (spec #1), run against a **deployed**
environment, never on every CI run. In a phone-sized Chromium it:

1. signs a Customer in by SMS (the code is read from the mock inbox `/thirdparty-mock/sms/inbox`), applies for the
   iPhone with an ID card photo (thirdparty-mock ID ending `01`), waits for **Approved** (≤ 60 s) and accepts the Offer
   with a second SMS code;
2. waits until the Contract shows in the mock Enterprise System admin tool (`/thirdparty-mock/enterprise/<env>/`);
3. signs Staff in, records the Down Payment and moves the Handover to handed over; the Customer's Contract shows it;
4. clicks **Simulate Payment** in the admin tool and waits until the Payment shows on the Customer's Contract;
5. separately: a second Customer passes ID Verification (ID ending `02`, Credit Check fails), Staff create an Auction
   with their own times (open now, **closing about two minutes ahead**, so nobody waits for the weekly Sunday close),
   add a Lot with a photo, the Customer bids and, once the Auction closes, has won the Lot.

Each run uses fresh mobile and ID numbers (ID prefix `3`) and leaves its Customers, Contract and Auction behind as
demo data. It takes about 3–4 minutes (the two parts run in parallel).

```sh
cd e2e
npm ci && npx playwright install chromium            # once
npm run e2e                                          # sphone-dev: https://sphone.localhost
E2E_BASE_URL=https://prod.sphone.localhost npm run e2e   # sphone-prod (same as npm run e2e:prod)
npm run report                                       # HTML report of the last run (traces of failures)
```

- **Staff credentials** come from the environment's SOPS Secret (`deploy/apps/<env>/sphone-api-staff.sops.yaml`),
  decrypted at run time by `global-setup.ts` with `sops` and the age key (`SOPS_AGE_KEY_FILE`, default
  `~/.config/sops/age/keys.txt`) into the test process's environment only; it is never printed or written to the
  report. Or set `STAFF_USERNAME` / `STAFF_PASSWORD` yourself. `E2E_ENV=dev|prod` overrides the environment name
  derived from the host (it picks the Enterprise database in the admin tool and the Secret).
- The certificate is self-signed; the test accepts it.
- **GitHub Actions**: `e2e/run-on-actions.sh [base_url]` (default `https://prod.sphone.localhost`) runs
  `.github/workflows/e2e.yml` on GitHub Actions with the job on this machine, which GitHub-hosted runners can't
  reach. The repository is public, so no runner stays registered: the script registers an ephemeral runner
  (label `sphone-e2e` only), dispatches the workflow to it, follows the run (the Playwright report is a run
  artifact) and unregisters the runner when it ends. It needs `gh` logged in as a repo admin, and `sops` with the
  age key: the job decrypts the Staff account itself, so no Staff secrets are stored in GitHub. Workflow runs
  from outside contributors' pull requests always wait for approval (repo setting), so nobody else's workflow
  can reach a runner here unreviewed.

## Releasing

Tag-based, per [git-workflow.md](git-workflow.md) ("Releasing"). Releasing is your step: agents can't push release tags. Cut the release, let CI build it and Flux deploy it to `sphone-prod`, then run the smoke test there:

```sh
# 1. Tag (forks release/<MAJOR>.x from main on a new series), push, print the CI run URL
scripts/release.sh 0.2.0

# 2. Watch CI: test → validate tag → build/scan/push ghcr.io/pkhamdee/<service>:0.2.0 → GitHub Release
gh run watch "$(gh run list --workflow ci-release.yml --branch v0.2.0 --limit 1 --json databaseId --jq '.[0].databaseId')"

# 3. Flux follows the release a few minutes later (clusters/local/prod-release.yaml)
flux get images policy sphone-release -n flux-system  # 0.2.0
flux get kustomization apps-prod                      # Applied revision: v0.2.0@…
kubectl -n sphone-prod get deploy -o wide             # images :0.2.0, all READY
curl -k https://prod.sphone.localhost/api/product-categories

# 4. Post-release smoke test against sphone-prod (locally, or on GitHub Actions)
cd e2e && npm run e2e:prod                            # or: e2e/run-on-actions.sh
```

A fix after the release goes to `release/0.x` **and** `main`, then the next patch, e.g. `scripts/release.sh 0.1.2` (git-workflow.md, "Patch release").

## Repo layout

| Path | What | Flux Kustomization |
| --- | --- | --- |
| `clusters/local/` | Cluster entry point: `flux-system/` (generated by bootstrap) plus the Kustomizations below | `flux-system` |
| `clusters/local/prod-release.yaml` | What `sphone-prod` runs: GitRepository `sphone-release` (one release tag) and the image automation that moves it, and `apps-prod`'s image tags, to the newest `X.Y.Z` release once its images exist, committed to `main` | `flux-system` |
| `deploy/infrastructure/controllers/` | Namespaces, Traefik `HelmChartConfig` (Gateway API provider), cert-manager, CloudNativePG operator | `infra-controllers` |
| `deploy/infrastructure/configs/` | Issuers, the `sphone` Gateway and its certificate, platform secrets | `infra-configs` (after controllers) |
| `deploy/apps/base/` | One directory per app, environment-neutral | – |
| `deploy/apps/dev/` | `sphone-dev` overlay, follows `main` | `apps-dev` (after configs) |
| `deploy/apps/dev/image-automation.yaml` | Flux image automation: newest `main-<sha>-<ts>` image per service, committed back to `main` | `apps-dev` |
| `deploy/apps/prod/` | `sphone-prod` overlay, applied as it is in the newest release tag, served at `prod.sphone.localhost` | `apps-prod` (after configs; source `sphone-release`) |
| `deploy/thirdparty/` | Shared mocks in the `thirdparty` namespace, one folder per component (`thirdparty-mock/`, `samba/`: image share with one share per environment, `mssql/`: mock Enterprise System, ...); thirdparty-mock follows `main` via its own image automation | `thirdparty` (after configs) |
| `services/sphone-api/` | .NET solution: `src/Sphone.Domain`, `src/Sphone.Data` (EF Core, migrations), `src/Sphone.Api`, `src/Sphone.SyncMaster` (sphone-sync-master), `tests/Sphone.Api.Tests` (Seam 1), `tests/Sphone.SyncMaster.Tests` (Seam 2) | – |
| `services/sphone-web/` | React + Vite + TypeScript, served by Caddy | – |
| `services/thirdparty-mock/` | Node 24 + Express (TypeScript run directly): mock SMS (+ inbox page), ID Verification and Credit Check; adjustable delay; mock Enterprise System admin tool | – |
| `services/sphone-node-api/` | Image service: Node 24 + Express + TypeScript (run directly by Node), SMB share via `smbclient` | – |
| `e2e/` | Seam 4: Playwright smoke test of the whole demo against a deployed environment (`npm run e2e`) | – |
| `scripts/` | Repo tasks: `release.sh X.Y.Z` cuts a release (human-run); `validate-manifests.sh` builds and schema-checks every Flux path (also CI's `repo rules` job) | – |
| `.github/services.json` | Container images CI builds (context, Dockerfile, source paths): changed ones on `main`, all of them on a release tag | – |

Every Kustomization decrypts SOPS (`*.sops.yaml`) with `flux-system/sops-age` where needed and prunes only what it applied, so other workloads in the cluster are untouched.

## Developing

```sh
# sphone-api + sphone-sync-master (.NET 10). Tests start PostgreSQL (and, for sync-master's Seam-2 tests, SQL Server
# amd64 under Rosetta: enable Rosetta in Rancher Desktop) with Testcontainers.
export DOCKER_HOST=unix://$HOME/.rd/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock   # Rancher Desktop: socket path inside the VM
cd services/sphone-api
dotnet test
dotnet format --verify-no-changes                                   # lint, as CI runs it
dotnet tool restore && dotnet ef migrations add <Name> --project src/Sphone.Data

# Run locally: a PostgreSQL on localhost:5432 (user/password/db sphone), then
docker run -d --name sphone-pg -p 5432:5432 -e POSTGRES_USER=sphone -e POSTGRES_PASSWORD=sphone -e POSTGRES_DB=sphone postgres:18-alpine
dotnet run --project src/Sphone.Api                                 # http://localhost:5080, migrates and seeds
# sphone-sync-master needs a SQL Server on localhost:1433 with enterprise_dev and the schema (appsettings.Development.json):
docker run -d --name enterprise-sql --platform linux/amd64 -p 1433:1433 -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD=Local_Dev_Passw0rd mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04
#   then create enterprise_dev and run ../../deploy/thirdparty/mssql/enterprise-schema.sql in it (sqlcmd -d enterprise_dev -i ...)
dotnet run --project src/Sphone.SyncMaster                          # pushes every 30 s; probes on http://localhost:5090/healthz/ready

# sphone-web (Node 24)
cd services/sphone-web
npm ci && npm run dev                                               # proxies /api to localhost:5080
npm run lint && npm run build                                       # as CI runs it

# thirdparty-mock (Node 24). sphone-api's Development settings point ThirdParty:BaseUrl at localhost:4000.
cd services/thirdparty-mock
npm ci && npm run dev                                               # http://localhost:4000/sms/inbox
# Enterprise admin tool locally: ENTERPRISE_SQL_SERVER=localhost ENTERPRISE_SQL_USER=sa ENTERPRISE_SQL_PASSWORD=... npm run dev
npm run lint && npm run typecheck
# sphone-node-api (Node 24). Tests use a temporary folder instead of the SMB share.
cd services/sphone-node-api
npm ci && npm run lint && npm test                                  # as CI runs it
npm run dev                                                         # http://localhost:8081, images in ./.local-share
```

## Troubleshooting

```sh
flux get all -A                             # anything not Ready
flux logs --level=error
flux reconcile kustomization flux-system --with-source
kubectl -n kube-system get job helm-install-traefik   # Traefik config re-applied by k3s
kubectl describe gateway -n gateway sphone
```
