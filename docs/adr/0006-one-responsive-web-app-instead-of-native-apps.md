# One responsive web app (PWA) instead of native mobile apps

eShop must work on web and mobile. We meet that with the one existing web app, made responsive for phone (360px and up), tablet (768px and up) and desktop (1280px and up), and installable to the home screen as a Progressive Web App. We do not build native iOS or Android apps. A native app would mean a second frontend kept in step with every feature, plus app-store review and releases, and nothing eShop does needs it: hire purchase, Auctions and the Staff screens all run in a browser, and the ID card photo is taken with the browser's file and camera picker.

## Considered Options

- **Native apps (e.g. React Native / Expo) beside the web app**: rejected for the cost above.
- **Native apps only**: rejected; Staff work at a Branch counter on a desktop browser, and Customers arriving from a link should not have to install anything.

## Consequences

- The PWA caches only the app's static files and an offline page, never API responses: Contracts, Offers and Bids are personal and change quickly, so a stale copy would mislead.
- No push notifications for now: a Customer sees being outbid, or an Offer about to expire, only when they open the app. Web Push can be added later without changing this decision.
- Revisit this if a feature needs device access that browsers do not provide.
