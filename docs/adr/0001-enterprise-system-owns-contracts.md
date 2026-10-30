# The Enterprise System owns Contracts once pushed

eShop owns a Contract only from the moment the Customer accepts the Offer until sphone-sync-master has pushed it to the Enterprise System (eShop Co.'s core hire-purchase system). From then on the Enterprise System is the sole owner of the Contract and its Payments, and eShop holds a read-only copy refreshed by sync-master. We chose single ownership per record over either system being the master for everything, because eShop must originate Contracts quickly while collections and accounting already live in the Enterprise System.

## Consequences

- eShop never edits a pushed Contract or records an Installment Payment; such changes happen in the Enterprise System and arrive by sync.
- Data shown to the Customer can be up to one sync interval (30 s) behind the Enterprise System.
