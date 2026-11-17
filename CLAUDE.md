# Claude Code — Authors On A Mission

**READ `CLAUDE_HANDOFF.md` FIRST.** This repository belongs to Authors On A Mission, the live publishing site https://www.theauthorsmission.de. The owner has transferred primary implementation responsibility to Claude Code.

- Static website: branch `main` on Render service `srv-dbqvnpifngtc73efh7m0`.
- Backend and secure books: branch `production-membership` on Render service `srv-dbrjl2h5efls73aq7ls0`.
- This same handoff file is present in both branches. Check out both branches to make changes in their respective deployed targets.
- Preserve existing books, original approved covers, artwork, user data, and working flows.
- Do not publish unapproved Emir Book Three drafts; investigate updated editorial approval.
- Fix the customer experience end-to-end: free gift **Language -> Download**, exact language selection, numbered books and series folders, full original German Zachary Book One cover, fast ready ZIPs, phone usability, accurate tests.
- Do not ask the owner to manually code, upload files, or change dashboard controls that a connected agent can handle.
- Never commit tokens, keys, full private customer files, or personal details into a public repository.
- Render will auto-deploy the branch configured for each service when its code changes.

The detailed incident report, tested inventory, relevant repo paths, and release gate are in `CLAUDE_HANDOFF.md`.
