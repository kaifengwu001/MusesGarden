# The Muse cast

Each SOUL.md is a starting disposition: a desire, a contradiction, a way of noticing, small rituals, and examples of voice. Every Muse can be capable, kind, and honest while having different tastes.

| Muse | Look | Character | MBTI inspiration | What distinguishes their attention | Home planet |
| --- | --- | --- | --- | --- | --- |
| Momo (`hero`) | the original Muse | The soup-making gardener | INFP-ish | The overlooked detail in a flowerbed or a pot of soup; free wandering, jazz, and the stars | The Meadow |
| Kiki | muse5, a loaf in its apron | The baker | ISTP-ish | Timing, practical evidence, a tidy kitchen, and one careful experiment over a strong coffee | Golden Rye |
| Hoji | muse6 | The tea maker | ISFJ-ish | Familiar forms with one small, revealing variation: a whisked bowl, a carved joint, a fold | Cherry Blossom Waterways |
| Fife | muse1, a flute in its pocket | The flute player | ENFP-ish | Tunes worth gathering around, and how a good chair or a good harvest is made | Sequoia Shrine |
| Moss | muse8, dressed in the dunes' plants | The kite-flying wanderer | ENTP-ish | Wind, edges and maps, and evidence that improves an adventurous guess | Violet Dunes |
| Van | muse7 | The painter | ISTJ-ish | Materials, exact distinctions, and the colour that can't quite be named | Tulipwind Meadows |
| Potato | muse2 | The sci-fi film buff | ENTP-ish | Where a film's future meets the real technology behind it | Scarlet Sail Canyon |
| Pina | muse12 | The sculptor-botanist | INTJ-ish | The hidden structure in mushrooms, branches and roofs, and the birds that live in them | Ukiyo-e Pine Hamlet |
| Dorie | muse0, a satchel on a strap | The travelling physicist | INTP-ish | How light, wind and motion really behave, photographed when the explanation shows | Cobalt Windfields |
| Nemo | muse3 | The terrace farmer | ISFJ-ish | How fields, houses and rooms are laid out so that people can live well in them | Rice Terraces |
| Pooh | muse11 | The dreamer | INFP-ish | Dreams, stories of magic schools, and why people feel the way they do | Lantern Reed Gardens |

Kai chose this cast on the cast sheet of 2026-11-02, Muse first: each Muse's look, then who it is, then its interests, and its home planet last. The ids are the names in lower case, except the hero's. Kai chose the names, including the ones that echo famous characters; their souls are original and borrow nothing from those works.

## Runtime and memory

The parser reads `name`, `curiosity`, `focus`, `sociability`, `whimsy`, and `novelty` from flat frontmatter. These five custom traits drive the existing life policy. MBTI appears in prose as character inspiration; it has no separate runtime mapping or compatibility score. The initial temperament values are Kai's, from the cast sheet; changing them re-tunes the simulation, so rerun `npm run sim` after an edit.

The LLM mind receives the soul's prose when judging finds and reflecting. The heuristic mind uses its deterministic rules and does not perform all these voice examples. Example captions illustrate range; they should not repeat on a schedule.

Fresh gardens and simulations load these fixtures. An existing saved garden keeps its stored soul until a host soul update; editing a fixture does not overwrite that history.

MEMORY.md holds owner context. The supporting cast's files describe explicitly fictional demo owners. Momo's file distinguishes demo interest seeds from confirmed collaboration decisions. Keep real private owner facts out of this directory. The `Interests` bullets remain simple corpus topic labels so both extraction paths can seed the demo. Each must also pass the privacy filter (`server/domain/privacy.ts`), which drops a label that names a person ("Harry Potter"), has a capital after its first word ("Dutch Golden Age painting"), or shares every word with a flagged line in the same file ("Takes one photograph a day" drops "Photography", since *takes* is on its health list). `cast.test.ts` checks both.

Muse's own discoveries, gifts, encounters, and reflections live in the garden event history. Do not manufacture past experiences or put private owner details into a soul. The generated "What I've been into" section remains evidence-backed and garden-owned. Initial type descriptions can stay flexible while interests change through experience.

## Scenes for a voice review

Try the same situation with each Muse and hide their names:

1. Find an unfamiliar object beside something they already know well. What earns a closer look?
2. A favorite explanation turns out to be wrong. What do they keep from the experience?
3. Choose a gift using only a friend's expressed public interests. Why that gift?
4. A quiet visitor disagrees about the value of a find. How do they respond?
5. Work interrupts a promising expedition. Finish the task, then decide what question to return to.
6. Revisit an old favorite after several new experiences. What has changed, and what evidence supports it?

These are prompts for a future behavioral review, not claims that a live voice evaluation has already run. Look for distinct attention and decisions as well as recognizable language.
