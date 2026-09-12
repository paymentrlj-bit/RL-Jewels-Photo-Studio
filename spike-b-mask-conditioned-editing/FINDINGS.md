# Spike B — Interim Findings

**Headline: as currently scoped, Stage B1 does not look viable.** Three real
calls against the live Gemini API, across both prompting strategies and both
models the brief says to reuse, all produced the same failure mode: the
model doesn't perform a localized edit at all — it regenerates the entire
composition. This isn't a boundary/antialiasing nuance the guardrail's
"small tolerance" can absorb; it's a wholesale re-render every time.

This is an interim finding from 1 synthetic test case × 3 conditions, not
the full 15-real-photo test the brief specifies (see "What this doesn't
prove" below) — but it's consistent enough across every condition tried that
it's worth surfacing now rather than waiting to accumulate the full 15.

## What was tested

**1. API capability (no photos needed at all).** Read `@google/genai`'s own
types before writing any code. `generateContent`'s `ImageConfig` (exactly
what `enhanceImage()` in `server.ts` uses) has no mask field whatsoever —
only `aspectRatio`, `imageSize`, `personGeneration`, and a few output-format
options. The SDK's only real pixel-locked masking API is `editImage` +
`MaskReferenceImage`, and every example in the type definitions uses it with
`imagen-3.0-capability-001` — the Imagen family, not `gemini-3.1-flash-image`
or `nano-banana-pro-preview`, the models this app actually uses and that
Section 1 says to reuse rather than introduce a new unverified one.
**Conclusion: there is no native mask input available for the models this
brief specifies.** The only lever is the prompt text (and, as tested below,
an image shown alongside it) — exactly the "text-described region" case
Section 8 flagged as the worse of the two possibilities.

**2. Three real `generateContent` calls**, same synthetic test case (a plain
gold ring with a thin dark string crossing over the band — the
`foreignObjectCrossing` scenario from Section 3.2), same
`imageConfig: { aspectRatio: '1:1', imageSize: '1K' }` the app already uses:

| # | Model | Strategy | Outside-mask changed | Guardrail verdict |
|---|-------|----------|----------------------:|--------------------|
| 1 | `gemini-3.1-flash-image` (default) | Region described in text (normalized 0-1000 coords) | 17.9% | **REJECT** |
| 2 | `gemini-3.1-flash-image` (default) | Region shown as a second image (magenta mask overlay) | 3.9% | **REJECT** |
| 3 | `nano-banana-pro-preview` (escalated) | Region shown as a second image (magenta mask overlay) | 5.3% | **REJECT** |

(Guardrail threshold: >2% of outside-mask pixels changed by more than 18/255
on any channel — see `diff_outside_mask.py`, the real guardrail logic Stage
B1 would use, not spike-only code.)

All three numbers are far past the reject threshold, but the raw percentage
understates what actually happened — see the images in `findings/`:

- **#1 and #2** (`findings/01_*`, `findings/02_*`): the model removed the
  string, but also fully re-rendered the ring itself — added 3D shading, a
  glossy highlight, a drop shadow, and a background vignette where the
  original was a flat outlined circle on flat white. The diff heatmap shows
  a visible glow around the *entire* ring outline, not just near the
  intended crossing region.
- **#3** (`findings/03_*`): the escalated model did something arguably
  worse — it only removed the *part* of the string crossing the ring,
  leaving a large stray segment of the string still visible well outside
  the described region, while *also* fully re-rendering the ring in the
  same photorealistic 3D style as #1/#2. It failed at the core removal task
  **and** at region compliance simultaneously.

Every condition tried — different model, different prompting strategy —
converged on the same behavior: these are full-image generative models, and
an editing instruction (however phrased) reads to them as license to
regenerate the whole scene, not as a scoped edit request.

## What this doesn't prove yet

- **n=1 synthetic test case.** A flat, geometrically simple synthetic ring
  is not a real jewelry photo. It's possible — though nothing here suggests
  it — that real photos with real texture/lighting behave differently. The
  brief's actual ask (15 real tag-crossing photos, deliberately spanning
  plain-metal and detailed-area crossings) is still the real test; this is a
  fast, free, real-API-backed reason to expect it will confirm the same
  thing, not a substitute for it.
- **Prompt engineering space not exhausted.** Two strategies were tried
  (text coordinates, visual mask overlay). Neither is exotic, but more
  aggressive phrasing, few-shot examples, or a fundamentally different
  technique (e.g. sending a pre-composited image where the crossing region
  is already blanked out, and asking the model to "fill in only the blanked
  region") wasn't tried and might do better. Worth one more attempt before
  treating this as fully closed.
- **`editImage` + `MaskReferenceImage` (the Imagen path) was not tested at
  all** — it requires a different, unverified-for-this-account model ID,
  which Section 1 says not to introduce without checking it against the
  real `/v1beta/models` list first. If Stage B1 is worth salvaging, this is
  the next thing to check, not another `generateContent` prompt variant.

## Recommendation

Bring this to the team before building more of Stage B1 against the current
plan. The real options, roughly in order of effort:

1. **Try the pre-composited/blank-fill variant** (cheap, one more real-API
   test) — if it also fails, that's a strong signal the `generateContent`
   path is closed regardless of prompting technique.
2. **Investigate the Imagen `editImage` + `MaskReferenceImage` path for
   real** — genuine native masking exists there; the open question is
   whether it's available/verified for this account and whether introducing
   a second model family for just this one narrow stage is worth it.
3. **Reconsider Stage B1's scope.** If neither of the above pans out: most
   tags don't cross the piece at all (3.1.2 already removes those for
   free), so the actual affected volume may be small enough that routing
   every genuine crossing case straight to manual/human touch-up — no
   generative attempt at all — is simpler and more honest than a
   masked-inpaint mechanism that doesn't work as scoped.

## Reproducing / extending this

```bash
GEMINI_API_KEY=... node masked_inpaint.cjs --manifest sample_input/manifest.json --outdir output [--escalated] [--mask-overlay]
python3 diff_outside_mask.py --results output/inpaint_results.json --outdir output
```

`sample_input/manifest.json` accepts an array of cases, so this scales
directly to the real 15-photo test once real tag-crossing photos exist —
upload them in the chat and Claude can identify the crossing region for the
manifest the same way as Spike A (no manual pixel-hunting needed).
