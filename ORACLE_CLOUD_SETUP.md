# Hosting the studio on Oracle Cloud Always Free

Free forever, in Mumbai, with real HTTPS — which is what turns the barcode
scanner back on.

**Total time:** about 45 minutes, most of it waiting for Oracle to verify your
account. The actual deployment is three commands.

**What it costs:** ₹0/month for the server. You still pay Google for Gemini API
calls (~₹20,000 one-time for the full 3,247-product catalogue).

---

## Why Oracle and not Cloudflare

These are different things and it is worth being clear before you start:

- **Oracle Cloud Always Free** is a *server*. It runs the app. This is what you
  need.
- **Cloudflare free tier** is *DNS and a CDN proxy*. It sits in front of a
  server you already have. It cannot run anything.

So: Oracle now. Cloudflare is optional and takes ten minutes to add later —
see the last section.

---

## Part 1 — Create the Oracle account (~15 min)

1. Go to **[oracle.com/cloud/free](https://www.oracle.com/cloud/free/)** and
   click *Start for free*.

2. Fill in your details. When it asks for **Home Region**, choose
   **India South (Mumbai)** — `ap-mumbai-1`.

   > ⚠️ **This cannot be changed later.** Your Always Free resources only exist
   > in your home region. Pick Mumbai for latency from Jalgaon.

3. **You will be asked for a credit or debit card.** This is identity
   verification only. Oracle places a small temporary hold (around ₹100) and
   refunds it. As long as you stay on Always Free resources, you are not
   charged. Indian cards sometimes fail here — if yours does, try a different
   card or a different browser; it is a known annoyance.

4. Wait for the "Your account is ready" email. Usually minutes, occasionally a
   few hours.

---

## Part 2 — Create the server (~10 min)

1. Sign in to the Oracle Cloud console. In the top-left menu:
   **Compute → Instances → Create instance**.

2. **Name:** `rl-studio`

3. **Image and shape** → click *Edit*:
   - **Image:** Canonical Ubuntu **24.04** (Oracle will show the ARM build
     automatically once you pick the shape below)
   - **Shape:** click *Change shape* → **Ampere** →
     `VM.Standard.A1.Flex`
   - Set **2 OCPUs** and **12 GB memory**

   > The Always Free allowance is 4 OCPUs and 24 GB. Asking for half of it is
   > far more likely to be granted than asking for all of it, and 2/12 is more
   > than this app will ever use.

4. **Networking:** leave the defaults. Make sure
   **Assign a public IPv4 address** is selected.

5. **Add SSH keys:** choose **Generate a key pair for me**, then click
   **Save private key**. You get a `.key` file — keep it safe, it is the only
   way into the server.

6. **Boot volume:** tick *Specify a custom boot volume size* and enter
   **100** GB. (Always Free gives you 200 GB total.)

7. Click **Create**. Wait for the state to go orange → **green (Running)**.

8. **Copy the Public IP address** from the instance page. You need it twice
   below.

### If you see "Out of host capacity"

This is the single most common problem with Oracle's free tier — Ampere
capacity in popular regions is often exhausted. In order of what to try:

1. **Just retry.** Click Create again. Capacity frees up constantly; people
   often succeed within a few attempts across a day.
2. **Try a different Availability Domain** if Mumbai shows more than one.
3. **Reduce to 1 OCPU / 6 GB.** Smaller requests get filled more often, and
   this app runs fine on it.
4. **Upgrade to Pay As You Go.** Counter-intuitive, but PAYG accounts get
   priority for Ampere capacity, and *Always Free resources stay free on a
   PAYG account*.

   > ⚠️ On PAYG you **can** be charged if you go beyond the free limits. If you
   > do this, immediately set a **Budget** with an alert at ₹100 under
   > *Billing → Budgets*, so a mistake reaches you by email rather than by
   > invoice.

---

## Part 3 — Open the firewall (~3 min)

Oracle blocks traffic in **two** places and you must open **both**. Missing the
second one is the classic failure: the site simply times out, with no error
message anywhere to tell you why.

**Place 1 — the Oracle console:**

1. On your instance page, click the **Subnet** link.
2. Click the **Security List** (usually "Default Security List for …").
3. **Add Ingress Rules** → add these two:

   | Source CIDR | IP Protocol | Destination Port |
   |---|---|---|
   | `0.0.0.0/0` | TCP | `80` |
   | `0.0.0.0/0` | TCP | `443` |

**Place 2 — inside the server.** The setup script in Part 5 handles this for
you. You do not need to do anything here, just know it exists — if the site is
unreachable later, this is the first thing to check.

---

## Part 4 — Point your domain at it (~5 min)

In whatever service manages your domain's DNS, add an **A record**:

| Type | Name | Value |
|---|---|---|
| A | `studio` | *your server's public IP* |

That gives you `studio.yourdomain.com`.

> **If your DNS is on Cloudflare:** set the record to **DNS only** (grey cloud,
> not orange) for now. The orange proxy interferes with the certificate request
> in the next step. You can turn it on afterwards.

Wait a few minutes, then check from your own computer:

```bash
ping studio.yourdomain.com
```

It must reply with your server's IP before you continue. If it still shows an
old address or fails, wait — DNS can take up to an hour.

---

## Part 5 — Deploy (~10 min)

SSH into the server from your laptop. On Mac or Linux:

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<your-public-ip>
```

On Windows, use PowerShell with the same `ssh -i ...` command, or PuTTY.

Then run the setup script:

```bash
curl -fsSL https://raw.githubusercontent.com/paymentrlj-bit/RL-Jewels-Photo-Studio/main/deploy/setup.sh | bash
```

It installs Docker, opens the server-side firewall, clones the app, and writes
a settings file with a strong `SESSION_SECRET` already generated.

Now edit that settings file:

```bash
nano ~/rl-studio/deploy/.env
```

Set three things:

```
STUDIO_DOMAIN=studio.yourdomain.com
BOOTSTRAP_ADMIN_PASSWORD=<a real password, 10+ characters>
GEMINI_API_KEY=<your key>
```

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

Start it:

```bash
cd ~/rl-studio/deploy
sudo docker compose up -d --build
```

The first build takes 3–5 minutes. Watch it come up:

```bash
sudo docker compose logs -f
```

When you see `listening http://localhost:3000` and Caddy reporting a
certificate obtained, open **https://studio.yourdomain.com** on your phone.

Sign in as `admin` with the password you set. **First thing to do:**
Admin → Staff accounts → create a real account for each person.

---

## Part 6 — Backups (~2 min, do not skip)

Everything the store has shot lives in one Docker volume. Schedule a nightly
copy:

```bash
bash ~/rl-studio/deploy/backup.sh --install
```

That runs at 2am and keeps 14 days.

**That is not enough on its own.** Those archives sit on the same server as the
data. Once a week, pull one down to your own machine:

```bash
scp -i ~/Downloads/ssh-key-*.key ubuntu@<ip>:~/rl-studio-backups/studio-*.tar.gz .
```

There is no other copy of this work.

---

## Updating later

```bash
cd ~/rl-studio
git pull
cd deploy
sudo docker compose up -d --build
```

The data volume is untouched. The database migrates itself on start.

---

## Troubleshooting

**The site does not load at all.**
Almost always the server-side firewall. Check both places:

```bash
sudo iptables -L INPUT -n --line-numbers | head -20
```

You should see `ACCEPT tcp dpt:80` and `dpt:443` near the top. If not:

```bash
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Then re-check the Oracle console Security List from Part 3.

**Browser says the certificate is invalid.**
Caddy could not reach Let's Encrypt, nearly always because DNS was not live
when it tried. Fix the DNS, then:

```bash
cd ~/rl-studio/deploy && sudo docker compose restart caddy
sudo docker compose logs caddy | tail -30
```

If your DNS is on Cloudflare, confirm the record is grey-cloud, not orange.

**"Photos queue but never process."**
`GEMINI_API_KEY` is missing or wrong. The app says so on screen. Fix `.env`
then `sudo docker compose up -d`.

**Out of disk.**
```bash
df -h
docker system prune -af    # removes old build layers, never touches your data
```

---

## Optional: adding Cloudflare later

Once everything works, Cloudflare's free tier gives you DDoS protection, a
cached edge inside India, and hides your server's real IP.

1. Add your domain to Cloudflare (free plan) and update the nameservers at
   your registrar.
2. Set the `studio` A record to **Proxied** (orange cloud).
3. SSL/TLS mode: **Full (strict)** — your Caddy certificate is real, so strict
   works and is the correct setting.

Do this *after* the site is confirmed working, never before. If anything
breaks, switching back to grey cloud restores it instantly.
