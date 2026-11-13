# Authors On A Mission — automated book delivery (development branch)

Status: foundation only; NOT deployed, NOT accepting member data.

## Existing live integration
- Site: https://www.theauthorsmission.de
- Stripe live subscription price: price_1UbGQ3RuZKBP2B3nJaCyZkl8 (EUR 3.99, monthly, inclusive tax behavior)
- Live payment link: https://buy.stripe.com/28E3cxeAY2HM1QYe89ffy00
- Important: Stripe Tax is enabled on the link, but tax registrations and live tax calculation remain to be verified.

## Product rules
1. User selects English (en), European Portuguese (pt-PT), or German (de). Country detection can suggest, never decide.
2. Stripe webhooks are authoritative for billing status; do not grant access solely from redirect or email.
3. Checkout currently uses a static Stripe Payment Link. Match customer email to Stripe customer and verify subscription through webhook. Use checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed.
4. Associate customer to one member profile and one customer/subscription, idempotently. Require email ownership verification for self-service account linking.
5. On first confirmed active subscription, send a welcome message in chosen language and a secure link to the current book.
6. Each monthly release is a single logical book with three approved, private PDF files. If a translation is not approved, hold that subscriber's delivery and flag missing edition; never send wrong language.
7. Monthly release job creates an outbox row per eligible paid subscriber. Unique (release_id, member_id, notification_type) prevents duplicate sends. Worker runs in batches and retries safely with provider idempotency key.
8. Never attach all PDFs to bulk email. Send expiring authenticated link to a protected download endpoint. Validate paid entitlement on every download.
9. Subscribers can manage preferred language, email delivery status, and cancellation via Stripe portal. Cancellation at period end preserves access until period end.
10. Keep transactional entitlement notifications separate from opt-in marketing. Record consent metadata and support privacy deletion requests under German/EU law.
11. Record delivery status, bounced email, errors, retry count and release audit trail.
12. No new charges, live webhooks, bulk email, or publication until end-to-end staging tests pass and PDFs are approved.

## Deployment prerequisites (not yet fulfilled)
- Confirm Render workspace and the exact currently deployed service/repository.
- Inspect actual application framework. This repository's index.html was returned as empty by the GitHub file connector; do not overwrite production.
- Provision private persistent Postgres database and private object storage (no permanent public PDF URLs).
- Decide and connect a transactional email provider. BratHat Gmail is not suitable for high-volume sending.
- Configure Stripe signed webhook endpoint with restricted secret and customer portal configuration.
- Specify a consistent welcome entitlement policy for back-catalog books and refunds.
- Run end-to-end: payment in test mode, create profile, select each language, download permission, monthly dispatch, expired signed URL, renewal/failure/cancel and retries.
- Verify VAT/Stripe Tax registration and valid German legal disclosures before launch.

## Delivery engine
See database/schema.sql for foundational PostgreSQL tables. This branch is deliberately isolated; nothing has been deployed.