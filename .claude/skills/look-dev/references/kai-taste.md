# Kai's taste, distilled from the meadow's reviews

Kai's notes from iterations 1–17, turned into rules that carry to any planet. The round each rule came from is in brackets. Memory meadow-aesthetic has the full history.

## The bar
- **Match the references when you squint** [2]. Composition, values and colour first; detail last.
- **A painted background that came alive**: soft, luminous, saturated but never garish, calm (the brief). Coherent painterly fields that move (shadows, sheen) beat static per-pixel variety.
- **Never alter the look for performance** [4]. Resolution doesn't count as the look: dropping it, even well below full, is fine, and a little upscaling blur is liked [12].

## Light and shadow
- 天光云影共徘徊: cloud shadows sweeping the land, light patches with brushed edges [1].
- Cloud shadows deep and cool, a little sharp [3]. They must not stutter: judge them from a few meters up with clouds drifting, not at eye level [5].
- Sharp per-blade shadows on grass are wanted [5].
- Shadows, the sun and everything lit are fixed to the planet, never to the view [4].
- One light first [2]. Time of day is aspirational.
- The grade: after iteration 5 it read washed out, so it got about 10 % more contrast and 5 % less brightness [5].

## Water
- Water mirrors the sky and the clouds [1].
- The dark edge of a pond is the reflection of its banks: never an outline, never a constant-width line. Banks are natural and three-dimensional [2]. Bank reflections are dark, lake-coloured navy bands [8]. Banks and hills reflect in front of the clouds' reflection [5].
- No stepped flicker on glints: animate smoothly [1]. Lakes must interlace with the land naturally, never as a noise overlay [1].
- Ponds without jagged teeth on their banks [9]. Reflections leave no gap at the waterline and show nothing hidden in front [8].

## Clouds and sky
- Clouds, their shadows and their reflections agree (one system); clouds sit low and plentiful [2].
- Up close: sculpted, not hazy. Defined lobes, crisp edges, clear light and shade, like painted cumulus [3].
- From above: longer streaks, larger patches, swirly and natural, not generic noise. The same goes for lakes [3].

## Plants
- Flowers come in patches with varied density, species, size and colour, as a parametric system. Even scatter reads as wrong [1]. They need real clumps with bare grass between [2], bunched tighter [3].
- The whole planet is in flower by default; an unbloomed far side reads as a bug [7].
- From far, a painterly stroke texture that follows the density map and hands over directly to the plant models, with no sparse-dot stage [5]. It should be softer than it was in iteration 6 [6]. Up close it needs no hard bed edges and no even fill [7].
- Petals blown by the wind are loved, wherever flowers are [5].

## Wind and motion
- Waves and ripples travel across the grass, catching the light [1]. The sheen has darker troughs and brighter crests moving with the sway, with bands no wider [4]. Sheen is 0.5 by default, and the sway matches the wind's strength [5].
- Birds fly like birds: faster, on purposeful paths, not like butterflies [4], and a little slower and lower than that [5]. Butterflies come in various colours, about 2–3 on screen when close [4].
- Wings beat slowly, with glides; fast flapping reads as flies [5].
- Small white flocks [3]. Birds' shadows are silhouettes, not dots, but not detailed either [9].

## Buildings
- Match the reference painting one to one when Kai asks (the meadow's cottage) [5]. Use the painting's proportions and brushwork, its painted shadows, and colours sampled from it. Compare side by side at its angles. No vines [4].
- Painted plaster with stone showing only near edges and corners, not individual bricks; slightly crooked lines [3]. A little moss on the roof and foundation [8].
- Detail is real geometry where it reads as depth: the pier's tunnel, windows set deep into the walls [6]. Nothing floats, nothing lifts off the ground or water on a small planet [6].
- On a tiny planet, buildings curve with it, walls perpendicular to the surface [8].

## Change of detail and frames
- No grow-in or shrink-out animation for level of detail: plants appear or vanish at full size [7, 8]. Motion draws the eye to the change.
- Grass never lags or pops in chunks: build what's in view first [6].
- No frame dropped or shown blank, and no missing strip of grass. Kai notices single frames and sends recordings [11].
- Check at DPR 1 too: MSAA on 1× screens showed specks no 2× check caught [14].

## Camera and navigation
- Zoom stops are heights in meters that never change as the planet grows (70.2 m and 4.3 m, from zooms 0.35 and 0.83 at R 128) [8]. Tilt toward the horizon early, so the bird's-eye sees far [8].
- Dragging sideways in Wander turns as if holding the scene; the forward glide is faster; W A S D walk, Q and E rise and descend [4].

## How Kai reviews (so check the same way first)
- Kai zooms in on edges, waterlines, roofs and seams. Don't claim a fix without a zoomed crop [8].
- Kai looks at the antipode: nothing tied to the cottage may leak to the far side [7].
- Kai watches performance per feature: 1.2 ms for bird shadows was "steep" [9]. Kai feels smoothness more than a budget number [6].
- Kai watches on the M1 Pro's 2× screen and on 1× external screens, often with `q=high` chosen.
