# IIE Deployment — Staging in St. Vincent and the Grenadines

Staging runs on **one Linux server hosted in St. Vincent and the Grenadines**, with Docker. It is the full platform
(website, API, background worker, database) with **sandbox payments**: no real money moves. Every page shows a
"Staging · test site" banner and the site is kept out of search engines.

Files: [`deploy/staging/`](../deploy/staging) and the root [`Dockerfile`](../Dockerfile).

## What runs

```
Internet ──443/80──> caddy ──/api/v1/*──> api (NestJS) ──┐
                        └────── other ──> web (Next.js)   ├──> postgres (volume pgdata)
                                          worker ─────────┘
                                          api ──> media volume (product images)
```

| Service | Image | Role |
|---|---|---|
| `caddy` | `caddy:2-alpine` | HTTPS with automatic Let's Encrypt certificates; the only service with open ports |
| `web` | `iie-web:staging` | Website (Next.js standalone server) |
| `api` | `iie-api:staging` | API at `/api/v1`; stores product images in the `media` volume |
| `worker` | `iie-api:staging` | Emails, cancelling unpaid orders after 30 minutes, automatic refunds after 48 hours without seller confirmation |
| `migrate` | `iie-api:staging` | Runs once on every start: database migrations and reference data, then exits. The API and worker wait for it |
| `postgres` | `postgres:16-alpine` | Database (volume `pgdata`); not reachable from outside |

Containers restart automatically after a crash or a server reboot. Times in logs are St. Vincent time
(`America/St_Vincent`); the database stores all times with their time zone.

## Server requirements

| Item | Minimum |
|---|---|
| Location | St. Vincent and the Grenadines (data residency for the pilot) |
| OS | Ubuntu 24.04 LTS or Debian 12, 64-bit |
| CPU / memory / disk | 2 vCPU, 4 GB RAM, 40 GB SSD (building the images needs the memory) |
| Network | Public IPv4 address; ports 80 and 443 open inbound; outbound HTTPS and SMTP (465) |
| DNS | An A record, e.g. `staging.interislandexchange.com`, pointing at the server |
| Software | Docker Engine 25+ with the Compose plugin, git, openssl |

If the host cannot give the server a public address, put it behind the host's load balancer or a tunnel and
terminate HTTPS there; then change the Caddyfile to listen on plain HTTP and keep `COOKIE_SECURE=true`
(the browser still sees HTTPS).

## First install

```sh
# 1. Docker (Ubuntu/Debian): https://docs.docker.com/engine/install/  then:
sudo usermod -aG docker "$USER"   # log out and in again

# 2. Code
sudo mkdir -p /opt/iie && sudo chown "$USER" /opt/iie
git clone https://github.com/Guvax111/inter-island-exchange.git /opt/iie
cd /opt/iie/deploy/staging

# 3. Settings (secrets are generated on the server and never leave it)
cp .env.example .env && chmod 600 .env
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^MFA_ENCRYPTION_KEY=.*|MFA_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
sed -i "s|^SANDBOX_PAYMENT_SECRET=.*|SANDBOX_PAYMENT_SECRET=$(openssl rand -hex 32)|" .env
nano .env   # SITE_DOMAIN, EMAIL_FROM, SMTP_USER, SMTP_PASS (Gmail app password)

# 4. Build and start (first build takes several minutes)
docker compose up -d --build
docker compose ps            # all "Up"; api and web "healthy"; migrate "Exited (0)"

# 5. First administrator (you are prompted; the password is not stored in shell history)
read -r -p "Admin email: " IIE_ADMIN_EMAIL; read -r -s -p "Admin password (12+ characters): " IIE_ADMIN_PASSWORD; echo
docker compose run --rm -T -e IIE_ADMIN_EMAIL="$IIE_ADMIN_EMAIL" -e IIE_ADMIN_PASSWORD="$IIE_ADMIN_PASSWORD" api node dist/cli/create-admin.js
unset IIE_ADMIN_PASSWORD
```

Open `https://<SITE_DOMAIN>`. The certificate is issued on the first visit (DNS must already point at the server).

### Check it works

```sh
curl -fsS https://<SITE_DOMAIN>/api/v1/health       # {"status":"ok"}
docker compose logs --tail 20 worker                 # "IIE worker (staging) started"
```

Then run through the pilot by hand: register a seller in St. Lucia and a buyer in St. Vincent (the verification
emails arrive through Gmail), approve the seller and the product as the administrator, order, and pay on the
**SANDBOX PAYMENT PAGE**. The same flow is covered by the automated end-to-end test, which has been run against these
containers.

## Updating

```sh
cd /opt/iie && git pull
cd deploy/staging && ./backup.sh && docker compose up -d --build
```

Migrations run automatically before the new API starts. They only add; a failed migration stops the start-up and
leaves the old data untouched (restore from the backup taken just before if needed).

## Backups

`backup.sh` writes a database dump (custom format, verified after writing) and an archive of the product images to
`BACKUP_DIR`, and deletes backups older than `BACKUP_KEEP_DAYS` (14).

```sh
sudo mkdir -p /var/backups/iie && sudo chown "$USER" /var/backups/iie
crontab -e
# 02:15 every night, St. Vincent time if the server clock is set to it
15 2 * * * /opt/iie/deploy/staging/backup.sh >> /var/log/iie-backup.log 2>&1
```

**Keep a second copy away from the server** (another machine in St. Vincent, or encrypted storage the IIE directors
approve, bearing data-residency rules in mind). A backup on the same disk does not survive the loss of the server.

### Restore

```sh
cd /opt/iie/deploy/staging
./restore.sh /var/backups/iie/iie-db-<time>.dump /var/backups/iie/iie-media-<time>.tar.gz
```

It asks you to type `RESTORE`, stops the app, replaces the database and images, and starts everything again.
Restore has been tested: orders, the ledger, transaction ID numbering, product images and the database's
append-only and balance rules all come back.

**Test a restore every month** on a spare machine; an untested backup is not a backup.

## Security checklist

- [ ] `.env` is `chmod 600`, owned by the deploy user, and never committed or emailed. Secrets differ from any other environment.
- [ ] Only ports 22, 80 and 443 are open (`sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable`).
      Note Docker publishes ports around `ufw`; only Caddy publishes any.
- [ ] SSH with keys only (`PasswordAuthentication no`), no root login.
- [ ] Automatic OS security updates (`unattended-upgrades`).
- [ ] Administrator accounts turn on two-step verification.
- [ ] Gmail: a dedicated account for IIE email with 2-Step Verification and an app password (see [`IIE_SECURITY.md`](IIE_SECURITY.md)).
- [ ] The API's interactive docs (`/api/v1/docs`) are not published on staging.
- [ ] Payments: `PAYMENT_PROVIDER=sandbox`. Production refuses to start with it.

## Operations

| Task | Command (in `deploy/staging`) |
|---|---|
| Status | `docker compose ps` |
| Logs | `docker compose logs -f --tail 100 api worker` |
| Restart one service | `docker compose restart api` |
| Database shell | `docker compose exec postgres psql -U iie -d iie` |
| Stop everything | `docker compose down` (data stays in the volumes; **never** add `-v` unless you mean to delete it) |

## Staging vs production

| | Staging (now) | Production (later) |
|---|---|---|
| Payments | Sandbox, no real money | Licensed provider; the sandbox is refused |
| Email | Gmail | Gmail at first; a transactional email service when volume grows |
| Images | Server disk (`media` volume) | Object storage; local disk is refused |
| Database | Container on the same server | Managed or separately hosted PostgreSQL with point-in-time recovery |
| Banner / search engines | "Staging" banner, `noindex` | Neither |

## Building behind a TLS-inspecting proxy

If the server reaches the internet through a proxy that re-signs HTTPS, pass its CA certificate to the build:

```sh
docker build --secret id=extra_ca,src=/path/to/proxy-ca.crt --target api -t iie-api:staging ../..
```
