# Studio Camera (Tethered DSLR) Capture Setup

The app can trigger the studio's tethered Canon camera directly — staff click "Capture from Studio Camera" and the shutter fires, instead of using a phone camera. This is **off by default** — nothing changes until you complete the steps below.

## Why this needs two pieces

The main app runs in the cloud. The camera is a physical USB device plugged into one specific machine — the Lenovo at the fixed lightbox station. A cloud server has no way to reach a USB device on your laptop directly, so this feature has two parts:

1. **The bridge** (`dslr-bridge/`) — a small program that runs *on the Lenovo itself*. It's the only thing that talks to the camera.
2. **The cloud app** — calls the bridge over the internet (through a Cloudflare Tunnel, which gives the bridge a public HTTPS address with no router configuration needed) whenever someone clicks "Capture from Studio Camera."

If you ever move to running the whole app locally on the Lenovo instead of the cloud, this same bridge still works unchanged — it doesn't care where the caller is.

## Part 1 — Install and verify digiCamControl (on the Lenovo)

1. **Install digiCamControl**: download the **Stable Version** from [digicamcontrol.com/download](https://digicamcontrol.com/download) and run the installer. (Skip the "Virtual Webcam" and "LightBox Alpha" downloads — the Stable Version is the one that includes the command-line tool this bridge needs.)

2. **Connect the camera via USB**, power it on, and set it to whatever mode you've calibrated (Manual, with your chosen ISO/aperture/shutter/white balance already dialed in on the camera body itself).

3. **Verify the connection works using digiCamControl's own GUI first**, before touching anything else:
   - Open digiCamControl.
   - Confirm it detects the camera — it should show up in the camera list or status bar.
   - Click its capture/shutter button once and confirm a photo is taken and saved.
   - This step is worth doing on its own: if there's a driver or USB issue, you'll see it clearly here rather than through a confusing error later.

4. **Find the installed path of `CameraControlCmd.exe`** — by default this is usually:
   ```
   C:\Program Files (x86)\digiCamControl\CameraControlCmd.exe
   ```
   (Check your actual install location — it can vary.)

## Part 2 — Run the bridge (on the Lenovo)

5. **Install Node.js** on the Lenovo if it isn't already (download from [nodejs.org](https://nodejs.org) — the LTS version).

6. **Get this repository onto the Lenovo** (e.g. `git clone` it, or just copy the `dslr-bridge/` folder over) and open a terminal in the `dslr-bridge/` folder.

7. **Choose a secret** — any long random string (this stops random internet traffic from triggering your camera once the bridge is exposed publicly in the next step). A password manager's "generate password" feature works fine for this.

8. **Set two environment variables** in that terminal before starting the bridge:
   - `DIGICAMCONTROL_PATH` — the path from step 4.
   - `BRIDGE_SECRET` — the secret you chose in step 7.

   On Windows PowerShell, that looks like:
   ```powershell
   $env:DIGICAMCONTROL_PATH = "C:\Program Files (x86)\digiCamControl\CameraControlCmd.exe"
   $env:BRIDGE_SECRET = "paste-your-long-random-secret-here"
   node bridge.js
   ```
   You should see `DSLR bridge listening on http://localhost:3001`. Leave this window open — closing it stops the bridge. (Once this is all confirmed working, you can look into running it as a background/startup task so it survives reboots without you needing to reopen a terminal each morning.)

## Part 3 — Expose the bridge with a Cloudflare Tunnel (on the Lenovo)

9. **Install `cloudflared`**: download it from [Cloudflare's install guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (Windows installer).

10. **In a second terminal window** (leave the bridge from step 8 running in the first one), run:
    ```powershell
    cloudflared tunnel --url http://localhost:3001
    ```
    This prints a public HTTPS URL like `https://random-words-1234.trycloudflare.com`. That's your bridge's internet address — copy it. Leave this window open too.

    (This "quick tunnel" mode is free and needs no Cloudflare account, but the URL changes every time you restart it. Once everything's confirmed working, a free Cloudflare account gets you a fixed, permanent URL instead — worth doing once you're past initial testing.)

## Part 4 — Connect the cloud app

11. **Set two environment variables** on your cloud hosting provider (same place you set `GEMINI_API_KEY`):
    - `DSLR_BRIDGE_URL` — the tunnel URL from step 10 (no trailing slash).
    - `DSLR_BRIDGE_SECRET` — the exact same secret you set as `BRIDGE_SECRET` in step 8.

12. **Restart the cloud server.** The "Capture from Studio Camera" button appears automatically on the photo capture screen (on non-mobile devices it becomes the primary option; on phones it appears as a secondary "Studio" button) — the phone camera option is always still there as a fallback.

## Daily startup (once everything above is confirmed working once)

Each day, before shooting: power on the camera, then on the Lenovo start both the bridge (`node bridge.js` in `dslr-bridge/`) and the tunnel (`cloudflared tunnel --url http://localhost:3001`) — two terminal windows, both left open for the session. If you got a fixed Cloudflare URL in step 10's note, you won't need to update `DSLR_BRIDGE_URL` again; with the free quick-tunnel mode, a new URL each restart means updating the cloud env var each time, which is the main reason to move to a fixed URL once you're past initial testing.

## Troubleshooting

- **"Studio camera capture is not configured on this server"** — `DSLR_BRIDGE_URL` or `DSLR_BRIDGE_SECRET` isn't set on the cloud server, or the server hasn't restarted since you set them.
- **Button shows unavailable even though everything looks running** — the cloud app pings the bridge's `/status` before showing the button; if the Lenovo, the bridge process, or the tunnel is offline, it correctly shows as unavailable rather than a broken button. Check both terminal windows are still open and running.
- **"Unauthorized"** — `DSLR_BRIDGE_SECRET` (cloud) and `BRIDGE_SECRET` (bridge) don't match exactly. Re-copy one into the other.
- **"Could not launch digiCamControl at ..."** — the path in `DIGICAMCONTROL_PATH` is wrong, or digiCamControl isn't installed at that location. Re-check step 4.
- **"digiCamControl exited with code ..."** — the command ran but failed, usually because the camera isn't connected, is asleep, or isn't recognized. Re-verify using digiCamControl's own GUI (step 3).
- **"Studio camera capture timed out"** — the camera likely isn't responding (asleep, USB cable issue), or the bridge/tunnel isn't actually running. Check the physical connection and both terminal windows.
- **"digiCamControl reported success but no output file was found"** — worth reporting if you see this; it means the capture command finished but the file didn't land where expected.

## What this does *not* do (yet)

This is single-shot capture only — the shutter fires once per button press, using whatever settings are currently set on the camera body. It doesn't yet include a live preview in the app or automatic exposure adjustment; both were deliberately left out of this first pass in favor of a manually-calibrated, locked exposure profile (see the calibration notes from setup day). Live view is a reasonable next step once the basic capture flow is proven out.
