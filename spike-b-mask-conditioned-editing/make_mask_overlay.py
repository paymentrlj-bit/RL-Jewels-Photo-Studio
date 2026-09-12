#!/usr/bin/env python3
"""Builds a visual mask-overlay image (magenta rectangle on black, same
dimensions as the original) for the alternate prompting strategy tested by
masked_inpaint.cjs --mask-overlay: since generateContent has no real mask
input, this tests whether SHOWING the model a visual mask as a second image
gets better region compliance than describing the region in text/coordinates
alone.

Usage: python3 make_mask_overlay.py --manifest sample_input/manifest.json --outdir sample_input
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument("--manifest", default="sample_input/manifest.json")
parser.add_argument("--outdir", default="sample_input")
args = parser.parse_args()

manifest_path = Path(args.manifest)
manifest_dir = manifest_path.parent
manifest = json.loads(manifest_path.read_text())
cases = manifest if isinstance(manifest, list) else [manifest]

for c in cases:
    original = Image.open(manifest_dir / c["file"])
    w, h = original.size
    ymin, xmin, ymax, xmax = c["crossing_box_0_1000"]
    x1, y1, x2, y2 = int(xmin / 1000 * w), int(ymin / 1000 * h), int(xmax / 1000 * w), int(ymax / 1000 * h)

    overlay = Image.new("RGB", (w, h), (0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((x1, y1, x2, y2), fill=(255, 0, 255))
    out_path = Path(args.outdir) / f"{Path(c['file']).stem}_mask_overlay.png"
    overlay.save(out_path)
    print(f"{c['file']} -> {out_path}")
