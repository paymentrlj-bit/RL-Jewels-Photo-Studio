# Running the studio on the shop Lenovo

The whole app runs on one Windows machine. No Docker, no Cloudflare Tunnel, no
cloud hosting bill. Staff phones open it over the shop Wi-Fi.

**What this costs:** nothing, except the Gemini API calls themselves (roughly
₹5–6 per product at current placeholder rates — see "Cost" at the bottom).

---

## One-time setup

### 1. Install Node.js

Download the **LTS** installer from [nodejs.org](https://nodejs.org) and run it.
Accept the defaults. Then open **PowerShell** and check:

```powershell
node --version
```

You should see `v22.x` or higher.

> On a stripped-down Windows 11 build, if the installer refuses, use the
> **.zip** build from nodejs.org instead: unzip to `C:\node`, then add
> `C:\node` to PATH under System Properties → Environment Variables.

### 2. Get the app onto the machine

Either `git clone` it, or download the repository ZIP and unzip it to
`C:\rl-studio`. Then:

```powershell
cd C:\rl-studio
npm install
npm run build
```

`npm install` takes a few minutes the first time.

### 3. Create the settings file

Make a file called `.env` in `C:\rl-studio` with these lines:

```
NODE_ENV=production
PORT=3000
DATA_DIR=C:\rl-studio-data

SESSION_SECRET=<paste a long random string here, then never change it>
BOOTSTRAP_ADMIN_PASSWORD=<pick an admin password, at least 10 characters>

GEMINI_API_KEY=<your key>
ERP_MAPPING=generic
```

To generate the session secret, run this once and paste the output:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `DATA_DIR` is deliberately **outside** `C:\rl-studio`. Every photo and the
> whole database live there, so updating the app can never touch the work.

### 4. Allow phones through the Windows firewall

Once, in an **Administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "RL Jewels Studio" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

### 5. Start it

```powershell
cd C:\rl-studio
npm start
```

You should see `listening http://localhost:3000`. Leave this window open.

---

## Opening it from a phone

Find the Lenovo's address on the shop Wi-Fi:

```powershell
ipconfig
```

Look for **IPv4 Address** under your Wi-Fi adapter — something like
`192.168.1.42`. On any phone on the same Wi-Fi, open:

```
http://192.168.1.42:3000
```

Bookmark it / add to home screen.

### What works over plain HTTP, and what doesn't

Browsers only allow a website to drive the camera directly over a secure
(`https`) connection. On the shop LAN you are on plain `http`, so:

| | Works? |
|---|---|
| **Take a photo** (opens the phone's own camera app) | ✅ Yes |
| Uploading an existing photo | ✅ Yes |
| Everything else — forms, review, approve, export | ✅ Yes |
| Live camera preview inside the app | ❌ Hidden automatically |
| **Barcode/QR scanning** of the tag | ❌ Hidden — type the code instead |

The app detects this and hides the buttons that cannot work, rather than
showing something that errors. Photography is unaffected: the "Take a photo"
button hands off to the phone's own camera app, which needs no certificate.

**If you want barcode scanning back**, you need HTTPS. Cheapest route, using
the domain you already own:

1. Point a subdomain (e.g. `studio.yourdomain.com`) at the Lenovo's **LAN** IP
   with an A record.
2. Install [Caddy](https://caddyserver.com/download) and get a certificate via
   a **DNS-01** challenge (Caddy has plugins for most DNS providers). This
   works even though the IP is private, because the certificate is proved
   through DNS rather than through a public HTTP request.
3. Point Caddy at `localhost:3000`.

That is genuinely more moving parts, so it is worth doing only once typing CPCs
starts to annoy people.

---

## Making it start automatically

So a reboot does not mean someone has to open PowerShell:

1. Create `C:\rl-studio\start-studio.bat` containing:

   ```bat
   @echo off
   cd /d C:\rl-studio
   npm start
   ```

2. Open **Task Scheduler** → *Create Task*
   - **General**: name it "RL Jewels Studio", tick **Run whether user is
     logged on or not**
   - **Triggers**: New → *At startup*
   - **Actions**: New → Start a program → `C:\rl-studio\start-studio.bat`
   - **Settings**: tick *If the task fails, restart every 1 minute*

The machine can then be left on overnight and the studio is up whenever staff
arrive.

---

## Updating the app

```powershell
cd C:\rl-studio
git pull
npm install
npm run build
```

Then restart the task (or the machine). `DATA_DIR` is untouched, so no photos
or products are lost — the database migrates itself on the next start.

---

## Backing up

This is the important one. Everything the store has shot lives in
`C:\rl-studio-data`.

Copy that whole folder to a USB stick or Google Drive **weekly**. Copying while
the app is running is fine. If you want a perfectly clean copy, stop the task
first.

There is no other copy. Lose that folder and the catalogue work is gone.

---

## Cost

The app itself costs nothing to run here — no hosting, no Docker, no tunnel.

The only spend is Gemini API calls, roughly:

| | Per photo |
|---|---|
| Normal path (segment + enhance + audit + copy) | ~$0.05 |
| When it needs the escalated retry | ~$0.14 |

At a blended ~$0.07, a **3,247-product catalogue ≈ $230 ≈ ₹20,000 one-time**.

⚠️ Those are placeholder rates built into the app, not real billing. After the
first 50 products, open the Google Cloud Billing console, read the real figure,
and put it in `.env` as `COST_ENHANCE_DEFAULT_USD` etc. The Insights screen
tells you the numbers are estimates until you do.

**Set a budget cap** in Google Cloud Billing before a big run. If the cap is
hit, the app reports it clearly as a billing problem rather than looking like
a broken photo.
