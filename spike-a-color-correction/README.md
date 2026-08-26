# Spike A — Color Correction

Implements and compares candidates 1 and 2 from `PIPELINE_REBUILD_BRIEF.md`
Section 3.1.3, per the blocking "Spike A" requirement in Section 6: test
before committing to an algorithm, don't default to gray-world/retinex
without this test (both are flagged in the brief as likely *wrong* here, not
just imprecise — gray-world would actively desaturate a scene that's
overwhelmingly one warm gold color by construction).

**Status: tooling built and smoke-tested, blocked on real photos.** This
cannot run for real without an actual grey/white reference card physically
photographed under the store's real lighting — that's the one thing this
session has no way to produce. See "What's needed to actually run this"
below.

## What's implemented

- **Candidate 1** — per-photo reference card: sample a real grey/white card
  photographed in the same shot, compute per-channel gains that bring it to
  true neutral, apply those gains to the jewelry region only.
- **Candidate 2** — fixed calibrated profile: average the gains from several
  dedicated reference-card-only shots into one fixed profile, then apply
  that same profile to every future photo without needing a card in every
  shot. The key question this answers: does a fixed profile still hold up
  across photos taken at different times, or does real lighting drift enough
  that it doesn't?
- **Candidate 3** (a narrow model predicting correction parameters) is
  intentionally NOT implemented — the brief says to only build it "if
  neither of the above holds up under real testing."

All gain math happens in **linear light**, not directly on gamma-encoded
pixel values — multiplying a gain on raw sRGB values shifts hue, not just
brightness, which is not a footnote: it's exactly the kind of failure this
whole spike exists to catch before it reaches a real photo. Caught and fixed
via this module's own smoke test (a synthetic warm-cast gold ring corrected
in gamma space came out visibly olive/green instead of gold).

## What "ground truth" means here

The brief says to compare against "physical-reference ground truth." Two
things this tooling actually measures:

1. **Card neutrality error** (hard, verifiable, no assumptions) — after
   correction, does a known-neutral surface actually read as neutral? This
   is the real number to watch for candidate 2 specifically: low and
   consistent across cases means the fixed profile generalizes; high or
   inconsistent means real lighting drifts enough that candidate 2 doesn't
   hold up on its own.
2. **Approx. purity-color distance** (soft, informational only) — how close
   the corrected jewelry region lands to a rough published reference color
   per purity. These reference values are photography-convention
   approximations, not a spectrophotometer measurement, and are labeled as
   such in `correction.py`. Do not treat this number as authoritative.

Neither of these substitutes for the real ground truth the brief is actually
asking for: **a human holding the corrected image up against the real
physical piece and judging whether the color genuinely matches.** That's why
`run_spike.py` also produces a `side_by_side.jpg` per case — the visual
output is the primary deliverable, the numbers are a sanity check on top.

## What's needed to actually run this for real

1. A grey or white reference card (any photography/print shop card, or even
   a plain white index card, works for this).
2. **2-3 calibration shots**: the card alone, filling most of the frame,
   under the store's typical counter lighting, at the usual station.
3. **5-10 real jewelry photos**, each with the same card visible somewhere
   in-frame alongside the piece (corner of the shot is fine) — deliberately
   spanning easy cases (plain rings) and the hard cases called out in the
   brief (thin chain, bead necklace, a piece with visible motifs/engraving).
4. Upload the photos in the chat. **You do not need to find pixel
   coordinates yourself** — Claude can look at each photo and fill in
   `manifest.json`'s `card_box`/`jewelry_box` directly.

## Running it

```bash
python3 run_spike.py --manifest <dir>/manifest.json --outdir output
```

Produces, per test case, in `output/<label>/`:
- `0_original.jpg`, `1_candidate1_reference_card.jpg`,
  `2_candidate2_calibrated_profile.jpg`
- `side_by_side.jpg` — the actual thing to look at
- `report.json` (repo root of `output/`) — all gains/metrics, machine-readable

`sample_input/` is a synthetic smoke test (a flat gray card + a plain gold
ellipse under a deliberately injected color cast) — it proves the code runs
and that the drift-detection metric correctly distinguishes similar vs.
different lighting, **not** a real spike result. Its own cast-injection
applies the simulated color cast in gamma space (the "wrong" way, for
simplicity of generating test data), so it isn't a perfect round-trip check
either — real accuracy can only be validated against real photos.

## Deciding the winner

Per the brief: "Pick the simplest one that holds up." Candidate 1 always
works (each photo carries its own reference) but requires a card in every
shot — a real staff workflow change worth naming explicitly if it's the
answer. Candidate 2 is invisible to staff after the one-time calibration,
but only wins if the card-neutrality-error stays low across a real batch of
photos taken over time, not just back-to-back in one sitting.
