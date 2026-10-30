# Developer tools get their own arrows, and Staff may set Auction times

Two decisions made while building the MVP go beyond the spec's wording, and both would look like mistakes without a record.

**Arrows beyond the spec's NetworkPolicy list.** The spec allows only Gateway → eshop-web, eshop-api, eshop-node-api; eshop-api → PostgreSQL, eshop-node-api, thirdparty-mock; eshop-node-api → Samba; eshop-sync-master → PostgreSQL and SQL Server. We add two more, both for developer tools that the spec itself asks for: **Gateway → thirdparty-mock**, so the mock SMS inbox (story 6), the delay setting (story 64) and the mock Enterprise System admin tool (story 62) are reachable at `https://eshop.localhost/thirdparty-mock/`; and **thirdparty-mock → SQL Server** (1433), because that admin tool simulates Payments and cancellations by writing to the Enterprise databases, as the real Enterprise System's own users would. Both arrows touch only the `thirdparty` namespace, which is test equipment that would not exist in production; nothing eShop runs gains a path it did not have.

**Staff-configurable Auction times.** The spec's Auction runs weekly, Monday 10:00 to Sunday 20:00 Asia/Bangkok. That stays the default: Staff who create an Auction without times get the next such week. Staff may also give their own opening and closing times (a closing time in the past is refused; times never change once the Auction exists), because a weekly-only Auction cannot be demoed or tested end to end in less than a week: an Auction that closes in minutes is how the close, the winner's 3-day payment window and the re-offer of a Forfeited Lot are shown.

## Consequences

- `deploy/thirdparty/thirdparty-mock/network-policy.yaml` and `deploy/thirdparty/mssql/network-policy.yaml` carry these arrows.
- A real deployment would drop the thirdparty-mock route and arrows along with the mocks.
- Bidding rules (opening, closing, no ties) depend only on an Auction's own times, never on the weekly schedule, so custom times change nothing for Customers beyond when they may bid.
