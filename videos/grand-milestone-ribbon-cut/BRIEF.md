---
workflow: general-video
flow: automation
storyboard: no
message: "Grand Milestone — the floral stand that makes a grand opening an event"
destination: instagram-reels-stories
aspect: 1080x1920
language: en
length: 10s
angle: ribbon-cut reveal
---

## Intent

A 10-second cinematic product intro for The Lily Bar's "Grand Milestone" grand-opening floral stand. Chosen pitch: **The Ribbon Cut** — the stand stars in its own opening ceremony. Dark frame, a single band of pink satin (the same satin as the stand's wrap) stretched across it; gold scissors snip it, the halves fall away, and the stand is revealed in warm golden light. "Grand Milestone" settles in an elegant serif with a soft light sweep, then the brand. Must work silently in a feed and land its idea in the first second.

Product copy (user-supplied): "Celebrate a grand opening with an elegant floral stand, designed to make a lasting impression and mark a successful new beginning. Main Flowers: Premium Lily, Gerbera, Carnation, Yellow Peacock, and Fillers. Come with a Free Message Card."

## Assets

- assets/grand-milestone-stand.webp — the user's product photo (1080x1080, pink gerberas + lilies, pink satin wrap, golden-hour light); the hero of the reveal.
- Product page (unreachable from this environment): https://www.thelilybar.co/product/grand-milestone

## Customizations

- Music design (added on request): original score synthesized by `audio-src/score.py` — hushed B-minor build with celesta motif, silence before the snip, D-major bloom + bell cascade at the cut, harp arpeggio under the copy (Gmaj7/D → Em9/D → Asus4–A), bell sting resolving to D on the brand. Re-generate with `python3 audio-src/score.py <dir>` then `loudnorm I=-16 TP=-1.5`.
- Sound design: synthesized scissors snip (assets/audio/snip.wav) + bundled Pixabay-licensed SFX (whoosh ×2, riser into the cut, bass impact, sparkle burst). Final mix ≈ -15.8 LUFS, peak -1.4 dBFS.
- Film grain + warm light bloom/sweep at the reveal (techniques from registry grain-overlay, iris-reveal, light-sweep-pass).

## Notes

- Instagram Reels/Stories safe zones: keep text out of the top ~250px and bottom ~420px.
- Site capture not possible (domain unreachable here) — built from the supplied photo and copy; no invented claims beyond them.
