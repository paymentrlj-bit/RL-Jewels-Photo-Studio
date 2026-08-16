# Google Drive Export Setup

The app can upload each approved product's photo + data file straight into your own Google Drive, organized into a folder per item type. This is **off by default** — nothing changes until you complete the steps below and set two environment variables. It works with a normal personal or business Gmail account; **Google Workspace is not required.**

## How it works

The app authenticates as a small, dedicated "robot" identity (a *service account*) rather than as you personally. That robot has almost no storage of its own — instead, you share one folder in your own Drive with it (exactly like sharing a folder with a colleague), and everything the app uploads lands inside that folder, counted against your own Drive storage, visible in your Drive immediately.

## Setup steps

1. **Create a Google Cloud project** (free) at [console.cloud.google.com](https://console.cloud.google.com). Any name is fine, e.g. "RL Jewels Studio".

2. **Enable the Google Drive API** for that project: in the left sidebar, go to *APIs & Services → Library*, search for "Google Drive API", and click **Enable**.

3. **Create a service account**: *APIs & Services → Credentials → Create Credentials → Service Account*. Give it any name, e.g. "rlj-drive-uploader". You can skip granting it any project-level role — its Drive access comes entirely from the folder-sharing step below, not from IAM roles.

4. **Create a key for it**: open the service account you just created → *Keys* tab → *Add Key → Create New Key → JSON*. This downloads a `.json` file — treat it like a password, it's the credential the app uses to sign in as this identity.

5. **Create a destination folder in your own Google Drive** — e.g. "RL Jewels Studio Exports". Right-click it → **Share** → paste the service account's email address (it looks like `rlj-drive-uploader@your-project-id.iam.gserviceaccount.com` — you can find it inside the JSON file as `client_email`, or on the service account's page in the console) → give it **Editor** access → Share (you can uncheck "notify people", it's a robot).

6. **Copy the folder's ID** from its URL: open the folder in Drive, and copy the part of the URL after `/folders/` — e.g. `https://drive.google.com/drive/folders/1AbCdeFGhijKLmnop` → the ID is `1AbCdeFGhijKLmnop`.

7. **Set two environment variables** on your hosting provider (same place you set `GEMINI_API_KEY`):
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — the **entire contents** of the JSON key file from step 4, as a single value (most hosting dashboards handle multi-line JSON fine when pasted directly into one env var field).
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` — the folder ID from step 6.

Once both are set and the server restarts, the "Upload to Google Drive" option appears automatically on the Export screen — no code changes needed. If either variable is missing, the option just stays hidden, exactly like the app already does when `GEMINI_API_KEY` is missing.

## What gets uploaded

For each product you upload, the app creates (or reuses) a subfolder named after the item type — e.g. "Ring", "Chain", "Mangalsutra" — inside your shared root folder, and uploads two files into it:
- `<CPC>_photo.jpg` — the final, studio-enhanced photo
- `<CPC>_data.csv` — the same data as the ERP CSV export (CPC, name, description, purity, gender, size, weights, staff, timestamps)

## Security notes

- The service account is scoped to `drive.file` only — it can see and manage *only the files it creates itself*, nothing else already in your Drive.
- If you ever want to revoke access, just delete the service account's key in the Cloud Console, or unshare the folder from its email — no need to touch your own Google account.
