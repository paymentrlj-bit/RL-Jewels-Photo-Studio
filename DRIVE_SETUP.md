# Google Drive Export Setup

The app can upload each approved product's photo + data file straight into your own Google Drive, organized into a folder per item type. This is **off by default** — nothing changes until you complete the steps below and set the environment variables. It works with a normal personal or business Gmail account; **Google Workspace is not required.**

## How it works

The app authenticates as **you** (a real Google account) via OAuth, not as a separate "robot" identity. This matters: Google service accounts have no Drive storage quota of their own, and the only two ways around that — Shared Drives and domain-wide delegation — both require a paid Google Workspace subscription. Authenticating as a real account sidesteps that entirely: everything the app uploads counts against your own Drive's normal storage, exactly as if you'd dragged the file in yourself.

You only need to do the authorization step once — it produces a long-lived **refresh token** that the app then uses indefinitely (until you revoke it) without you needing to log in again.

## Setup steps

1. **Create a Google Cloud project** (free) at [console.cloud.google.com](https://console.cloud.google.com). Any name is fine, e.g. "RL Jewels Studio".

2. **Enable the Google Drive API** for that project: in the left sidebar, go to *APIs & Services → Library*, search for "Google Drive API", and click **Enable**.

3. **Configure the OAuth consent screen**: *APIs & Services → OAuth consent screen*. Choose **External**, fill in the required app name/support email fields (anything reasonable), and save, then add your own Google account under **Test users**.

   **Then click "Publish App"** to move it out of "Testing" status, right away, before generating the refresh token in step 5. This does **not** require Google's review or verification for this use case — you'll just see an "unverified app" warning when authorizing in step 5, which is expected and fine to click through. Skipping this step is the single most common way this integration breaks: a refresh token minted while the app is still in "Testing" status is **silently killed by Google after exactly 7 days**, with no warning — uploads that worked all week suddenly fail with `invalid_grant` and no obvious cause. Publishing first avoids that entirely.

4. **Create an OAuth Client ID**: *APIs & Services → Credentials → Create Credentials → OAuth client ID*. Application type: **Web application** (not "Desktop app" — that type has fixed redirect URIs you can't edit, which breaks the next step). Give it any name, e.g. "RL Jewels Drive Uploader". Under **Authorized redirect URIs**, click **Add URI** and enter exactly `https://developers.google.com/oauthplayground`. Create it, then copy the **Client ID** and **Client Secret** shown — you'll need both.

5. **Get a refresh token** using Google's OAuth Playground:
   - Go to [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground/).
   - Click the gear icon (top right) → check **Use your own OAuth credentials** → paste the Client ID and Client Secret from step 4.
   - In the left panel, find **Drive API v3** and select the scope `https://www.googleapis.com/auth/drive.file`.
   - Click **Authorize APIs** — sign in with the Google account whose Drive you want files uploaded to (e.g. the account this app should use).
   - Click **Exchange authorization code for tokens**. Copy the **Refresh token** shown — this is the long-lived credential the app will use.

6. **Create a destination folder in that same Google account's Drive** — e.g. "RL Jewels Studio Exports". No sharing step needed this time, since the app is authenticating as this account directly.

7. **Copy the folder's ID** from its URL: open the folder in Drive, and copy the part of the URL after `/folders/` — e.g. `https://drive.google.com/drive/folders/1AbCdeFGhijKLmnop` → the ID is `1AbCdeFGhijKLmnop`.

8. **Set four environment variables** on your hosting provider (same place you set `GEMINI_API_KEY`):
   - `GOOGLE_DRIVE_CLIENT_ID` — the Client ID from step 4.
   - `GOOGLE_DRIVE_CLIENT_SECRET` — the Client Secret from step 4.
   - `GOOGLE_DRIVE_REFRESH_TOKEN` — the refresh token from step 5.
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` — the folder ID from step 7.

Once all four are set and the server restarts, the "Upload to Google Drive" option appears automatically on the Export screen — no code changes needed. If any variable is missing, the option just stays hidden, exactly like the app already does when `GEMINI_API_KEY` is missing.

## What gets uploaded

Each product's photo and data file land in a folder structured as:

```
<root folder>/<Group>/<Category>/<Gender>/<Style>/
    <CPC>_photo.jpg   - the final, studio-enhanced photo
    <CPC>_data.csv    - the same data as the ERP CSV export (CPC, name, description, purity, gender, size, weights, staff, timestamps)
```

- **Group** — the merchandising department several trade categories are shopped under together, matched to the store's own department names where they've confirmed one: every ear-worn style (Jhumka, Chandbali, Bali, studs, Kansakhali, Latkan Tops...) lands under one "Tops Category" folder; every bangle-family piece (Bangle, Kada) under "Bangles Category"; Bracelet has its own "Bracelet Category"; Chain has its own "Chain Category"; the small odds-and-ends the store's own POS also lumps together (Bajuband, Aakda, Bindi, Rakhi, Anklet, Waist Chain) live under "Set Category". Only present for categories that share a department with others — a category distinct enough on its own (Ring, Mangalsutra, Nose Pin, Janwa...) skips straight to the next level.
- **Category** — the trade category (Ring, Mangalsutra, Chain, Bangle, ...), resolved the same way the rest of the app resolves it, so "Chandrakanta" and "Chand Bali" (two names for the same thing) land in one "Chandbali" folder rather than two.
- **Gender** — only present for categories that genuinely span more than one (Ring, Chain, Bangle, Kada, Bracelet, Pendant, Coin, Rakhi, Aakda, Mala). A category that's single-gender by convention (Mangalsutra, Nose Pin, Janwa, ...) skips this level entirely rather than adding a folder that would only ever have one subfolder in it.
- **Style** — the store's own specific style name, exactly as typed or scanned (e.g. "Vati Mangalsutra", "Gents Casting Anguthi"). If that's just the bare category name with nothing more specific, it goes in a folder called "General" instead of nesting a folder under itself.

Which categories share a Group (and which don't) is a config table in `server/catalog/taxonomy.ts` (the `group` field on each `Category` entry) — a one-line change per category to move something, no folder logic to touch.

Re-exporting a batch never re-uploads a product that's already in Drive — once a product is marked exported, it's skipped on every future export click, so retrying a batch or clicking Drive again only sends what's actually new.

## Uploads run in the background

Clicking "Drive" queues the batch's uploads and returns immediately — it does not hold the page open while every product uploads one at a time. The Export screen polls for progress ("Uploading… 12 of 20 done") and shows the final tally once everything's through, the same way photo processing already works elsewhere in the app. You're free to leave the screen; the upload keeps going.

## Troubleshooting

**Uploads fail with `invalid_grant` for every item, all at once, after working fine before.** The refresh token is dead — either it was minted while the OAuth consent screen was still in "Testing" status (Google kills those after exactly 7 days, see step 3 above), the authorizing Google account's password changed, or access was revoked at [myaccount.google.com/permissions](https://myaccount.google.com/permissions). Fix: confirm the app is Published (step 3), then redo step 5 to mint a fresh refresh token and update `GOOGLE_DRIVE_REFRESH_TOKEN`. A stuck-open-forever refresh token is the whole point of this setup, so this should be a one-time fix once the app is actually published.

## Security notes

- The OAuth token is scoped to `drive.file` only — it can see and manage *only the files it creates itself*, nothing else already in your Drive.
- If you ever want to revoke access, go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions) on the authorized Google account and remove the app, or simply delete the OAuth Client ID in the Cloud Console.
