---
name: publish-page
description: Publish Muse's Garden to its public Vercel pages (a page per iteration, muses-garden-iteration-N, plus the latest at the-meadow-omega.vercel.app), always by commit. Check the live bundle parses and is the commit you meant, record the page in PROGRESS.md's Versions table, and push main when Kai asks. Use when Kai says publish, deploy, "update vercel", "create a vercel page for this version", "push into iteration N", "make a page so the team can see it", or at the end of an iteration.
---

# Publishing a page

Each iteration has its own public page, kept for comparison, and one address always shows the latest. Kai and the team open these, often on phones.

## When

- **At the end of an iteration.** A page per iteration has been part of it since iteration 5 (review-iteration).
- **When Kai asks.** "Push and update vercel", "create a vercel page for this version too".
- **Not on your own between iterations.** Asked whether to update the page every iteration, Kai first answered "Only when I ask". A fix between iterations goes to the latest only on request.

## How

```bash
scripts/publish.sh 18 <sha> --latest     # commit <sha> as iteration 18 and as the latest
scripts/publish.sh latest                # the checkout as the latest alone (a fix between iterations)
scripts/publish.sh 4 67a2742             # an older commit as its own page
```

- **Always pass the commit** when other sessions work in the folder; they usually do. Without one, the script builds the checkout itself, uncommitted work included: on 2026-10-31, Muse's unfinished files went out that way.
- **What it does with a commit:** builds it in a temporary worktree, strips the source maps, links or creates the Vercel project, and deploys to production.
- **What it needs:** the Vercel CLI, logged in to the scope that owns the projects (`kaifengwu001s-projects`). It prints each page's address.
- **Projects.** `muses-garden-iteration-N` from iteration 6 on; 4 and 5 are `garden-of-muse-iteration-N`, from before the rename. The latest is project `the-meadow` at https://the-meadow-omega.vercel.app. Iteration 16 was built in the lab and has no page.
- **Pushing to GitHub deploys nothing.** The Vercel projects have no Git link; pages change only through publish.sh.

## Then verify (every page you published)

```bash
node tools/workflows/publish-page/scripts/verify-page.mjs https://muses-garden-iteration-18.vercel.app <sha>
node tools/workflows/publish-page/scripts/verify-page.mjs https://the-meadow-omega.vercel.app <sha>
```

It checks four things:

1. The live index.html names a bundle.
2. Each bundle parses (`node --check`).
3. A headless load gets the harness ready with no page errors.
4. A clean build of the commit names the same bundle.

The parse check exists because of iteration 17's first publish. The old source-map strip cut into a string inside Muse's inline worker and broke the whole bundle, on both the iteration's page and the latest; a blank page for everyone. It was fixed in b9ef82b: only each file's own last line is stripped now. If you change publish.sh, verify twice.

## Record it

1. **PROGRESS.md's Versions table:** a row `| N | https://muses-garden-iteration-N.vercel.app | <sha> |`, newest first. Update the line naming which iteration the latest shows. Commit it as "Iteration N published: versions table".
2. **Memory meadow-vercel:** add the iteration, its commit and its bundle name.
3. **Push.** Kai asks for pushes ("commit and push", "Push"). Then `git push origin main`, after checking `git status -sb` shows only what you expect. Never push another session's branch. If Kai hasn't asked, offer it in your report.

## Report

Lead with the links, so Kai can open them from a phone: the iteration's page and the latest. Then say what is on them (the commit and what changed) and that both were verified.
