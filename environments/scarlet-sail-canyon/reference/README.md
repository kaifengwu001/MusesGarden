# Scarlet Sail Canyon reference pack

Start with the **concept art**, then compare it with the **actual app captures**. The captures document the implemented planet; they are not additional concept paintings.

## Art direction

- [Primary concept](primary-concept.png): the original rendering used for the canyon composition, material relationships and rock-backed shelter.
- [Expanded world setting](world-setting.png): supplementary world and habitat ideas.
- [Creature sheet](creatures.png): Chalkstep, Fern Sifter and Dewwing anatomy and ecology.

## Actual app screenshots

- [Settlement](checkpoint-settlement.png): the revised shelter, fans, terraces and open valley.
- [Shelter floor](checkpoint-floor.png): the steep review angle used to check the overlapping-surface defect.
- [Understory](checkpoint-understory.png): small native plants and Fern Sifter at close range.
- [Whole planet](checkpoint-planet.png): the full globe, captured during the live settlement recording.

## Screen recordings

These are real browser captures at 1280×800 and high quality, with live time. They have no narration or sound. Loading frames are trimmed; the app's camera transitions and motion remain in the recording.

- [Settlement tour](settlement-tour.mp4): Shelter → Three Sails → Whole planet.
- [Native life](native-life.mp4): Chalkstep → Fern Sifter → Dewwing → local neighbour Pip.
- [Capture metadata](recordings.json): source revision, viewport, capture date, durations and chapter times.

To regenerate, start the canyon server, install `ffmpeg` on the host if needed, then run from the repository root:

```sh
npx tsx scripts/record-scarlet.ts
```

Set `SCARLET_URL=http://localhost:<port>` to capture another checkout. Raw WebM files go to ignored `test-results/scarlet-recordings/`; selected MP4s and the globe screenshot are saved here. The script fails on runtime or shader errors. Review the videos visually before committing them.

## Documentation to hand off

1. [Experience handoff](../../../docs/planet-reference-handoff.md): failures, root causes, fixes, reference comparison workflow and remaining limits.
2. [Environment pipeline](../../../docs/environment-pipeline.md): generation and rendering from start to finish; its original new-world section predates the environment folders.
3. [Environment rules](../../README.md): isolation, scaffolding, tests and builds.
4. [Open and run this planet](../README.md): controls, commands and local/backend boundaries.
5. [Construction notes](../CONSTRUCTION.md): file map, terrain, support, ecology and navigation contracts.
6. [Validation](../VALIDATION.md): verified results and the limits of those checks.
7. [Rendering measurements](render-benchmark.json): before/after scenery indexing data, not a frame-rate guarantee.

The saved concepts are design targets, not proof that every detail has been implemented. In particular, local neighbours are not account-backed friends, and decorative cliffs are not a complete climbing/collision system.
