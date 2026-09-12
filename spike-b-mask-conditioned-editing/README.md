# Spike B — Mask-Conditioned Editing

Tests whether `MODEL_ENHANCE_DEFAULT`/`MODEL_ENHANCE_ESCALATED` support true
pixel-locked masking versus only a text-described region, per the blocking
"Spike B" requirement in `PIPELINE_REBUILD_BRIEF.md` Section 6, before Stage
B1 (Section 3.2, tag/thread crossing removal) is built around it.

**Status: real findings already in hand — see `FINDINGS.md`.** Unlike Spike
A (which needs real jewelry + a physical reference card this session cannot
produce), Spike B's core question is about model/API behavior, which is
genuinely testable against the real Gemini API without real store photos.
Three live calls run so far all point the same way: **as scoped, this
doesn't look viable.** Read `FINDINGS.md` for the full picture, including
what would still strengthen or overturn that conclusion.

## What's implemented

- `masked_inpaint.cjs` — calls the real Gemini API (`@google/genai`, same
  package/call-shape `server.ts` uses) with the intended Stage B1 mechanism:
  a masked-inpaint instruction against `MODEL_ENHANCE_DEFAULT` or
  `MODEL_ENHANCE_ESCALATED` (`--escalated`). Two prompting strategies:
  the region described in text (normalized 0-1000 coordinates, matching
  this app's existing segmentation-prompt convention), or `--mask-overlay`
  to instead show the region as a second image (a magenta rectangle on
  black) alongside the original.
- `diff_outside_mask.py` — the actual outside-mask diff guardrail from
  Section 3.2, not spike-only logic: diffs the edited result against the
  original outside the described region, with a small per-pixel tolerance
  for anti-aliasing, and produces a visual heatmap plus a reject/accept
  verdict. Phase 3 can reuse this as-is.
- `make_mask_overlay.py` — builds the visual mask image for the
  `--mask-overlay` strategy.

## Running it

```bash
GEMINI_API_KEY=... node masked_inpaint.cjs --manifest sample_input/manifest.json --outdir output [--escalated] [--mask-overlay]
python3 diff_outside_mask.py --results output/inpaint_results.json --outdir output
```

`manifest.json` accepts a single case or an array:
```json
{ "file": "case.jpg", "itemType": "ring", "purity": "22kt", "crossing_box_0_1000": [ymin, xmin, ymax, xmax] }
```

As with Spike A, you don't need to find crossing-region coordinates
yourself — upload real tag-crossing photos in the chat and Claude can
identify the region and fill in the manifest directly.

## Why the sample input is still meaningful here (unlike Spike A's)

Spike A's synthetic images can't say anything real about color under actual
store lighting — that's real-world physics no synthetic image can
approximate. Spike B is different: the question is whether *the model*
performs localized edits, which is a property of the model itself. A
constructed test image sent to the *real* API is a genuine test of that
question, even though the jewelry in it is drawn rather than photographed.
That's why `FINDINGS.md` treats these results as real (if not yet
exhaustive) evidence rather than a pure code smoke test.

## Files

- `sample_input/` — the test case (`ring_with_tag_string.jpg`, a plain gold
  ring with a string crossing the band) + `manifest.json`.
- `findings/` — the three real API results, their diff heatmaps, and the
  combined guardrail report, committed as durable evidence (not
  regeneratable-output clutter — `output/` itself is gitignored).
- `FINDINGS.md` — full write-up: what was tested, what it means, what's
  still unproven, and the recommended next steps.
