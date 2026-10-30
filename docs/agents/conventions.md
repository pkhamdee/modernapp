# Conventions and gotchas for agents

What the code does not tell you at a glance. Commands, layout and setup live in `docs/setup.md`
("Developing", "Repo layout"); releases and how a tag reaches `eshop-prod` in `docs/git-workflow.md`; domain
terms in `GLOSSARY.md`; decisions in `docs/adr/`. This file points there rather than repeating them.

## Local environment

- **Docker**: the user's active docker context `rd-ssh` is broken. Leave the context as it is; point each command
  at Rancher Desktop's socket instead, e.g. `DOCKER_HOST=unix:///Users/pongsak/.rd/docker.sock docker ...`.
- **Testcontainers** on Rancher Desktop needs both `DOCKER_HOST` (above) and
  `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` (the socket path inside the VM); without the
  override Ryuk fails to start (`docs/setup.md`, "Developing").
- **.NET 10** is at `~/.dotnet`, not on `PATH`: set `DOTNET_ROOT=$HOME/.dotnet` and prepend
  `$HOME/.dotnet:$HOME/.dotnet/tools` to `PATH`. If the shell guard rejects `export` or variables as command
  names, a tiny wrapper script with literal paths (`exec /Users/pongsak/.dotnet/dotnet "$@"`) works.
- **SOPS** on macOS does not look in `~/.config` by default: decrypting needs
  `SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt`. The age public key is in `.sops.yaml`.
- **zsh** expands globs and brackets: quote `kubectl -o 'custom-columns=...[0]...'`, `node --test 'test/**/*.test.ts'`
  and anything else with `*`, `?`, `[` or `]`.
- **Shell guard**: compound commands with heredocs, `sh -c`, `source` (also the word in `flux reconcile source git`)
  or long inline Python are often rejected. Write scripts to the scratchpad with the Write tool and run
  `python3 -I <file>`; use `flux reconcile kustomization <name> -n flux-system --with-source` to fetch and apply.
- **Scripted API checks**: macOS `/bin/bash` 3.2 mangles Thai/multibyte JSON inside `"$(curl -d ...)"`; use Python
  `urllib` for anything with Thai text.
- **Shared cluster**: the cluster also runs unrelated workloads: only touch namespaces this repo manages
  (eshop-dev, eshop-prod, thirdparty, gateway, cert-manager, cnpg-system, flux-system).
- **Secrets in output**: decrypt Staff/DB/SMB passwords only inside a script that uses them and never prints them.
  Printing them is blocked for agents and leaks into logs.
- `gh pr create` can fail with "connection reset by peer" after the push succeeded: check
  `gh pr list --head <branch>` before retrying.

## eshop-api (.NET solution `services/eshop-api`)

Layout:

- `Eshop.Domain` holds the rules and no infrastructure: one folder per area. Reuse the domain rules
  (`Catalog/InstallmentPlan`, `Applications/Eligibility`, `Customers/SmsCode`) instead of re-implementing them.
- `Eshop.Data`: `EshopDbContext`, one `Configurations/<X>Configuration.cs` per entity, snake_case names via
  EFCore.NamingConventions, `Seed/DemoData.cs`.
- `Eshop.Api`: one folder per feature with `<X>Endpoints.cs` exposing `Map<X>Endpoints(this IEndpointRouteBuilder)`,
  wired on the `/api` group in `Program.cs`. Health probes `/healthz/live|ready` sit outside `/api` so the Gateway
  never exposes them.
- `Eshop.SyncMaster` (eshop-sync-master) lives in the same solution and references `Eshop.Data`; it never migrates.
- Package versions only in `Directory.Packages.props` (`<PackageReference>` without `Version`). Warnings are errors,
  including NuGet audit (`NU1903`): a vulnerable transitive package is fixed by pinning a `PackageVersion` plus a
  direct reference (see `System.Security.Cryptography.Pkcs`).

Adding an endpoint:

1. Test first in `tests/Eshop.Api.Tests/<Area>/<X>Tests.cs`: `public sealed class XTests(EshopApiFactory api)`,
   `api.CreateClient()` (or a signed-in client, below), `TestContext.Current.CancellationToken`. Assert on HTTP
   responses only; read JSON into private records.
2. Add `Map<X>Endpoints` (a `MapGroup`, private static handlers, `internal sealed record <X>Response` DTOs) and wire
   it in `Program.cs`. Routes and JSON use GLOSSARY names; enums serialise kebab-case.
3. Refusals go through `Refusal.cs` (`Refusal.BadRequest/Conflict/Of`, `Refusal.SmsCode`, extra fields as
   `("key", value)` tuples), giving ProblemDetails with an `error` code. Missing: `TypedResults.NotFound()`.
4. Roles: `group.RequireAuthorization(Roles.Customer|Roles.Staff)` (no token 401, wrong role 403). Current user:
   `user.RequiredCustomerId()`, `user.RequiredStaffUsername()`.
5. Staff endpoints go under `BackOffice/` as a `Map<X>Administration(this RouteGroupBuilder)` called from
   `BackOfficeEndpoints`, so they inherit the Staff policy; add each to the `TheoryData` in
   `BackOffice/BackOfficeAccessTests.cs`. Validation: `BackOfficeEndpoints.Errors()` +
   `errors.Require(ok, field, thaiMessage)` → `TypedResults.ValidationProblem`.

Rules the code follows:

- **Time** comes only from the injected `TimeProvider` (singleton in `Program.cs`). Timeouts too:
  `new CancellationTokenSource(delay, timeProvider)` so the fake clock fires them. Bangkok dates/times via
  `Eshop.Domain.Bangkok`.
- **First writer wins** (no-tie Bids, Lot edits, payment vs forfeit): one conditional `ExecuteUpdateAsync`
  (`WHERE ... AND <precondition>`) and act on rows affected = 0. A read-then-write loses races; the concurrency
  tests catch it.
- **Contract is owned by the Enterprise System** (ADR-0001): private setters; only sync-master changes status via
  the internal `RefreshFromEnterprise`. Handover data lives beside it (ADR-0004). Active Contracts in queries:
  `db.Contracts.Where(Contract.IsActive)`.
- **Offer status**: always read `StatusAt(now)`; the stored status is updated lazily. Same for `Auction`/`Lot`.
- Contract numbers come from `contract_number_counters` via `INSERT ... ON CONFLICT ... RETURNING` with
  `SqlQuery<int>(...).ToListAsync()`; composing it with `SingleAsync` makes EF wrap the INSERT in a subquery.
- Contract, outbox row and Handover are written in one explicit transaction (`OfferEndpoints.Accept`).

Test harness (Seam 1, `EshopApiFactory`):

- One `[assembly: AssemblyFixture]`: one Postgres container and one host for every test, started in
  `InitializeAsync` to avoid double seeding. All tests share one database: create unique data per test
  (`TestData.NewMobileNumber()`, `NewIdNumber()`, `NewPhoto()`), filter catalog-wide assertions to your own rows,
  never rely on row counts, and create Products through the back-office API rather than the DB.
- Signed-in clients: `api.CreateCustomerClientAsync()`, `api.CreateStaffClientAsync()`. Area helpers are extension
  methods beside the tests (`Applications/Applying.cs`, `Offers/Offering.cs`, `Handovers/HandingOver.cs`,
  `Auctions/Bidding.cs`, `Contracts/EnterpriseSync.cs` for simulating the sync pull). Look there before writing
  setup code.
- Fakes (`tests/.../Fakes/`, swapped with `services.Replace` in `ConfigureWebHost`): `api.Clock`
  (`FakeTimeProvider`, starts 2026-01-05T03:00Z), `api.Sms`, `api.Images`, `api.IdVerification`, `api.CreditCheck`.
  Scripted fakes throw for an unscripted ID number.
- **Moving the clock**: put the test in `[Collection(nameof(ClockMoving))]` (defined in `tests/.../ClockMoving.cs`
  with `DisableParallelization = true`) and only move forward. Keep the explicit name: a collection definition
  without it was seen to run in parallel silently. After advancing past a token lifetime (Customer 7 days, Staff
  12 h) sign in again. Tests that change shared settings (Flat Rate, Term) use
  `[Collection(nameof(ProductCategorySettings))]` and restore in `finally`.
- Filter tests with `dotnet test <proj> --filter "FullyQualifiedName~X"` (vstest runner).

Third-party ports: interface + real adapter in `Eshop.Api/ThirdParty/` (typed `HttpClient`), registered in
`AddThirdParties` against `ThirdParty:BaseUrl`; an in-memory fake in `tests/.../Fakes/` exposed as a property on
`EshopApiFactory`. The image service port is `Images/IImageStore`; store only the image ID in Postgres.

Migrations: `dotnet ef migrations add <Name> --project src/Eshop.Data` (`docs/setup.md`). Only eshop-api applies
them, at startup (`Database:MigrateOnStartup`). Demo data is seeded by `UseSeeding`/`UseAsyncSeeding` into empty
tables only (no `HasData`, so identity sequences stay right). On a model-snapshot conflict after a rebase, or after
a bad `migrations remove`: check out `origin/main`'s `EshopDbContextModelSnapshot.cs`, delete your migration files
and run `migrations add` again.

eshop-sync-master:

- Seam-2 tests (`tests/Eshop.SyncMaster.Tests`, `SyncMasterFactory`) run Postgres and an amd64 SQL Server; CI keeps
  them on x86 (`ubuntu-latest`). Locally SQL Server runs under Rosetta (~20 s start).
- A new pulled Enterprise table follows `Sync/ContractPull`: `row_ver` watermark per table in `sync_watermarks`,
  bounded by `MIN_ACTIVE_ROWVERSION()`, saved in the same transaction under `pg_advisory_xact_lock`. Without the
  lock, overlapping pullers (rolling update, parallel tests) hit duplicate keys.
- Enterprise tables have triggers, so `UPDATE ... OUTPUT` without `INTO` fails; use rows affected. Schema changes go
  in `deploy/thirdparty/mssql/enterprise-schema.sql` (idempotent); the tests run the same file.
- SqlClient needs ICU: SyncMaster sets `InvariantGlobalization=false` and uses the `-chiseled-extra` image.
  eshop-api stays invariant. Npgsql connection strings include `GSS Encryption Mode=Disable` (libgssapi noise on
  chiseled images).

## Node services (`eshop-node-api`, `thirdparty-mock`)

- Node 24 runs `src/*.ts` directly (type stripping): no build step, imports end in `.ts`, `erasableSyntaxOnly`,
  so no enums or parameter properties. `npm run lint` / `typecheck` as in `package.json`.
- eshop-node-api: ports as interfaces (`ImageStore`) with adapters (`folderImageStore`, `smbImageStore`). Tests
  (`node --test`) start the real service on port 0 via `test/harness.ts` and assert on HTTP only;
  `startSmbService()` puts `test/fake-smbclient/` (an ESM script: use `import`) on `PATH`. Extend that fake when the
  adapter sends a new smbclient command.
- SMB goes through the `smbclient` binary because pure-JS SMB libraries need NTLMv1/MD4. Use `ls`, not `allinfo`,
  to test existence: Samba without VSS answers `allinfo` with `NT_STATUS_INVALID_DEVICE_REQUEST`.
- `/internal/images/...` is never routed by the Gateway; through the Gateway that path returns the SPA's
  `index.html` (200 text/html), so check the content type when verifying image privacy.
- thirdparty-mock: one Router per mocked party in `src/<party>.ts`, mounted in `src/app.ts`; ID Verification and
  Credit Check sit behind `simulatedDelay`, SMS does not. HTML links must be relative (served under
  `/thirdparty-mock/`). State is in memory, one replica. Test ID numbers (outcome by last two digits) are in
  `src/testIdNumbers.ts`; the 30-day re-apply wait follows the ID number, so use a fresh prefix per demo run.

## eshop-web (`services/eshop-web`)

- Routes in `src/routes.tsx`; signed-in sections are nested layout routes guarded by `<RequireRole role=.../>`, and
  the back office is its own `/staff` branch with `StaffLayout`. Pages in `src/pages/` (`src/pages/staff/`), API
  types and calls in `src/api/<area>.ts`.
- Fetch only through `src/api/client.ts` (`useApi`, `useReloadableApi`, `apiGet/Post/Put/GetBlob`,
  `problemMessage`): it adds the Bearer token and clears the session on a 401. Format money, dates and Flat Rate
  with `src/format.ts` (Asia/Bangkok).
- Thai copy, mobile-first, plain CSS in one file (`src/index.css`), 44 px touch targets, visible `:focus-visible`.
- Breakpoints are defined once, in the comment at the top of `src/index.css`: phone (base, 360 px and up), tablet
  `min-width: 768px`, wide `min-width: 1024px`, desktop `min-width: 1280px`. Use only these widths in media
  queries and name the breakpoint in a comment. Customer content sits in `.frame` (centred, max 1200 px); the
  header shows a menu button below 768 px and a top bar from 768 px (`AppLayout.tsx`). Staff screens keep the old
  640 px column (`.staff-app`) until their sidebar lands.
- e2e: Customer sections are reached with `navigateTo(page, 'สินค้า' | 'ประมูล' | 'บัญชีของฉัน' | 'เข้าสู่ระบบ')`
  in `e2e/tests/steps.ts` (menu on phone, top bar on desktop); `isPhone()` tells the projects apart.
- The image drops all capabilities: Caddy's file capability is removed with `setcap -r` and it listens on 8080.
- Service worker (ADR 0006, #59): hand-written `src/pwa/sw.js`, built to `/sw.js` by the `serviceWorker()` plugin in
  `vite.config.ts` (it injects the build's file list and a content hash), registered in production builds only.
  It pre-caches built static files and `public/offline.html` and never intercepts `/api/*`, `/images/*` or
  `/thirdparty-mock/*`; don't add runtime caching of API responses. Anything in `public/` is pre-cached, so keep
  it small. `vite dev` has no worker; test it with `vite build && vite preview` or the image.

## Deploy and Flux

- **Check manifests before pushing**: `DOCKER_HOST=unix://$HOME/.rd/docker.sock scripts/validate-manifests.sh` (kustomize build + kubeconform, as CI does). Pushes touching only `deploy/**` or `clusters/**` run no CI, so a broken manifest is otherwise found only when Flux fails to apply it.
- **Adding a service**: base folder `deploy/apps/base/<svc>/` (Deployment, Service, an HTTPRoute if the Gateway routes it, `network-policy.yaml`),
  an entry in `.github/services.json`, a lint/test job in `ci-release.yml` listed in `plan.needs`. Dev: see the
  header of `deploy/apps/dev/image-automation.yaml`. Prod: see the header of `deploy/apps/prod/kustomization.yaml`
  and `docs/git-workflow.md` ("Adding a service"). Prod has no image automation of its own; it follows the newest
  release tag via `clusters/local/prod-release.yaml`.
- Base Deployments use untagged `ghcr.io/pkhamdee/<svc>`; tags are set only by the setter markers
  (`# {"$imagepolicy": "<ns>:<policy>:tag"}`) that Flux rewrites. Leave the tag values to Flux.
- Flux image-automation commits touch only `deploy/**` and `clusters/**`, which CI ignores (`paths-ignore`); a commit
  mixing code with those paths still runs CI.
- Base HTTPRoutes are dev-shaped (`eshop.localhost`, `sectionName: https`, one parentRef); the prod overlay patches
  every HTTPRoute. Keep prod hostnames out of base.
- **NetworkPolicies** (default deny in eshop-dev, eshop-prod, thirdparty; enforced by k3s' kube-router): each call
  needs both ends, caller egress and callee ingress. Egress names the container port number (e.g. 8080), not the
  Service port. Gateway = `kube-system` namespace + `app.kubernetes.io/name: traefik`; same-namespace callers by
  podSelector only (keeps dev and prod apart); thirdparty callees list callers by namespace `In [eshop-dev,
  eshop-prod]`. Copy `deploy/apps/base/eshop-api/network-policy.yaml`.
- Until prod runs `v0.2.0`, `main` also carries commented, temporary `sphone-*` entries that keep the v0.1.x release
  running (docs/setup.md, "Moving to eShop"); `git grep -n -i sphone` lists them. Don't copy them into new work.
- **Secrets**: one SOPS file per env, `deploy/apps/{dev,prod}/<name>.sops.yaml`, listed in that overlay's
  resources; `.sops.yaml` encrypts only `data`/`stringData`. Pairs that must match: each env's
  `eshop-node-api-smb` with `deploy/thirdparty/samba/samba-accounts.sops.yaml`, and each env's
  `eshop-sync-master-enterprise` with `deploy/thirdparty/mssql/mssql-credentials.sops.yaml`.
- Images whose binary carries a file capability (Caddy, `sqlservr`) fail with "operation not permitted" under
  `drop: [ALL]`: remove the capability in the image (as eshop-web does) or add `NET_BIND_SERVICE` back (as mssql
  does).
- Trivy fails CI on any CRITICAL, fixed or not. For an unfixable one add a `.trivyignore` (CVE, reason, date) and
  pass it to the action.
- An ImagePolicy with no matching tag stays not Ready and blocks a `wait: true` Kustomization: a new service's image
  must exist before its policy is applied.

## thirdparty

- `deploy/thirdparty` (Flux Kustomization `thirdparty`, namespace `thirdparty`) holds mocks shared by both envs:
  thirdparty-mock, Samba (one share per env), SQL Server (one database per env). It follows `main` with its own image
  automation, independent of releases.
- thirdparty-mock is routed only on `https://eshop.localhost/thirdparty-mock/`, never on `prod.eshop.localhost`;
  prod's SMS inbox and Enterprise admin (`.../enterprise/prod/`) are reached there too (`e2e/environment.ts`).
- SQL Server is amd64-only and runs under Rosetta with no nodeSelector. Its `schema` sidecar re-applies the schema
  on every start; changing a file in its ConfigMap generator restarts the pod.

## Human-only steps

Agents are denied these; ask the user, giving the exact command:

- creating Kubernetes Secrets that contain key material, or decrypting and printing credentials;
- restarting Flux controllers (e.g. `kubectl -n flux-system rollout restart deploy/kustomize-controller` when
  Kustomizations hang at "Reconciliation in progress");
- making a new GHCR package public (the `gh` token has no packages scope);
- pushing release branches and tags, and dispatching the release workflow (`docs/git-workflow.md`, "Releasing").

`gh pr merge <n> --squash --delete-branch` works for agents only as a standalone command, not inside a compound one.
