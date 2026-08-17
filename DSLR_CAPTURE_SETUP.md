# Studio Camera (Tethered DSLR) Capture Setup

The app can trigger the studio's tethered Canon camera directly — staff click "Capture from Studio Camera" and the shutter fires, instead of using a phone camera. This is **off by default** — nothing changes until `DIGICAMCONTROL_PATH` is set on the machine running the server. It's only meaningful on the one machine physically wired to the camera (the fixed lightbox station's laptop), not on any other deployment.

## How it works

[digiCamControl](https://digicamcontrol.com/) is free, open-source Windows software that talks to Canon (and other) DSLR/mirrorless bodies over USB. It ships with a small standalone command-line tool, `CameraControlCmd.exe`, that can trigger a single capture and save the result to a specific file with one call — no GUI window needs to be open for this to work. The app shells out to that tool for every studio-camera capture, reads back the resulting photo, and feeds it into the exact same pipeline (downscale, quality check, enhance) as a phone photo or gallery upload.

## Setup steps

1. **Install digiCamControl** on the laptop that's physically connected to the camera: download it from [digicamcontrol.com](https://digicamcontrol.com/) and run the installer.

2. **Connect the camera via USB**, power it on, and set it to whatever mode you've calibrated (Manual, with your chosen ISO/aperture/shutter/white balance already dialed in on the camera body itself).

3. **Verify the connection works using digiCamControl's own GUI first**, before touching the app at all: open digiCamControl, confirm it detects the camera (it should show up in the camera list/status bar), and try a capture from inside the app itself. This step is worth doing on its own — if there's a driver or USB issue, you'll see it clearly here rather than through a confusing error from our app.

4. **Find the installed path of `CameraControlCmd.exe`** — by default this is usually somewhere like:
   ```
   C:\Program Files (x86)\digiCamControl\CameraControlCmd.exe
   ```
   (Check your actual install location — it can vary.)

5. **Set one environment variable** on the machine running the server (the same Lenovo laptop, since the server and the tethered camera are on the same machine):
   - `DIGICAMCONTROL_PATH` — the full path to `CameraControlCmd.exe` from step 4.

6. **Restart the server.** The "Capture from Studio Camera" button appears automatically on the photo capture screen and becomes the primary capture option — the phone camera option is still there, just moved to a secondary "Phone" button, so it's never fully unavailable.

## Troubleshooting

If a capture fails, the app shows the real error rather than a generic message:
- **"Could not launch digiCamControl at ..."** — the path in `DIGICAMCONTROL_PATH` is wrong, or digiCamControl isn't installed at that location. Re-check step 4.
- **"digiCamControl exited with code ..."** — the command ran but failed, usually because the camera isn't connected, is asleep, or isn't recognized. Re-verify using digiCamControl's own GUI (step 3).
- **"DSLR capture timed out after 20s"** — the camera likely isn't responding (asleep, USB cable issue, or a stuck previous session). Check the physical connection and that the camera is awake.
- **"digiCamControl reported success but no output file was found"** — worth reporting if you see this; it means the capture command finished but the file didn't land where expected.

## What this does *not* do (yet)

This is single-shot capture only — the shutter fires once per button press, using whatever settings are currently set on the camera body. It doesn't yet include a live preview in the app or automatic exposure adjustment; both were deliberately left out of this first pass in favor of a manually-calibrated, locked exposure profile (see the calibration notes from setup day). Live view is a reasonable next step once the basic capture flow is proven out.
