# CUSTOMER PDFs — Canonical Subscriber Library (2026-11-13)

**Exclusive source of truth:** ChatGPT Library folder `/Customer PDFs/`. Only files the user uploads into this folder and explicitly approves for customer distribution may be ingested into the private subscriber delivery database. Never substitute an EPUB, KDP draft, sample excerpt, website preview, or a file found elsewhere.

## Intake
- On user upload, save original customer-distribution PDFs in `/Customer PDFs/`; do not modify their contents.
- Validate each PDF's language, title, reading month, completeness, publication approval, size, and SHA-256 before ingesting.
- Private server storage keys must begin `customer-pdfs/` and match files sourced from this folder.
- Do not expose PDFs as public GitHub or Render static assets.
- Do not silently overwrite previously approved files; reconcile revisions against the exact customer source.
- Current active languages: English (en), German (de), European Portuguese (pt-PT).

## Subscriber entitlements
- Reading year: November 1 through October 31, independent of subscription billing anniversary.
- A new customer with an active paid **€39.99 annual** Stripe subscription gets every approved book *already released during the current reading year* immediately, then each additional approved monthly release while active.
- A March entrant who joins after November, December, January, February and March releases receives those **five** books as the initial catch-up batch (not five randomly selected editions or drafts).
- A new paid monthly subscriber gets the same existing reading-cycle back catalog while their monthly subscription remains active.
- When the next November cycle starts, new releases from the new cycle are delivered while the membership is still active.
- Annual membership renews one year after the actual date of signup, not on November 1.
- One entitlement per book release per subscriber. Deduplicate by Stripe subscription ID + release ID; renewal does not resend already delivered books.
- Send only the member's selected language; no automatic substitution with another language.
- An unavailable, unapproved or not-yet-released book cannot be represented as available.
- Keep provider/API credentials out of the Library files and source control.

## Delivery gate
The worker is implemented, but real automatic delivery is not verified until:
1. The user uploads exact customer-edition PDFs to `/Customer PDFs/` and these are privately ingested.
2. A transactional sender credential and verified FROM address are configured.
3. An actual checkout -> verified webhook -> paid entitlement -> multi-book email batch -> recurring release test passes.
