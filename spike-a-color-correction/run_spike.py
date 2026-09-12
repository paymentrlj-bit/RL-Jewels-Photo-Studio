#!/usr/bin/env python3
"""
Spike A runner (PIPELINE_REBUILD_BRIEF.md Section 6, "Spike A - color
correction"). Drives candidates 1 and 2 from Section 3.1.3 against a set of
real photos described in manifest.json, and produces a report + visual
outputs for human judgment.

Usage:
    python3 run_spike.py --manifest manifest.json --outdir output

manifest.json shape:
{
  "device": "realme NARZO 90x 5G",
  "calibration_cards": [
    {"file": "calib_01.jpg", "card_box": [x1, y1, x2, y2]}
  ],
  "test_cases": [
    {
      "file": "case_01.jpg",
      "label": "ring-plain-01",
      "purity": "22kt",
      "card_box": [x1, y1, x2, y2],
      "jewelry_box": [x1, y1, x2, y2]
    }
  ]
}

All coordinates are pixel (x1,y1,x2,y2) boxes in the ORIGINAL photo. You do
not need to find these yourself - once real photos exist, upload them in the
chat and Claude can look at each one and fill in the boxes directly (it's a
vision model - no manual pixel-hunting needed).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from correction import (
    APPROX_PURITY_RGB,
    apply_gains,
    build_calibration_profile,
    compute_gains_from_reference,
    linear_mean_to_srgb,
    load_rgb_array,
    neutrality_error,
    rgb_distance,
    sample_region_mean,
    save_rgb_array,
)


def make_side_by_side(paths: list[Path], out_path: Path) -> None:
    imgs = [Image.open(p).convert("RGB") for p in paths]
    h = max(im.height for im in imgs)
    imgs = [im.resize((int(im.width * h / im.height), h)) for im in imgs]
    total_w = sum(im.width for im in imgs) + 10 * (len(imgs) - 1)
    canvas = Image.new("RGB", (total_w, h), (255, 255, 255))
    x = 0
    for im in imgs:
        canvas.paste(im, (x, 0))
        x += im.width + 10
    canvas.save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="manifest.json")
    parser.add_argument("--outdir", default="output")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    input_dir = manifest_path.parent
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(manifest_path.read_text())
    device = manifest.get("device", "unknown device")

    # --- Candidate 2's calibration step: build one fixed profile from the
    # dedicated reference-card-only shots. ---
    card_means = []
    for card in manifest.get("calibration_cards", []):
        arr = load_rgb_array(input_dir / card["file"])
        card_means.append(sample_region_mean(arr, tuple(card["card_box"])))
    profile = None
    if card_means:
        profile = build_calibration_profile(card_means, device=device)
        (outdir / "calibration_profile.json").write_text(
            json.dumps(profile.__dict__, indent=2)
        )
        print(f"Candidate 2 profile built from {len(card_means)} card shot(s): "
              f"gains={profile.gains()}")
    else:
        print("No calibration_cards in manifest - candidate 2 will be skipped.")

    report = {"device": device, "candidate2_profile": profile.__dict__ if profile else None, "cases": []}

    for case in manifest.get("test_cases", []):
        label = case.get("label", case["file"])
        purity = case.get("purity", "22kt")
        card_box = tuple(case["card_box"])
        jewelry_box = tuple(case["jewelry_box"])

        arr = load_rgb_array(input_dir / case["file"])
        case_dir = outdir / label
        case_dir.mkdir(parents=True, exist_ok=True)

        original_path = case_dir / "0_original.jpg"
        save_rgb_array(arr, original_path)

        case_report: dict = {"label": label, "purity": purity, "file": case["file"]}

        # --- Candidate 1: sample THIS photo's own card, correct THIS photo's
        # jewelry region with gains derived from it. ---
        card_mean = sample_region_mean(arr, card_box)  # linear
        c1_gains = compute_gains_from_reference(card_mean)
        c1_arr = apply_gains(arr, c1_gains, box=jewelry_box)
        c1_path = case_dir / "1_candidate1_reference_card.jpg"
        save_rgb_array(c1_arr, c1_path)
        jewelry_mean_c1_srgb = linear_mean_to_srgb(sample_region_mean(c1_arr, jewelry_box))
        case_report["candidate1"] = {
            "gains": c1_gains,
            "card_mean_before_srgb": linear_mean_to_srgb(card_mean),
            "jewelry_mean_after_srgb": jewelry_mean_c1_srgb,
            "approx_purity_rgb_distance": rgb_distance(jewelry_mean_c1_srgb, APPROX_PURITY_RGB.get(purity, APPROX_PURITY_RGB["22kt"])),
        }

        # --- Candidate 2: apply the FIXED profile (built from separate
        # calibration shots) - the real question is whether it still
        # neutralizes THIS photo's card correctly, since it was never shown
        # this photo's own lighting. ---
        if profile:
            c2_gains = profile.gains()
            c2_arr = apply_gains(arr, c2_gains, box=jewelry_box)
            c2_path = case_dir / "2_candidate2_calibrated_profile.jpg"
            save_rgb_array(c2_arr, c2_path)
            # Apply the fixed profile to THIS photo's card region too, purely
            # to measure how far off-neutral it lands - this is the number
            # that answers "does a fixed profile generalize across photos."
            card_arr_c2 = apply_gains(arr, c2_gains, box=card_box)
            card_mean_after_c2_srgb = linear_mean_to_srgb(sample_region_mean(card_arr_c2, card_box))
            jewelry_mean_c2_srgb = linear_mean_to_srgb(sample_region_mean(c2_arr, jewelry_box))
            case_report["candidate2"] = {
                "gains": c2_gains,
                # 0-255 sRGB scale, same units a human reading the report would expect.
                "card_neutrality_error_on_this_photo": neutrality_error(card_mean_after_c2_srgb),
                "jewelry_mean_after_srgb": jewelry_mean_c2_srgb,
                "approx_purity_rgb_distance": rgb_distance(jewelry_mean_c2_srgb, APPROX_PURITY_RGB.get(purity, APPROX_PURITY_RGB["22kt"])),
            }
            make_side_by_side([original_path, c1_path, c2_path], case_dir / "side_by_side.jpg")
        else:
            make_side_by_side([original_path, c1_path], case_dir / "side_by_side.jpg")

        report["cases"].append(case_report)
        print(f"{label}: candidate1 gains={c1_gains}"
              + (f", candidate2 card-neutrality-error={case_report['candidate2']['card_neutrality_error_on_this_photo']:.2f}" if profile else ""))

    (outdir / "report.json").write_text(json.dumps(report, indent=2))
    print(f"\nDone. Per-case side-by-side images and report.json written to {outdir}/")
    print("Candidate 2's \"card_neutrality_error_on_this_photo\" is the key number: "
          "low across all cases means the fixed profile generalizes; high or "
          "inconsistent means lighting varies enough that candidate 2 doesn't "
          "hold up and candidate 1 (or 3) is needed instead.")


if __name__ == "__main__":
    main()
