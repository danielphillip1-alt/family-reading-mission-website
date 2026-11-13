# RENDER — RESUME HERE (PAUSED)
**Project:** Authors On A Mission — membership and automatic PDF book delivery
**Checkpoint saved:** November 13, 2026
**Status:** PAUSED AT USER'S REQUEST. No manual action required until user is back at their computer.
**Exact phrase to resume:** "RESUME RENDER CONNECTION"

## Where we stopped
The user approved month-to-month payment for a production PostgreSQL database. The assistant successfully created the paid Render database and verified that its status was **available**. The new paid database has NOT been connected to the existing membership web service yet. The user was on a phone and asked to pause the manual connection process until back at a computer, to work ONE STEP AT A TIME.

## Identifiers and links (non-secret)
- Render workspace: **My Workspace**, ID `tea-dbq54c0ae00c73dbl92g`
- Paid database: **aom-members-production**, ID `dpg-dbreshec6qcc73dmvf8g-a`, plan `basic_256mb`, PostgreSQL 16, 1 GB, Frankfurt, status last checked **available**
- Database dashboard: https://dashboard.render.com/d/dpg-dbreshec6qcc73dmvf8g-a
- Existing membership sandbox service: **authors-on-a-mission-members-sandbox**, ID `srv-dbrc7ctbedkc73d6ba7g`
- Membership service dashboard: https://dashboard.render.com/web/srv-dbrc7ctbedkc73d6ba7g
- Sandbox health endpoint: https://authors-on-a-mission-members-sandbox.onrender.com/health
- Public website: https://www.theauthorsmission.de
- GitHub repo: https://github.com/danielphillip1-alt/family-reading-mission-website
- Subscriber development branch: `feature/member-delivery-sandbox`; public site is not connected to that branch.
- Existing temporary database: `aom-sandbox-members`, ID `dpg-dbrc6gt9fdbs73dut8ig-a`, free, expiration December 13, 2026. **Do not delete before checking whether test members/data need migration.**

## Next action when user says RESUME RENDER CONNECTION
1. Have user open the paid database dashboard at the link above on their computer.
2. Guide **one step at a time**. On database page, choose **Connect** and copy **Internal Database URL**. **Never paste secret URL/password into ChatGPT.**
3. Guide to membership service dashboard → **Environment** → existing `DATABASE_URL` → update VALUE using the Internal Database URL from user's clipboard → save and deploy. Do not replace all environment variables or alter other values.
4. Verify Render deploy status and backend database functionality **independently**. Note that a GET to `/health` returning `ok` only proves that the HTTP server runs; it does NOT verify the database connectivity.
5. Before treating service as production, inspect whether the service remains on `stripe-sandbox-membership` with test-only Stripe credentials. Do NOT switch it to live Stripe automatically. Existing subscriber automation code on separate development branch is NOT deployed and is NOT yet end-to-end verified.
6. Once connected, continue tests for verified Stripe webhooks, language selection (English/German/European Portuguese), approved PDFs in private storage, subscription entitlements, email sending, scheduling and cancellation. Do not advertise subscriber readiness until actual end-to-end proof.

## User communication preferences
- User is working from one device sometimes and cannot repeatedly toggle between Render and ChatGPT to provide screenshots. When on a computer, user wants ONE SMALL STEP AT A TIME, with explicit click targets and no assumptions.
- No repeated steps or asking information already known. No more paid services without authorization; monthly, not yearly.
- Do not request screenshots that contain database secrets.
- Keep explanations short, clear, precise.
