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

## Automatic recurring EMAIL fulfillment — NOT CONFIGURED
- IMPORTANT: Production /ready gives email_configured=false and ready=false. The Resend HTTP API integration exists in member/mail.mjs, with automatic once-per-release email outbox, retry and PDF attachment logic in member/book-delivery.mjs. Stripe payment link webhook records paid subscribers, renewal state and selected language in aom_direct_subscriptions. Worker runs every 60s while service is awake.
- Missing: verified transactional email sender and HTTPS API token (AOM_RESEND_API_KEY and AOM_FROM_EMAIL).
- Official Render docs: Free web service **BLOCKS all SMTP outbound ports 25,465,587** (https://render.com/docs/free), so Gmail app password and smtp.gmail.com fallback **WILL NOT WORK ON THIS SERVICE PLAN**. Do not send user to generate app password. Existing ChatGPT Gmail connector can send manual messages but cannot be silently transferred into backend API credentials.
- Correct production path: set up a transactional HTTPS API such as Resend at https://resend.com, verify domain/subdomain with DNS at domain host, create a send-scoped API key, add AOM_RESEND_API_KEY and AOM_FROM_EMAIL securely to the Render service (never in chat or GitHub); redeploy, run a REAL email-to-owner test and then check delivery outbox/logs. Resend free cap currently 100 per day/3,000 monthly; user may need a higher tier if volume exceeds cap.
- Do not mark email delivery ready or promise instant EMAIL until an actual outgoing paid-user-style email with full PDF succeeds.
- Immediate post-payment book **DOWNLOAD** does not depend on email, and the Stripe Payment Links redirect is already configured. This is the working fallback while email service is being connected.

## Test evidence
- Production deploy on 2026-11-13 returned LIVE and /health returned ok.
- Production /ready retrieved through browser: database true, approved_book_inventory true, stripe_checkout_read_verified true, stripe_subscription_read_verified true, email_configured false, ready false.
- Paid entitlement unit tests exist in member/instant-book.test.mjs; negatives were also tested against an actual unpaid live Stripe session.
- No secrets should be echoed or copied to chats or source control.
