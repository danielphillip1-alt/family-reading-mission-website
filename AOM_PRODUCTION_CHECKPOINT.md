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
