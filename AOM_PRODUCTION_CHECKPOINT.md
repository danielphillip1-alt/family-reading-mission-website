# Authors On A Mission — Production checkpoint, 13 Nov 2026

Public website: https://www.theauthorsmission.de — Render static srv-dbqvnpifngtc73efh7m0, main branch.
Production member backend: https://authors-on-a-mission-members.onrender.com — Render web srv-dbrjl2h5efls73aq7ls0, production-membership branch.
Production database: aom-members-production in Frankfurt.

## Verified production integrations
- Live Stripe monthly €3.99 and annual €39.90 prices created and verified in connected Stripe.
- Live Stripe webhook deployed and signing secret configured.
- Live Stripe customer portal configured, with cancellation at period end.
- Postgres operational and tested via /ready.
- Public website's join CTA routes to /join, which must redirect to /early-access until billing, books and transactional email are all truly ready.
- Launch-interest consent form stores leads in Postgres; authenticated /api/admin/launch-interest returns them.
- Server email worker supports approved-language PDF attachment delivery via Resend on subscription purchase and future releases.
- First approved book must be uploaded in English, German, European Portuguese; publication admin validates SHA-256 against private storage.
- No actual customer charge can be initiated through backend /checkout unless Stripe, book inventory and email credentials pass the check.

## Latest factual /ready response
database: true
monthly_price: true
annual_price: true
webhook_configured: true
portal_configured: true
admin_configured: true
stripe_configured: false
email_configured: false
approved_book_inventory: false
ready: false

## Unavoidable launch dependencies
1. The user's previously created live restricted Stripe API key is NOT currently visible to the app under exact environment key STRIPE_API_KEY. Verify spelling and presence in Render Environment for production web service. Never copy the key to chat or repository. Key should start rk_live_ or sk_live_ and have subscription, customer, checkout and Tax permissions.
2. Configure a verified transactional-email provider (worker expects AOM_RESEND_API_KEY and AOM_FROM_EMAIL); verify domain, then send real test email. No API key may be placed in GitHub.
3. Retrieve and verify explicitly approved Book One full editions (EN, DE, pt-PT), make PDF files <=12 MiB each or adjust size controls reasonably, upload private PDFs through authenticated /api/admin/upload-pdf, create /api/admin/releases release, publish.
4. Test sandbox payments and full payment-to-email to PDF access and cancellation. Do not expose live checkout until all steps pass.
5. Marketing includes four-week family activity plans; ensure these are actually available in subscribers' protected area before promises of delivery.

## Operational cautions
- Don't flip unverified checkout live or send customers only an excerpt as a purchased book.
- Don't claim the technical deploy proves real payment acceptance.
- Don't repeat prior OAuth authorization; live Stripe write access was repaired and confirmed.
- No user secret/API key should appear in chat or commit messages.

## 13 Nov urgent live pricing update
- Public site main branch now has two large side-by-side purchase cards with **real** Stripe checkout links:
  - Monthly €3.99/month: https://buy.stripe.com/28E3cxeAY2HM1QYe89ffy00 (existing payment link plink_1UbGQ6RuZKBP2B3nVEKI0Y7h).
  - Yearly €39.99/year: https://buy.stripe.com/8x2bJ3csQ8261QYfcdffy01 (new live price price_1UbOSVRuZKBP2B3nPcMMkq5e; link plink_1UbOT5RuZKBP2B3nKgZfg1ie).
- Both live payment links were verified active. Both collect mandatory preferred book language (English, German, Portuguese).
- 39.99/year saves €7.89 vs 12 monthly charges (€47.88).
- Render backend annual Stripe price env updated to new 39.99 price.
- Latest backend: database has direct Stripe link subscriber and delivery queue tables. Stripe webhook imports payment-link customer, language, billing status/renewals. 60-second worker queues eligible release PDFs and sends attachments directly to payer via Resend when configured.
- Live payment collection is possible immediately; **automatic book fulfillment still blocked** until Resend transactional email API secret and real approved downloadable book editions are provided. Do not say it is active.
- Client-facing website explicitly discloses automatic book delivery is being connected.
- Live Stripe secret named mixed-case `Stripe_API_Key` in Render; production code now recognizes it. Verified stripe_configured=true after deploy.
- Useful admin endpoint GET /api/admin/payment-link-subscribers authenticated with server admin Bearer token for later fulfillment.
- No refund or billing operations have been taken.


## Canonical customer book source — USER DIRECTIVE
- Authoritative folder: ChatGPT Library `/Customer PDFs` (already exists and initially empty). Newest user-uploaded customer-approved PDF editions ONLY.
- Do not import, sell, email, or deliver historical drafts, search-result PDFs, EPUB reconversions, test excerpts, or files from any other folder.
- Book release importer must verify source is `/Customer PDFs`, preserve audit provenance and checksum, and write private storage keys under `customer-pdfs/` only. Server now rejects other prefixes.
- New subscriptions through either live Stripe Payment Link get every published book since November 1 of the current November–October reading year, filtered to their chosen language. If five books are already released, all five must queue for that buyer. A member's billing anniversary is independent of the publication-year boundary.
- After initial delivery, new monthly releases continue during active paid membership. Yearly plan is €39.99; monthly is €3.99. Do not infer that yearly grants all 12 titles on day one.
- Requires approved EN, DE, pt-PT uploaded content and a verified email provider; keep exact approved content only.
