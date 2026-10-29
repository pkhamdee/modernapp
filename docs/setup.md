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
| prod | `sphone-prod` | release tags (`X.Y.Z` images, docs/git-workflow.md) | `https://prod.sphone.localhost` | `https-prod` (accepts routes from `sphone-prod` only) |

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
flux get kustomizations          # flux-system, infra-controllers, infra-configs, thirdparty, apps-dev, apps-prod: all Ready
kubectl get gateway -n gateway   # sphone, PROGRAMMED True
curl -k https://sphone.localhost/api/product-categories   # catalog JSON from sphone-api
curl -k https://sphone.localhost                          # sphone-web
curl -kI https://sphone.localhost/images/public/demo-iphone-17.svg   # a Product photo from sphone-node-api
curl -I http://sphone.localhost  # 301 to https
curl -k https://prod.sphone.localhost/api/product-categories   # sphone-prod (release images, own database)
open https://sphone.localhost/thirdparty-mock/sms/inbox   # mock SMS inbox: sign-in codes for any mobile number
```

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

## Repo layout

| Path | What | Flux Kustomization |
| --- | --- | --- |
| `clusters/local/` | Cluster entry point: `flux-system/` (generated by bootstrap) plus the Kustomizations below | `flux-system` |
| `deploy/infrastructure/controllers/` | Namespaces, Traefik `HelmChartConfig` (Gateway API provider), cert-manager, CloudNativePG operator | `infra-controllers` |
| `deploy/infrastructure/configs/` | Issuers, the `sphone` Gateway and its certificate, platform secrets | `infra-configs` (after controllers) |
| `deploy/apps/base/` | One directory per app, environment-neutral | – |
| `deploy/apps/dev/` | `sphone-dev` overlay, follows `main` | `apps-dev` (after configs) |
| `deploy/apps/dev/image-automation.yaml` | Flux image automation: newest `main-<sha>-<ts>` image per service, committed back to `main` | `apps-dev` |
| `deploy/apps/prod/` | `sphone-prod` overlay, follows release tags, served at `prod.sphone.localhost` | `apps-prod` (after configs) |
| `deploy/apps/prod/image-automation.yaml` | Flux image automation: newest semver `X.Y.Z` image per service, committed back to `main` | `apps-prod` |
| `deploy/thirdparty/` | Shared mocks in the `thirdparty` namespace, one folder per component (`thirdparty-mock/`, `samba/`: image share with one share per environment, ...); thirdparty-mock follows `main` via its own image automation | `thirdparty` (after configs) |
| `services/sphone-api/` | .NET solution: `src/Sphone.Domain`, `src/Sphone.Data` (EF Core, migrations), `src/Sphone.Api`, `tests/Sphone.Api.Tests` | – |
| `services/sphone-web/` | React + Vite + TypeScript, served by Caddy | – |
| `services/thirdparty-mock/` | Node 24 + Express (TypeScript run directly): mock SMS (+ inbox page), later ID Verification and Credit Check; adjustable delay | – |
| `services/sphone-node-api/` | Image service: Node 24 + Express + TypeScript (run directly by Node), SMB share via `smbclient` | – |
| `.github/services.json` | Container images CI builds (context, Dockerfile, source paths): changed ones on `main`, all of them on a release tag | – |

Every Kustomization decrypts SOPS (`*.sops.yaml`) with `flux-system/sops-age` where needed and prunes only what it applied, so other workloads in the cluster are untouched.

## Developing

```sh
# sphone-api (.NET 10). Tests start PostgreSQL with Testcontainers.
export DOCKER_HOST=unix://$HOME/.rd/docker.sock
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock   # Rancher Desktop: socket path inside the VM
cd services/sphone-api
dotnet test
dotnet format --verify-no-changes                                   # lint, as CI runs it
dotnet tool restore && dotnet ef migrations add <Name> --project src/Sphone.Data

# Run locally: a PostgreSQL on localhost:5432 (user/password/db sphone), then
docker run -d --name sphone-pg -p 5432:5432 -e POSTGRES_USER=sphone -e POSTGRES_PASSWORD=sphone -e POSTGRES_DB=sphone postgres:18-alpine
dotnet run --project src/Sphone.Api                                 # http://localhost:5080, migrates and seeds

# sphone-web (Node 24)
cd services/sphone-web
npm ci && npm run dev                                               # proxies /api to localhost:5080
npm run lint && npm run build                                       # as CI runs it

# thirdparty-mock (Node 24). sphone-api's Development settings point ThirdParty:BaseUrl at localhost:4000.
cd services/thirdparty-mock
npm ci && npm run dev                                               # http://localhost:4000/sms/inbox
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
