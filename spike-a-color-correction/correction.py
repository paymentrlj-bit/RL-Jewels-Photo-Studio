"""
Spike A - color correction candidate implementations
(PIPELINE_REBUILD_BRIEF.md Section 3.1.3 / Section 6 "Spike A")

Standalone, throwaway spike tooling - NOT wired into the app. Deliberately
kept out of server.ts/src until a candidate actually wins the spike, per the
brief's own framing: "Required pre-commitment spike... before choosing an
algorithm." Python + PIL/numpy here because this is exploratory image-science
work, not a decision about the app's production stack (Section 8 leaves the
real Stage A implementation language/library open).

Implements candidates 1 and 2 from 3.1.3. Candidate 3 (a narrow model
predicting correction parameters) is intentionally NOT implemented here - the
brief says to only build it "if neither of the above holds up under real
testing," so it doesn't exist until candidates 1/2 are actually tested
against real photos and found wanting.

IMPORTANT what this does NOT do: naive gray-world (assume the whole scene
averages to neutral) or naive retinex. Both are explicitly called out in the
brief as likely wrong for this use case - gray-world would desaturate a
frame that's overwhelmingly one warm gold color by construction, actively
fighting the purity-accuracy this step exists to protect. Candidate 1 here
only samples a KNOWN neutral surface (a real grey/white reference card
photographed in-frame) and anchors the correction to that - fundamentally
different from assuming the whole scene should average to neutral.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
from PIL import Image

Box = tuple[int, int, int, int]  # (x1, y1, x2, y2), pixel coords, PIL convention

# Gains are clamped to a plausible range - anything more extreme than this
# indicates a genuinely bad reference-card sample (wrong region, card in
# shadow, etc), not a real correction. Clamping avoids a bad sample producing
# a wildly over/under-corrected result you could ship without noticing.
GAIN_CLAMP = (0.4, 2.5)


def load_rgb_array(path: str | Path) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    return np.asarray(img, dtype=np.float64)


# White-balance gains are a physical statement about light intensity, but a
# JPEG/PIL array is gamma-encoded (sRGB), not linear. Multiplying a gain
# directly on gamma-encoded values shifts HUE, not just brightness -
# confirmed by this module's own smoke test: a synthetic warm-cast gold ring
# corrected in gamma space came out olive/green instead of gold. Decoding to
# linear light, applying the gain, then re-encoding avoids this. Gamma 2.2
# is an approximation of the real piecewise sRGB transfer function - close
# enough for this spike, not claimed to be colorimetrically exact.
_GAMMA = 2.2


def _to_linear(arr_0_255: np.ndarray) -> np.ndarray:
    return np.power(np.clip(arr_0_255, 0, 255) / 255.0, _GAMMA)


def _to_srgb(linear_0_1: np.ndarray) -> np.ndarray:
    return np.power(np.clip(linear_0_1, 0, 1), 1.0 / _GAMMA) * 255.0


def sample_region_mean(arr: np.ndarray, box: Box) -> tuple[float, float, float]:
    """Mean color of a region, in LINEAR light - gains are computed and
    applied in linear space throughout this module (see _to_linear above)."""
    x1, y1, x2, y2 = box
    region = arr[y1:y2, x1:x2]
    if region.size == 0:
        raise ValueError(f"Empty region for box {box} - check coordinates against image size {arr.shape[1]}x{arr.shape[0]}.")
    linear_region = _to_linear(region)
    mean = linear_region.reshape(-1, 3).mean(axis=0)
    return float(mean[0]), float(mean[1]), float(mean[2])


def compute_gains_from_reference(mean_rgb: tuple[float, float, float]) -> tuple[float, float, float]:
    """
    Candidate 1's core step: given the measured mean color of a KNOWN neutral
    surface (a real grey/white card), compute per-channel gains that would
    bring that surface back to true neutral. Target neutral value is the
    average of the three channel means, not a fixed constant - this preserves
    the photo's overall exposure/brightness and only corrects color cast, not
    luminance (exposure is a separate, already-solved concern elsewhere in
    this pipeline).
    """
    r, g, b = mean_rgb
    if min(r, g, b) <= 0:
        raise ValueError(f"Reference region has a zero/negative channel mean {mean_rgb} - can't compute a gain from this.")
    target = (r + g + b) / 3.0
    lo, hi = GAIN_CLAMP
    gains = (target / r, target / g, target / b)
    clamped = tuple(min(max(g_, lo), hi) for g_ in gains)
    return clamped  # type: ignore[return-value]


def apply_gains(arr: np.ndarray, gains: tuple[float, float, float], box: Box | None = None) -> np.ndarray:
    """
    Applies per-channel gains in LINEAR light (decode -> multiply -> encode)
    either to the whole array or, if box is given, only within that region
    (leaving everything else byte-for-byte unchanged) - mirrors the real
    pipeline's "masked correction only touches the jewelry, never the
    background" requirement (3.1.3), using a rectangular box here since the
    spike doesn't have a real alpha matte to work with yet.
    """
    out = arr.copy()
    gr, gg, gb = gains
    if box is None:
        region = out
    else:
        x1, y1, x2, y2 = box
        region = out[y1:y2, x1:x2]

    linear = _to_linear(region)
    linear[..., 0] *= gr
    linear[..., 1] *= gg
    linear[..., 2] *= gb
    corrected = _to_srgb(linear)

    if box is None:
        return np.clip(corrected, 0, 255)
    out[y1:y2, x1:x2] = corrected
    return np.clip(out, 0, 255)


def save_rgb_array(arr: np.ndarray, path: str | Path) -> None:
    Image.fromarray(arr.astype(np.uint8), mode="RGB").save(path)


def linear_mean_to_srgb(mean_linear: tuple[float, float, float]) -> tuple[float, float, float]:
    """Converts a linear-space mean (as returned by sample_region_mean) back
    to familiar 0-255 sRGB units, purely for human-readable reporting and for
    comparing against the 0-255 APPROX_PURITY_RGB references below."""
    arr = _to_srgb(np.array(mean_linear))
    return float(arr[0]), float(arr[1]), float(arr[2])


def neutrality_error(mean_rgb: tuple[float, float, float]) -> float:
    """
    How far a (supposedly neutral) sampled patch is from true gray, as the
    max channel deviation from the patch's own mean. 0 = perfectly neutral.
    This is the one HARD, verifiable number this spike produces - it doesn't
    depend on any assumed "true" gold color, just on whether a known-neutral
    surface actually reads as neutral after correction.
    """
    r, g, b = mean_rgb
    mean = (r + g + b) / 3.0
    return max(abs(r - mean), abs(g - mean), abs(b - mean))


# Approximate, photography-convention reference colors for each purity under
# neutral daylight-balanced lighting - NOT a measured/spectrophotometer
# ground truth, and the brief's own risk here (3.1.3) is exactly that no such
# reference exists in-frame. This is informational only, a rough sanity
# check that a correction landed in a plausible band, not the real
# ground-truth comparison. The REAL ground truth for this spike is a human
# holding the corrected image up against the actual physical piece and
# judging whether it matches - these numbers cannot substitute for that.
APPROX_PURITY_RGB = {
    "18kt": (222, 186, 111),
    "22kt": (230, 191, 90),
    "24kt": (235, 193, 66),
}


def rgb_distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return float(np.linalg.norm(np.array(a) - np.array(b)))


@dataclass
class CalibrationProfile:
    gain_r: float
    gain_g: float
    gain_b: float
    built_from_n_cards: int
    device: str
    notes: str = ""

    def gains(self) -> tuple[float, float, float]:
        return (self.gain_r, self.gain_g, self.gain_b)


def build_calibration_profile(card_means: list[tuple[float, float, float]], device: str, notes: str = "") -> CalibrationProfile:
    """
    Candidate 2's calibration step: average the per-card gains computed from
    several reference-card-only shots taken under the store's typical
    lighting, into ONE fixed profile applied to every future photo without
    needing a card in every shot. Averaging gains (not raw RGB means) means
    this stays correct even if the card was photographed slightly differently
    exposed shot to shot.
    """
    if not card_means:
        raise ValueError("Need at least one reference-card sample to build a profile.")
    all_gains = np.array([compute_gains_from_reference(m) for m in card_means])
    avg = all_gains.mean(axis=0)
    return CalibrationProfile(
        gain_r=float(avg[0]), gain_g=float(avg[1]), gain_b=float(avg[2]),
        built_from_n_cards=len(card_means), device=device, notes=notes,
    )


def save_profile(profile: CalibrationProfile, path: str | Path) -> None:
    Path(path).write_text(json.dumps(asdict(profile), indent=2))


def load_profile(path: str | Path) -> CalibrationProfile:
    data = json.loads(Path(path).read_text())
    return CalibrationProfile(**data)
