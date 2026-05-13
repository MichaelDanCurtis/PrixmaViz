# Deploy PrixmaViz to production

This playbook deploys PrixmaViz at a canonical URL (e.g. `prixmaviz.alexis.com`) using Docker Compose, an external Postgres, and a host-level reverse proxy for TLS.

## Prerequisites

- A host with Docker + Compose v2 installed
- A PostgreSQL 16+ instance reachable from the host (managed or self-run)
- DNS A record pointing at the host
- A reverse proxy on the host (Caddy, nginx, or Cloudflare Tunnel) for TLS termination

## 1. Build and push the image

From a developer machine with the repo checked out:

```bash
# Build for the platform your host runs (linux/amd64 or linux/arm64)
docker build --platform linux/amd64 -t YOUR_REGISTRY/prixmaviz:0.4.0 .

# Push to your registry (Docker Hub, GHCR, etc.)
docker push YOUR_REGISTRY/prixmaviz:0.4.0
```

If you don't want to use a registry, build directly on the host:

```bash
git clone https://github.com/MichaelDanCurtis/PrixmaViz
cd PrixmaViz
docker build -t prixmaviz:0.4.0 .
```

## 2. Configure the host

Create a deploy directory on the host and copy `docker-compose.yaml`, `docker-compose.prod.yaml`, and a production `.env`:

```bash
ssh prixmaviz.alexis.com
mkdir -p /srv/prixmaviz
cd /srv/prixmaviz

# Copy the compose files (scp from your dev machine, or curl from the repo)
curl -O https://raw.githubusercontent.com/MichaelDanCurtis/PrixmaViz/main/docker-compose.yaml
curl -O https://raw.githubusercontent.com/MichaelDanCurtis/PrixmaViz/main/docker-compose.prod.yaml

# Create the production .env
cat > .env <<EOF
DATABASE_URL=postgres://prixmaviz:STRONG_PASSWORD@your-postgres-host:5432/prixmaviz
PRIXMAVIZ_PUBLIC_URL=https://prixmaviz.alexis.com
HOST_PORT=127.0.0.1:5180
# Idle anonymous workspaces are reaped after this many minutes. Workspaces
# containing any public-view diagram are exempt. Set to 0 to disable.
PRIXMAVIZ_WORKSPACE_TTL_MINUTES=60
PRIXMAVIZ_REAP_INTERVAL_MINUTES=5
EOF
chmod 600 .env
```

## 3. Provision the database

On your external Postgres:

```sql
CREATE DATABASE prixmaviz;
CREATE USER prixmaviz WITH PASSWORD 'STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE prixmaviz TO prixmaviz;
\c prixmaviz
GRANT ALL ON SCHEMA public TO prixmaviz;
```

The application runs its own migrations at startup, so no manual schema setup is needed.

## 4. Start the stack

```bash
# Update docker-compose.yaml's prixmaviz service to use your image:
#   image: YOUR_REGISTRY/prixmaviz:0.4.0
# (or just keep `prixmaviz:dev` if you built on the host)

docker compose -f docker-compose.yaml -f docker-compose.prod.yaml up -d

# Wait for healthchecks
docker compose ps
```

## 5. Configure the reverse proxy

### Caddy

```caddy
prixmaviz.alexis.com {
    reverse_proxy 127.0.0.1:5180
    # Caddy handles TLS automatically via Let's Encrypt
}
```

### nginx

```nginx
server {
    server_name prixmaviz.alexis.com;
    listen 443 ssl http2;
    # Add your cert paths here

    location / {
        proxy_pass http://127.0.0.1:5180;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Note: WebSocket support requires the `Upgrade`/`Connection` headers above.

## 6. Verify

```bash
curl https://prixmaviz.alexis.com/api/health
# {"ok":true}
```

Then open `https://prixmaviz.alexis.com/` in a browser — your workspace is ready.

## Operations

### Backups

The application is stateless beyond Postgres. Back up your Postgres with whatever tooling your provider gives (managed snapshot, `pg_dump`, etc.). Diagrams' SVG renders are deterministic so they regenerate from `dsl`/`ir` if needed.

### Updates

```bash
cd /srv/prixmaviz
git pull   # if you cloned the repo
docker pull YOUR_REGISTRY/prixmaviz:NEW_VERSION   # or docker build -t prixmaviz:0.4.0 .
docker compose -f docker-compose.yaml -f docker-compose.prod.yaml up -d --force-recreate prixmaviz
```

Migrations run automatically at container startup. No manual `migrate` step.

### Logs

```bash
docker compose logs -f prixmaviz
docker compose logs --tail 100 kroki
```

### Anonymous workspace garbage collection

The server reaps idle anonymous workspaces automatically. Defaults: a workspace whose `last_seen_at` is older than 60 minutes is deleted, unless it contains at least one public-view diagram (those are pinned indefinitely — toggling a diagram public is the user's explicit signal to keep the workspace alive).

Tune via env:

- `PRIXMAVIZ_WORKSPACE_TTL_MINUTES` (default `60`) — minutes of inactivity before a workspace is eligible for deletion. Set `0` to disable the reaper entirely.
- `PRIXMAVIZ_REAP_INTERVAL_MINUTES` (default `5`) — how often the reaper job runs.

Each pass that deletes anything logs `reaper: deleted N expired workspaces` to the container's stderr — visible via `docker compose logs prixmaviz | grep reaper`.

### TLS notes

PrixmaViz itself only listens HTTP. TLS is the reverse proxy's job. This keeps Bun's network stack simple and lets you use whatever cert tooling your team already has.

The `/p/<id>` public-view endpoint sends `Content-Security-Policy: frame-ancestors *` so the SVG can be embedded in any site's iframe. Adjust your reverse proxy's CSP if you want to restrict this.

## Quick deploy: Hostinger VPS

If you have a Hostinger VPS (Ubuntu 24.04, Docker preinstalled), you have two
TLS paths:

- **Path A — grey cloud (DNS-only).** Cloudflare or your registrar points the
  A record directly at the VPS IP, with Cloudflare's proxy OFF. Let's Encrypt
  uses HTTP-01 (port 80). This is the simplest path; nothing to configure
  beyond DNS.
- **Path B — orange cloud (Cloudflare proxy).** Cloudflare proxies traffic to
  the VPS, hiding the VPS IP and adding DDoS protection / caching. In this
  mode, Let's Encrypt's HTTP-01 challenge fails because port 80 lands on
  Cloudflare, not the VPS. The deploy script uses Cloudflare's DNS API to
  prove ownership via DNS-01 instead — works regardless of how port 80 is
  routed.

### Path A: grey cloud (DNS-only)

1. **Point DNS.** Add an A record for `prixmaviz.alexis.com` → your VPS public
   IP, with Cloudflare's proxy DISABLED (grey cloud). Verify with
   `dig prixmaviz.alexis.com` returns the VPS IP, not Cloudflare's.
2. **SSH in and run the deploy script:**
   ```bash
   ssh root@<your-vps-ip>
   curl -fsSL https://raw.githubusercontent.com/MichaelDanCurtis/PrixmaViz/main/scripts/deploy-hostinger.sh | bash
   ```
3. **Review `/srv/prixmaviz/.env`** — leave `CF_API_TOKEN` empty.
4. **Re-run** `cd /srv/prixmaviz && bash scripts/deploy-hostinger.sh`. Caddy
   acquires a cert via HTTP-01.

### Path B: orange cloud (Cloudflare proxy)

1. **Create a Cloudflare API token.** Go to
   [My Profile → API Tokens](https://dash.cloudflare.com/profile/api-tokens),
   click "Create Token", pick the **"Edit zone DNS"** template, scope it to
   the zone `alexis.com` (or whichever parent zone owns the domain), and
   save. Copy the token — Cloudflare only shows it once.

2. **Point DNS via Cloudflare** with the proxy ENABLED (orange cloud).
   `dig prixmaviz.alexis.com` will return Cloudflare IPs (`104.21.x` /
   `172.67.x`), not your VPS IP — that's expected.

3. **Set Cloudflare's SSL/TLS mode to "Full (strict)"** for the zone.
   Anything weaker (Flexible, Full) will cause redirect loops or expose
   traffic in cleartext between Cloudflare and the VPS.

4. **SSH in and run the deploy script** (first run installs Caddy + the
   Cloudflare DNS module, then exits asking you to populate `.env`):
   ```bash
   ssh root@<your-vps-ip>
   curl -fsSL https://raw.githubusercontent.com/MichaelDanCurtis/PrixmaViz/main/scripts/deploy-hostinger.sh | bash
   ```

5. **Edit `/srv/prixmaviz/.env`** and paste the token:
   ```bash
   CF_API_TOKEN=<paste-your-cloudflare-token-here>
   ```

6. **Re-run the deploy script** to build, start, and acquire the cert via
   DNS-01:
   ```bash
   cd /srv/prixmaviz && bash scripts/deploy-hostinger.sh
   ```
   First run installs the `caddy-dns/cloudflare` module via
   `caddy add-package` and `apt-mark hold caddy` to prevent future apt
   upgrades from clobbering the customized binary. To upgrade Caddy later:
   ```bash
   sudo apt-mark unhold caddy
   sudo apt-get install --only-upgrade caddy
   sudo caddy add-package github.com/caddy-dns/cloudflare
   sudo apt-mark hold caddy
   ```

7. **Visit `https://prixmaviz.alexis.com/`** — your workspace is ready.
   Bookmark the URL it creates.

### Re-issuing the cert if it failed

If Caddy logs show `obtain failed`, `challenge failed`, or any TLS error:

```bash
# 1. Inspect recent attempts
sudo journalctl -u caddy --no-pager | grep -E "cert|tls|challenge|error" | tail -50

# 2. Common fixes
#    a) Cloudflare token missing/wrong scope:
sudo grep CF_API_TOKEN /etc/systemd/system/caddy.service.d/cloudflare-token.conf
#    Verify the token's permissions in Cloudflare (Edit zone DNS, scoped to
#    the correct zone). Update /srv/prixmaviz/.env if needed and re-run the
#    deploy script — it re-templates the systemd drop-in.

#    b) Cloudflare SSL/TLS mode is not Full (strict): fix it in the dashboard.

#    c) Stale state in Caddy's data dir (rare): force re-acquisition:
sudo systemctl reload caddy        # picks up Caddyfile changes; usually enough
# If still stuck, nuke just this domain's cached cert and let Caddy retry:
sudo rm -rf /var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/prixmaviz.alexis.com
sudo systemctl restart caddy

# 3. Tail the live log while it retries
sudo journalctl -u caddy -f
```

### Updates after the first deploy

```bash
ssh root@<vps>
cd /srv/prixmaviz && bash scripts/deploy-hostinger.sh
```

The script is idempotent — it'll `git pull`, rebuild the image, recreate
containers with the new image, and verify health.

### Logs and troubleshooting

```bash
# Application logs
docker compose -f docker-compose.yaml -f docker-compose.hostinger.yaml logs -f prixmaviz

# Reverse proxy + cert logs
sudo journalctl -u caddy -f
sudo tail -f /var/log/caddy/prixmaviz.log

# Container status
docker compose -f docker-compose.yaml -f docker-compose.hostinger.yaml ps
```

