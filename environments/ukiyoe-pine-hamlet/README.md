# Muse’s Ukiyo-e Hamlet

A separate, interactive planet built around the approved snowy and rainy Muse
references: timber homes, pines and cedars, slate banks, a low arched bridge and
two local neighbours. Snow and rain are two presentations of the same place.

## Open and check

Run these commands from this checkout’s root:

```sh
npm run dev:ukiyoe
```

Open [the hamlet](http://localhost:5237/environments/ukiyoe-pine-hamlet/).
The server uses port **5237** with `--strictPort` so another planet’s server is
not silently reused. The toolbar offers Snow, Rain, Home, Bridge, Whole planet
and Muse views. Select Sumi or Mugi to follow, greet or rename that neighbour;
their names are remembered locally. Muse also retains the existing petting,
garden and planet-growth interactions.

```sh
npm run check:ukiyoe
npx vitest run environments/ukiyoe-pine-hamlet --maxWorkers=2 --testTimeout=60000
MEADOW_PORT=5237 npx playwright test --project=ukiyoe-pine-hamlet:ecology
MEADOW_PORT=5237 npx playwright test --project=ukiyoe-pine-hamlet:residents
MEADOW_PORT=5237 npx playwright test --project=ukiyoe-pine-hamlet:invariants
npm run build:ukiyoe
```

The production build goes to `dist-environments/ukiyoe-pine-hamlet/`. These are
commands, not a claim that every suite passes; see [VALIDATION.md](VALIDATION.md)
for the current evidence and remaining issues.

## Isolation and provenance

- Standalone checkout: `ukiyoe-pine-hamlet-standalone-01a19573`.
- Branch: `planet/ukiyoe-pine-hamlet`.
- Scaffolded from the clean committed checkout at **5374842**; the shared meadow
  engine in that checkout comes from **fb21a13**. It did not copy the other
  planet’s uncommitted implementation work.
- All world-specific code and assets live in this folder. Shared `src/` is
  imported without modification. If a shared file must change for this world,
  copy it here and repoint the local import, as required by the
  [environment rules](../README.md).
- Garden storage uses `muses-garden.ukiyoe-pine-hamlet.garden.v1`; neighbour names
  use `muses-garden.ukiyoe-pine-hamlet.residents.v1`.
- The development cache stays in this checkout’s `.vite-cache`; the world build
  uses `.vite-ukiyoe-build-cache`. Build output is separate from the meadow and canyon.

Sumi and Mugi are local saved inhabitants with deterministic routines. They are
not live account-backed friends; presence, messaging and moving real friend
agents between planets require separate backend integration.

## Continue development

Read [CONSTRUCTION.md](CONSTRUCTION.md), open the actual images in the
[reference pack](reference/README.md), and consult [VALIDATION.md](VALIDATION.md).
Before refinement, read the current upstream handoff at
`../scarlet-canyon-standalone-01a19427/docs/planet-reference-handoff.md` relative
to this checkout’s root. A snapshot is preserved in the reference pack, but the
upstream file is actively maintained.

This is a stylised 3D interpretation of the reference. Automated checks establish
functional and geometric properties; they do not establish visual fidelity or
user acceptance. Keep reference comparisons and unresolved gaps in the evidence
record rather than treating a successful build as completion of the art brief.
