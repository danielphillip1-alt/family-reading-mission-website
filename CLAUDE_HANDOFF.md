# Authors On A Mission — Claude Code ownership handoff
Updated 2026-11-17. Read this file BEFORE changing the website. Owner authorizes Claude Code to take over implementation, testing, deployment, and repair. Do not ask the owner to perform coding, file transfers, Git, or Render dashboard work that the connected coding agent can do.

## Production references
- Canonical website: https://www.theauthorsmission.de
- Single GitHub repository: https://github.com/danielphillip1-alt/family-reading-mission-website
- Public frontend source/deploy branch: **main**
- Backend, gift downloads, PDF database, and secure reading source/deploy branch: **production-membership**
- Public Render static site: service ID `srv-dbqvnpifngtc73efh7m0`, https://family-reading-mission.onrender.com
- Backend Render web service: service ID `srv-dbrjl2h5efls73aq7ls0`, https://authors-on-a-mission-members.onrender.com
- Render workspace observed: `tea-dbq54c0ae00c73dbl92g` ("My Workspace").
- PostgreSQL backing DB observed: `dpg-dbreshec6qcc73dmvf8g-a`; its external IP allowlist is empty, so remote SQL clients cannot connect. Prefer backend-side read-only diagnostics over weakening DB network controls.
- Both services are Git-connected; pushes to their configured branches auto-deploy. Do NOT create a replacement website, domain, Stripe account, or Render service.
- Public site main entry: `index.html`; multilingual gallery: `library.html`.
- Backend: `member/server.mjs`; gift and free-book routing: `member/storybook-gifts.mjs`; download archive: `member/zip-library.mjs`; prewarm: `member/private-zip-cache.mjs`; bookshelf: `member/gift-shelf.mjs`; covers: `member/gift-shelf-art.mjs`.
- Backend startup audits: `member/audit-approved-editions.mjs`, `member/live-storybook-smoke.mjs`. Read Render logs to distinguish storage checks from real gift/UI tests.

## Most urgent tasks (acceptance criteria)
1. **Free-gift recipient flow: exactly Language -> Download.** Existing authenticated/private gift URL is the access token. No purchase link, PIN, pasted gift link, sign-in, or extra popup. The ZIP should begin promptly with a visible responsive state and reliable iOS Safari behavior. Do not make proprietary files available publicly; do not downgrade the private URL's entropy or access restrictions.
2. **Correct language inventory and series order.** Every downloaded ZIP must contain all and ONLY the approved books in that language, arranged in `01_Zachary_Series/` and `02_Emir_Series/` with zero-padded sequence numbers. Current release in backend tests was **19 downloadable PDFs**: en 5, de 5, pt-PT 3, tr 2, es 2, fr 2. A database inventory also included `emir-meets-zachary` for en/de/tr/es/fr, but that story was **editorially unapproved** as of prior instruction and `fileFor()` intentionally excludes it. Owner now reports three German Emir books uploaded. Investigate editorial approval explicitly, without silently releasing a draft; storage presence does not equal approval. If now approved in the source of truth, release with correct language and test; otherwise explain the precise remaining editorial gate.
3. **Repair missing Zachary Book 1 German cover without substitution.** The approved user-uploaded file in their file library, `Book_01_German.pdf` (also named `Zachary_und_der_My_Unique_Hut_Buch_1_DE.pdf`), is about 14,389,311 bytes; previously published German Book One PDF was only about 1,095,797 bytes. This strongly suggests wrong source/format. Inspect approved cover/pages and restore EXACT original PDF, images, page order, typography; don't render a screenshot, stock replacement or placeholder. The repo now contains 24 staging slices at `member/secure-staged/zachary-book1-de.part01.txt` through `part24.txt`; confirm their encoding/hash and reconstruct carefully if needed; DO NOT directly commit an unencrypted/unencrypted full PDF to a public branch. Target PDF integrity and cover visual QA. The staging slices are potentially sensitive content: follow least-privilege practices.
4. **Fast downloads.** ZIP prewarm on backend boot exists in `warmGiftArchives`, with private ephemeral disk cache. On earlier boot logs: `Private language ZIP cache ready` with `de: 5, 46828125 bytes`. Need test latency from actual gift link to first response byte and completion on iPhone. Avoid recomputing ZIP each request. Verify Render free-instance sleep/restart behavior and prewarm concurrency. Time-to-first-byte is critical.
5. **Complete customer journey end to end.** Test real gift message -> private URL -> language dropdown -> one Download button -> ZIP contents -> PDF opening, incl. iOS and browser desktop. Confirm original cover and book numbering. Keep existing gift visual design, checkout, mailing, languages and existing book art.
6. **Remove mistaken pricing/gift cross-contamination.** The free gift experience must NOT advertise purchases/prices or prompt for a gift link already embedded in the URL. Public marketing and paid checkout remain separate.

## Important current tech facts and limitations
- Backend previously reported 24 of 24 stored edition bytes passing SHA integrity audit; this includes 5 `Emir Meets Zachary` drafts still excluded editorially. Treat that as *storage integrity only*, NOT proof the visible original cover/translation is correct.
- Prior live QA reported `passed:true,languages:[en,de,pt-PT,tr,es,fr],editionsChecked:19,archivesChecked:6,freeGiftTwoStepPassed:true`. User subsequently found real UX and content errors. Automated test coverage is not enough; reproduce the actual browser path and inspect ZIP/PDF contents.
- Source branch `production-membership` has recent work for ZIP folders/numbering, Content-Length, private ZIP caching/prewarming, free gift two-step UI, German staged PDF fragments. Review all commits for quality; do not assume correct merely because tests pass.
- Frontend branch `main` still has `library.html` with a modal asking visitors to paste a private gift URL and a purchase link; owner has explicitly rejected that flow for free gifts. Remove or restructure it without exposing unentitled content. Avoid redesigning pages unnecessarily.
- `member/storybook-gift.html` and `gift.html` are large media-rich files and connector text extraction may return zero bytes; inspect them through a full Git clone, not empty connector excerpts.
- `member/storybook-gifts.mjs` currently protects `emir-meets-zachary` with `fileFor()` returning null and catalog filters. Never silently override editorial locks.
- User reports German listing/ZIP missing Emir books; server-side logs previously showed German publicly downloadable: three Zachary + two Emir, and Book Three Emir staged but not approved. Reproduce **the exact URL the customer used**, distinguish old locally saved ZIP from latest response, and avoid false success claims.
- Known previous bad outcome: assurances that everything was 'verified' despite missing cover and UX problems. Do not repeat. Deliver one complete, user-tested result, with precise evidence.
- GitHub and Render secrets exist in their respective secured settings; never log, paste, expose, hardcode, or request user to send secrets in chat.
- No payment checkout is required to access a valid free gift. Existing checkout should not be broken.
- Do not publish incomplete books merely because a translated PDF is stored.

## Completion evidence required
Provide a matrix of title, language, editorial approval status, book order, actual ZIP entry, file hash, original cover spot-check, and successful PDF opening. Confirm live Git commit and Render deployment for both frontend and backend and real responsive phone-size test; report measured first-byte response and ZIP download time. No estimate presented as a measured fact. If a title cannot be published without editorial approval, identify it explicitly rather than claiming full completion.

## Authority and scope
Owner explicitly requests that Claude Code become the primary website/backend engineer and troubleshoot autonomously. Design asset creation may be outsourced separately. Work in the existing repo and services and preserve the approved design identity. Verify any apparent ambiguity in publication approval instead of guessing.

## Verified status — 2026-11-17 (Claude Code session)
Backend `production-membership` @ 4615846 live on srv-dbrjl2h5efls73aq7ls0 (deploys are started via the Render API; auto-deploy did not fire on push).
- Root cause of the German defects: barber gift links (`/barber/open` → `/barber/redeem` → `/barber/books`) used an older release/bundle-only inventory: German had no Emir books and served the reduced 1.1 MB Book One. All gift, buyer and ZIP routes now share `languageEditions()` in `member/storybook-gifts.mjs`.
- Gift recipients (storybook free/paid, barber) get exactly Language → Download on the approved artwork; barber recipients may change language on each visit. No PIN, code, price or purchase prompt.
- `/barber/free-bundle.zip` (unauthenticated full-book ZIP) now 303s to the public library.
- ZIPs stream headers immediately; heavy audit + live QA run once per deployed commit (`aom_release_audits`).
- External iPhone-emulated test (2-hour QA links): gift page ~0.6–1.0 s, Download tap → ZIP start 0.3–0.5 s, 60,121,639-byte German ZIP complete in ~3 s (prepared cache, warm instance). Cold wake of the free instance measured ~13 s to first byte; prepared-ZIP warm-up after boot ~26–28 s (direct streaming covers that window).
- German ZIP: 01_Zachary_Series/01 (14,389,311 B, ec7acc22…, 41 pp), 02 (1,071,855 B, 9daeb243…, 29 pp), 03 (11,555,110 B, e67ea9a5…, 59 pp); 02_Emir_Series/01 (16,647,424 B, f502d23c…, 44 pp), 02 (16,456,839 B, 2a9f19c4…, 34 pp). All open; first pages show the German original covers.
- Emir Book Three (`emir-meets-zachary`): NO editorial approval record found anywhere; remains locked.
- 2026-11-17: Owner-approved Zachary Book One replacements with covers are live in all gift ZIPs: EN 15,080,055 B (sha256 f31050cd…, 56 pp), pt-PT 12,394,782 B (sha256 cf7b75b3…, 60 pp). Stored via the hash-locked `/api/storybook/approved-intake` (member/approved-intake.mjs). Subscriber release/bundle editions (aom_releases) were not changed.
- Render does not auto-deploy on push for either service; start deploys via the Render API with the commit id.
- 2026-11-17: Owner approved English Emir Books 1-3 (instruction "add these three books to the English gift page"). Live in the English ZIP (6 books): Emir 1 16,217,672 B b3b589b4…, Emir 2 15,745,828 B a9d71b15…, Emir 3 "Emir Meets Zachary" 16,747,082 B a35dcd79… (45 pp). Emir Book Three is released ONLY in English and only for that sha (`editorialReleases` in member/storybook-gifts.mjs); de/tr/es/fr drafts remain locked.
- 2026-11-17: Owner approved Spanish Emir Book Three ("Emir conoce a Zachary", 17,869,805 B, dac7f722…, 45 pp). Spanish section now has 3 books. Book Three released for en + es only. Owner convention: "<language> section" means that language's bundle on the gift page.
- 2026-11-17: Owner approved German Emir Book Three ("Emir trifft Zachary", 17,870,102 B, e2be47f8…, 45 pp). German section now has 6 books. German Emir Books 1-2 re-supplied by the owner are byte-identical to the live editions. Book Three released for en, es, de; still locked for tr and fr.
- 2026-11-17: Owner approved Turkish Emir Book Three ("Emir Zachary ile Tanışıyor", 17,870,796 B, 02ba124b…, 45 pp). Turkish section now has 3 books. Book Three released for en, es, de, tr; only fr remains locked.
