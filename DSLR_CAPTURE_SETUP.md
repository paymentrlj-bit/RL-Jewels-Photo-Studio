# Studio Camera (Tethered DSLR) Capture Setup

The app can trigger the studio's tethered Canon camera directly — staff click "Capture from Studio Camera" and the shutter fires, instead of using a phone camera. This is **off by default** — nothing changes until you complete the steps below.

## Why this needs two pieces

The main app runs in the cloud. The camera is a physical USB device plugged into one specific machine — the Lenovo at the fixed lightbox station. A cloud server has no way to reach a USB device on your laptop directly, so this feature has two parts:

1. **The bridge** (`dslr-bridge/`) — a small program that runs *on the Lenovo itself*. It's the only thing that talks to the camera.
2. **The cloud app** — calls the bridge over the internet (through a Cloudflare Tunnel, which gives the bridge a public HTTPS address with no router configuration needed) whenever someone clicks "Capture from Studio Camera."

If you ever move to running the whole app locally on the Lenovo instead of the cloud, this same bridge still works unchanged — it doesn't care where the caller is.

## Part 1 — Install and configure digiCamControl (on the Lenovo)

1. **Install digiCamControl**: download the **Stable Version** from [digicamcontrol.com/download](https://digicamcontrol.com/download) and run the installer. (Skip the "Virtual Webcam" and "LightBox Alpha" downloads.)

2. **Connect the camera via USB**, power it on, and set it to whatever mode you've calibrated (Manual, with your chosen ISO/aperture/shutter/white balance already dialed in on the camera body itself).

3. **Verify the connection works using digiCamControl's own GUI first**, before touching anything else:
   - Open digiCamControl.
   - Confirm it detects the camera — it should show up in the camera list or status bar.
   - Click its capture/shutter button once and confirm a photo is taken and saved.
   - This step is worth doing on its own: if there's a driver or USB issue, you'll see it clearly here rather than through a confusing error later.

4. **Enable digiCamControl's web server**: *File → Settings → Webserver → check "Use web server"*, then restart digiCamControl. This app now depends on the full digiCamControl GUI running (not just its command-line tool) — it's what both live view and capture go through.

5. **Set digiCamControl's save folder** to exactly the folder this bridge watches for new photos:
   ```
   C:\Users\admin\AppData\Local\Temp\rlj-dslr-capture
   ```
   (In digiCamControl, this is under Settings/Session — the exact label varies by version, look for "folder" or "save to.") Create the folder first if it doesn't exist yet.

6. **Start live view** in digiCamControl's own GUI (the Live View button/toggle — confirm you see a real feed inside the app itself, not just a blank panel). Then confirm in a browser on the Lenovo:
   - `http://localhost:5513/liveview.jpg` should show a real frame (refresh to update).
   - `http://127.0.0.1:5514/live` should show a continuously-updating live feed.
   - `http://localhost:5513/?slc=capture&camera=` should fire the shutter and return `OK` in the browser (live view will pause for a moment, then resume automatically).

   If any of these don't work, fix it here before moving on — everything downstream depends on this working locally first.

## Part 2 — Run the bridge (on the Lenovo)

7. **Install Node.js** on the Lenovo if it isn't already (download from [nodejs.org](https://nodejs.org) — the LTS version).

8. **Get this repository onto the Lenovo** (e.g. `git clone` it, or just copy the `dslr-bridge/` folder over) and open a terminal in the `dslr-bridge/` folder.

9. **Choose a secret** — any long random string (this stops random internet traffic from triggering your camera once the bridge is exposed publicly in the next step). A password manager's "generate password" feature works fine for this.

10. **Set one environment variable** in that terminal before starting the bridge:
    - `BRIDGE_SECRET` — the secret you chose in step 9. (`DIGICAMCONTROL_PATH` is no longer used — the bridge now talks to digiCamControl's own web server from step 4, not its command-line tool, so there's no install path to configure.)

    On Windows PowerShell, that looks like:
    ```powershell
    $env:BRIDGE_SECRET = "paste-your-long-random-secret-here"
    node bridge.js
    ```
    You should see `DSLR bridge listening on http://localhost:3001`. Leave this window open — closing it stops the bridge. (Once this is all confirmed working, set this up via Task Scheduler so it survives reboots — see "Daily startup" below.)

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

12. **Restart the cloud server.** The "Capture from Studio Camera" button appears automatically on the photo capture screen (on non-mobile devices it becomes the primary option; on phones it appears as a secondary "Studio" button) — the phone camera option is always still there as a fallback. On the primary device, the capture box now shows a **live view feed** by default, so staff can frame the shot before pressing capture.

## Daily startup

Three things now need to be running on the Lenovo, ideally all via Task Scheduler ("At log on") so a reboot brings everything back without anyone needing to open a terminal:

1. **digiCamControl itself**, with live view already started (there's no command-line way to auto-start live view on launch, so this is the one manual step each morning — or leave the Lenovo running rather than shutting it down daily).
2. **The bridge** (`node bridge.js` in `dslr-bridge/`).
3. **The Cloudflare Tunnel** (`cloudflared tunnel run <your-tunnel-name>`, or `cloudflared tunnel --url http://localhost:3001` for quick-tunnel mode).

If you're using a free quick tunnel (a new URL every restart, no Cloudflare account needed), you'll need to update `DSLR_BRIDGE_URL` on the cloud server each time it restarts — a fixed Cloudflare Tunnel URL avoids that entirely and is worth setting up once you're past initial testing.

## Troubleshooting

- **"Studio camera capture is not configured on this server"** — `DSLR_BRIDGE_URL` or `DSLR_BRIDGE_SECRET` isn't set on the cloud server, or the server hasn't restarted since you set them.
- **Button/live view shows unavailable even though everything looks running** — the cloud app pings the bridge's `/status` before showing anything, which itself now pings digiCamControl's own web server (not just checking a config value). If the Lenovo, the bridge, the tunnel, *or* digiCamControl's web server is down, it correctly shows as unavailable. Check all three are running, and that "Use web server" is still enabled in digiCamControl (step 4).
- **"Unauthorized"** — `DSLR_BRIDGE_SECRET` (cloud) and `BRIDGE_SECRET` (bridge) don't match exactly. Re-copy one into the other.
- **"digiCamControl capture command failed"** — the web server responded but not with `OK`; usually the camera isn't connected, is asleep, or digiCamControl isn't running at all. Re-verify using the manual test in step 6.
- **"Studio camera capture timed out"** — the camera likely isn't responding (asleep, USB cable issue), or the bridge/tunnel isn't actually running. Check the physical connection and that all three daily-startup components are up.
- **"digiCamControl reported success but no output file appeared"** — the save folder in step 5 doesn't match `C:\Users\admin\AppData\Local\Temp\rlj-dslr-capture` exactly. Re-check that setting.
- **Live view shows in digiCamControl's own GUI but not in the app** — confirm live view was actually *started* in the GUI (enabling the web server alone isn't enough), and that `http://127.0.0.1:5514/live` shows a feed in a browser on the Lenovo itself before assuming it's a bridge/tunnel problem.
- **"Studio camera autofocus failed"** — the Focus button (shown over the live view) sends `CMD=DoAutoFocus` to digiCamControl's web server. That command name is the one reported in use by digiCamControl's own community documentation, but it has **not** been confirmed against this specific installation the way the step 6 endpoints have. If the button errors, test `http://localhost:5513/?CMD=DoAutoFocus` directly in a browser on the Lenovo while live view is running and see what comes back (and whether the camera actually racks focus) — `bridge.log` also logs the raw response either way, which is the fastest way to spot a wrong command name and get it corrected.

## What this does *not* do (yet)

Exposure is still manual/locked — there's no automatic ISO/aperture/shutter adjustment, deliberately, in favor of a manually-calibrated, consistent exposure profile (see the calibration notes from setup day). Live view now exists specifically to make framing/focus checks easier before pressing capture, not to enable per-shot exposure tweaking.
