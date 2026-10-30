# The Handover is kept beside the Contract, not on it

A Contract is usually pushed to the Enterprise System within about 30 seconds of acceptance, long before Staff hand over the goods. ADR-0001 says eShop never edits a pushed Contract, yet Handover facts (its stage, the Down Payment received, the Handover date that starts the Installment schedule) are recorded later, by eShop's Staff. We keep them in a separate `handovers` row (one per Contract, created in the same transaction) that eShop owns for good, and never update the `contracts` row for a Handover. Installment due dates are derived on read: Installment n falls due n months after the Handover date in Asia/Bangkok.

## Consequences

- The `contracts` row stays exactly as accepted and pushed; only sync-master changes it (status and Payments pulled from the Enterprise System).
- A Contract cancelled in the Enterprise System stops its Handover: once sync sets the Contract's status to cancelled, Staff can no longer move the stage or record the Down Payment, and the Contract leaves the list awaiting Handover.
- The Enterprise System only learns the Handover date and the Down Payment if something pushes them as Handover events. That is not in the MVP; until then the due dates eShop shows are its own derivation.
