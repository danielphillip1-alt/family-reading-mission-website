# Authors On A Mission — verified production checkpoint — 13 Nov 2026

## Live services
- Public site: https://www.theauthorsmission.de — Render static srv-dbqvnpifngtc73efh7m0 — main branch.
- Membership backend: https://authors-on-a-mission-members.onrender.com — Render web srv-dbrjl2h5efls73aq7ls0 — production-membership branch — **FREE** compute.
- Private Frankfurt Postgres: aom-members-production (dpg-dbreshec6qcc73dmvf8g-a); no external IPs permitted. Do not weaken DB network security for diagnostics.
- Stripe live context: acct_1UbDu6RuZKBP2B3n.

## Live pricing and checkout
- Monthly €3.99 recurring: https://buy.stripe.com/28E3cxeAY2HM1QYe89ffy00, Payment Link plink_1UbGQ6RuZKBP2B3nVEKI0Y7h.
- Annual €39.99 recurring: https://buy.stripe.com/8x2bJ3csQ8261QYfcdffy01, Payment Link plink_1UbOT5RuZKBP2B3nKgZfg1ie; highlighted on site in vivid green with accurate 16.5% saving vs €3.99 × 12.
- Both Payment Links are active and have Stripe Tax enabled and a required book-language dropdown (EN, DE, PT), and are configured to REDIRECT after completion to:
  https://authors-on-a-mission-members.onrender.com/purchase-success?session_id={CHECKOUT_SESSION_ID}
- Backend /purchase-success and /purchase-book require a REAL LIVE completed paid Stripe subscription session and active unexpired subscription. Private PDFs are not exposed to unpaid visitors. /purchase-manage creates Stripe billing portal session.
- Live restricted Stripe API key is correctly recognized (including environment variable name Stripe_API_Key), and 2026-11-13 production start logs explicitly verified **checkoutRead:true and subscriptionRead:true**. The real unpaid session negative test confirmed 403 with no book links.
- On Nov 13, latest live Stripe list contained **0 completed payments**; no real paid customer redirect or automatic email E2E proof exists. NEVER claim these have passed.
- Dynamic paid customer download page now lists all approved, published books in the current Nov-Oct reading cycle. Users can return via their private checkout success link for later releases while subscription remains active.

## Approved Book One inventory
- Exact three approved full PDF editions were checksum-verified and IMPORTED into the PRODUCTION Postgres private aom_book_files table and published in release slug zachary-my-unique-hat-2026-11. /ready confirms approved_book_inventory=true.
- Languages: en, de, pt-PT.
- Separate original supplied files are preserved in ChatGPT Library:
  /Singularity/Family Reading Mission/Customer Book Library/2026-11 — Book One/
  as Book_01_English.epub, Book_01_Portuguese_PT.epub, Book_01_German.pdf.
- The original EPUBs were converted to PDF for the subscriber downloads.
- member/import-approved-books.mjs checks existing approved DB hashes first, to avoid depending on expiring temporary transfer URLs on subsequent redeploys.
- User intent: submit ONE new approved book/month, never mix unreleased files with published inventory.

## Automatic recurring EMAIL fulfillment — CONFIGURED AND REAL PDF SENDS VERIFIED
- Resend sending domain mail.theauthorsmission.de verified by user. From: Authors On A Mission <books@mail.theauthorsmission.de>.
- User saved Resend key as **AOM_Resend_API_KEY** (mixed case); production server safely aliases it to AOM_RESEND_API_KEY without displaying any secret. Never ask user to paste key again.
- Production Render /ready checked true for ready, database, email_configured, approved_book_inventory, stripe_configured, stripe_checkout_read_verified, stripe_subscription_read_verified.
- Production Resend successfully sent COMPLETE Book One PDFs via server-side code and all three messages **arrived in the connected business Gmail inbox**, with exact attachment bytes confirmed:
  - English 7,462,409 bytes: Zachary_My_Unique_Book_One_EN.pdf
  - German 9,930,177 bytes: Zachary_My_Unique_Book_One_DE.pdf
  - Portuguese 7,465,891 bytes: Zachary_My_Unique_Book_One_PT.pdf
- Real paid Checkout Session → Stripe webhook → database → email **has NOT been exercised with a real completed payment**: the live Stripe account had zero completed checkout sessions as of the last check. Never present a simulated test as a real paid-purchase end-to-end verification.
- The Stripe webhook listens to checkout.session.completed and subscription events, stores direct subscriber email and selected language in aom_direct_subscriptions, and the member/book-delivery.mjs worker emails each newly published, language-matched full PDF to active subscribers. Outbox deduplicates (subscription ID, release ID), retries transient failures and prevents sending to nonactive subscriptions.
- The Render service is on FREE compute and sleeps when idle; an hourly GitHub Actions scheduled workflow exists on the **main/default branch**, .github/workflows/wake-book-delivery.yml, to wake the service, allowing queued emails to process. This is best-effort, not a delivery-time SLA.
- The website's two payment links redirect verified buyers to a private /purchase-success book library with immediate downloads; email sends separately, normally shortly after webhook processing.
- User only needs to upload one new approved book per month, verify all 3 languages, and have the assistant approve/import/release it; do not guess or substitute nonapproved files.
- Do not add new payment credentials or require the user to recreate Resend setup.

## Test evidence
- Production deploy on 2026-11-13 returned LIVE and /health returned ok.
- Production /ready retrieved through browser: database true, approved_book_inventory true, stripe_checkout_read_verified true, stripe_subscription_read_verified true, email_configured false, ready false.
- Paid entitlement unit tests exist in member/instant-book.test.mjs; negatives were also tested against an actual unpaid live Stripe session.
- No secrets should be echoed or copied to chats or source control.
