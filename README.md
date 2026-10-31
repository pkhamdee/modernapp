# eShop

eShop (อีช้อป), run by eShop Co.: a mobile-first web app for buying a phone on hire purchase with one ID card,
plus weekly auctions of used iPhones, running on a local Kubernetes cluster (Rancher Desktop, Flux, Gateway API).
Spec: issue #1; vocabulary: [GLOSSARY.md](GLOSSARY.md); decisions: [docs/adr/](docs/adr/).

| Environment | URL | Deployed from |
| --- | --- | --- |
| eshop-dev | https://eshop.localhost | every push to `main` |
| eshop-qa | https://qa.eshop.localhost | the release candidate `vX.Y.Z-rc.N` pinned in Git; moves when QA merges its promotion PR |
| eshop-prod | https://prod.eshop.localhost | the release `vX.Y.Z` pinned in Git; moves when the production approver merges its promotion PR |

Mocks (SMS inbox, ID Verification / Credit Check, eShop Co. Enterprise System admin tool): https://eshop.localhost/thirdparty-mock/

## The demo

1. A Customer signs in by SMS (read the code in the mock SMS inbox), opens an iPhone, picks a Down Payment and Term,
   and applies with an ID number and an ID card photo (thirdparty-mock ID numbers ending `01` are approved).
2. Within 60 seconds the Application is Approved; the Customer accepts the Offer with an SMS code and gets a Contract.
3. eshop-sync-master pushes the Contract to the mock Enterprise System (admin tool → `dev/` or `prod/`).
4. Staff (`/staff`, demo account in SOPS) record the Down Payment and the Handover.
5. **Simulate Payment** in the admin tool; the Payment shows on the Customer's Contract within about 30 seconds.
6. Separately, Staff create an Auction and add Lots; an ID-verified Customer bids and wins when it closes.

`cd e2e && npm run e2e` runs all of it in a browser (add `E2E_BASE_URL=https://prod.eshop.localhost` for prod).

## Docs

- [docs/setup.md](docs/setup.md): cluster setup, Staff account, mocks, the end-to-end smoke test, releasing, development
- [docs/git-workflow.md](docs/git-workflow.md): protected `main`, release candidates, gates, QA, sign-off, promotion PRs
  and rollback (`release/N.x` branches, `vX.Y.Z-rc.N` and `vX.Y.Z` tags)
