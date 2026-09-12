#!/usr/bin/env python3
"""
Outside-mask diff guardrail (PIPELINE_REBUILD_BRIEF.md Section 3.2 Stage B1):
diff the masked-inpaint result against the pre-inpaint original, restricted
to everything OUTSIDE the crossing region, with a small tolerance for
anti-aliasing at the boundary. Any change beyond tolerance outside the mask
-> reject the attempt.

This is not spike-only throwaway logic - it's the real guardrail Stage B1
needs regardless of what Spike B concludes, written once here so Phase 3 can
reuse the same tested logic rather than re-deriving it.

Usage:
    python3 diff_outside_mask.py --results output/inpaint_results.json --outdir output
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw

# A pixel outside the mask is "changed" if any channel moved more than this
# (0-255 scale) - absorbs JPEG re-encoding and minor resampling noise without
# absorbing a real edit. A REJECT is when the fraction of outside-mask pixels
# exceeding this tolerance is itself above REJECT_FRACTION_THRESHOLD.
PER_PIXEL_TOLERANCE = 18
REJECT_FRACTION_THRESHOLD = 0.02  # >2% of outside-mask pixels visibly changed


def box_0_1000_to_pixels(box_0_1000: list[int], width: int, height: int) -> tuple[int, int, int, int]:
    ymin, xmin, ymax, xmax = box_0_1000
    x1 = int(xmin / 1000 * width)
    y1 = int(ymin / 1000 * height)
    x2 = int(xmax / 1000 * width)
    y2 = int(ymax / 1000 * height)
    return x1, y1, x2, y2


def diff_outside_mask(original_path: Path, edited_path: Path, box_0_1000: list[int]) -> dict:
    original = Image.open(original_path).convert("RGB")
    edited = Image.open(edited_path).convert("RGB")

    # The model's output resolution/aspect can differ from the input (it's a
    # generative call, not a crop) - resize to the original's dimensions so
    # the diff is pixel-comparable. This itself is worth watching: a model
    # that returns a meaningfully different composition/crop even when told
    # "don't re-crop" is a real finding, not just a resizing inconvenience.
    if edited.size != original.size:
        edited = edited.resize(original.size)

    w, h = original.size
    x1, y1, x2, y2 = box_0_1000_to_pixels(box_0_1000, w, h)

    orig_arr = np.asarray(original, dtype=np.int16)
    edit_arr = np.asarray(edited, dtype=np.int16)
    diff = np.abs(orig_arr - edit_arr).max(axis=2)  # max channel diff per pixel, 0-255

    mask = np.zeros((h, w), dtype=bool)
    mask[y1:y2, x1:x2] = True
    outside = ~mask

    outside_diff = diff[outside]
    changed_outside = outside_diff > PER_PIXEL_TOLERANCE
    changed_fraction = float(changed_outside.mean()) if changed_outside.size else 0.0
    reject = changed_fraction > REJECT_FRACTION_THRESHOLD

    # Visual diff heatmap for human review - red where the model changed
    # pixels it was told not to touch.
    heat = Image.new("RGB", (w, h))
    heat_arr = np.zeros((h, w, 3), dtype=np.uint8)
    heat_arr[..., 0] = np.clip(diff, 0, 255)
    heat_arr[mask] = [0, 100, 255]  # mark the intended edit region in blue for reference
    heat = Image.fromarray(heat_arr)
    draw = ImageDraw.Draw(heat)
    draw.rectangle((x1, y1, x2, y2), outline=(0, 255, 0), width=3)

    return {
        "box_pixels": [x1, y1, x2, y2],
        "outside_mask_changed_fraction": changed_fraction,
        "outside_mask_max_diff_p99": float(np.percentile(outside_diff, 99)) if outside_diff.size else 0.0,
        "reject": reject,
        "heatmap": heat,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", default="output/inpaint_results.json")
    parser.add_argument("--outdir", default="output")
    args = parser.parse_args()

    results = json.loads(Path(args.results).read_text())
    outdir = Path(args.outdir)

    report = []
    n_reject = 0
    n_total = 0
    for r in results:
        if r.get("error"):
            print(f"{r['file']}: SKIPPED (call failed: {r['error']})")
            continue
        n_total += 1
        d = diff_outside_mask(Path(r["original_path"]), Path(r["edited_path"]), r["crossing_box_0_1000"])
        heatmap_path = outdir / f"{r['label']}_diff_heatmap.png"
        d["heatmap"].save(heatmap_path)
        entry = {
            "label": r["label"],
            "model": r.get("model"),
            "outside_mask_changed_fraction": d["outside_mask_changed_fraction"],
            "outside_mask_max_diff_p99": d["outside_mask_max_diff_p99"],
            "reject": d["reject"],
            "heatmap_path": str(heatmap_path),
        }
        report.append(entry)
        if d["reject"]:
            n_reject += 1
        print(f"{r['label']}: outside-mask changed={d['outside_mask_changed_fraction']*100:.2f}% "
              f"p99_diff={d['outside_mask_max_diff_p99']:.0f} -> {'REJECT' if d['reject'] else 'accept'}")

    rejection_rate = n_reject / n_total if n_total else None
    summary = {
        "n_total": n_total,
        "n_rejected": n_reject,
        "rejection_rate": rejection_rate,
        "per_pixel_tolerance": PER_PIXEL_TOLERANCE,
        "reject_fraction_threshold": REJECT_FRACTION_THRESHOLD,
        "cases": report,
    }
    (outdir / "guardrail_report.json").write_text(json.dumps(summary, indent=2))
    print(f"\nRejection rate: {n_reject}/{n_total}"
          + (f" ({rejection_rate*100:.0f}%)" if rejection_rate is not None else ""))
    print("Per Section 6 Spike B: a low rate here (native masking would give near-zero) "
          "vs a materially higher one tells you whether the guardrail is a backstop or "
          "the primary safety mechanism.")


if __name__ == "__main__":
    main()
