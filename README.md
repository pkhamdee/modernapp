# S Phone

Mobile-first web app for buying a phone on hire purchase with one ID card, plus weekly auctions of used iPhones,
running on a local Kubernetes cluster (Rancher Desktop, Flux, Gateway API). Spec: issue #1; vocabulary:
[GLOSSARY.md](GLOSSARY.md); decisions: [docs/adr/](docs/adr/).

| Environment | URL | Deployed from |
| --- | --- | --- |
| sphone-dev | https://sphone.localhost | every push to `main` |
| sphone-prod | https://prod.sphone.localhost | release tags `vX.Y.Z` |

Mocks (SMS inbox, ID Verification / Credit Check, Enterprise System admin tool): https://sphone.localhost/thirdparty-mock/

## The demo

1. A Customer signs in by SMS (read the code in the mock SMS inbox), opens an iPhone, picks a Down Payment and Term,
   and applies with an ID number and an ID card photo (thirdparty-mock ID numbers ending `01` are approved).
2. Within 60 seconds the Application is Approved; the Customer accepts the Offer with an SMS code and gets a Contract.
3. sphone-sync-master pushes the Contract to the mock Enterprise System (admin tool → `dev/` or `prod/`).
4. Staff (`/staff`, demo account in SOPS) record the Down Payment and the Handover.
5. **Simulate Payment** in the admin tool; the Payment shows on the Customer's Contract within about 30 seconds.
6. Separately, Staff create an Auction and add Lots; an ID-verified Customer bids and wins when it closes.

`cd e2e && npm run e2e` runs all of it in a browser (add `E2E_BASE_URL=https://prod.sphone.localhost` for prod).

## Docs

- [docs/setup.md](docs/setup.md): cluster setup, Staff account, mocks, the end-to-end smoke test, releasing, development
- [docs/git-workflow.md](docs/git-workflow.md): tag-based releases (`release/N.x` branches, `vX.Y.Z` tags)
