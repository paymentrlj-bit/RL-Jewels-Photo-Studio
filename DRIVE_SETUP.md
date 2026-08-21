# Google Drive Export Setup

The app can upload each approved product's photo + data file straight into your own Google Drive, organized into a folder per item type. This is **off by default** — nothing changes until you complete the steps below and set the environment variables. It works with a normal personal or business Gmail account; **Google Workspace is not required.**

## How it works

The app authenticates as **you** (a real Google account) via OAuth, not as a separate "robot" identity. This matters: Google service accounts have no Drive storage quota of their own, and the only two ways around that — Shared Drives and domain-wide delegation — both require a paid Google Workspace subscription. Authenticating as a real account sidesteps that entirely: everything the app uploads counts against your own Drive's normal storage, exactly as if you'd dragged the file in yourself.

You only need to do the authorization step once — it produces a long-lived **refresh token** that the app then uses indefinitely (until you revoke it) without you needing to log in again.

## Setup steps

1. **Create a Google Cloud project** (free) at [console.cloud.google.com](https://console.cloud.google.com). Any name is fine, e.g. "RL Jewels Studio".

2. **Enable the Google Drive API** for that project: in the left sidebar, go to *APIs & Services → Library*, search for "Google Drive API", and click **Enable**.

3. **Configure the OAuth consent screen**: *APIs & Services → OAuth consent screen*. Choose **External**, fill in the required app name/support email fields (anything reasonable), and save. You do not need to submit it for Google verification — it's fine to stay in "Testing" mode as long as you add your own Google account under **Test users** on that same screen.

4. **Create an OAuth Client ID**: *APIs & Services → Credentials → Create Credentials → OAuth client ID*. Application type: **Desktop app**. Give it any name, e.g. "RL Jewels Drive Uploader". After creating it, copy the **Client ID** and **Client Secret** shown — you'll need both.

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

For each product you upload, the app creates (or reuses) a subfolder named after the item type — e.g. "Ring", "Chain", "Mangalsutra" — inside your root folder, and uploads two files into it:
- `<CPC>_photo.jpg` — the final, studio-enhanced photo
- `<CPC>_data.csv` — the same data as the ERP CSV export (CPC, name, description, purity, gender, size, weights, staff, timestamps)

## Security notes

- The OAuth token is scoped to `drive.file` only — it can see and manage *only the files it creates itself*, nothing else already in your Drive.
- If you ever want to revoke access, go to [myaccount.google.com/permissions](https://myaccount.google.com/permissions) on the authorized Google account and remove the app, or simply delete the OAuth Client ID in the Cloud Console.
