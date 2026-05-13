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

If you have a Hostinger VPS (Ubuntu 24.04, Docker preinstalled):

1. **Point DNS.** Add an A record for `prixmaviz.alexis.com` → your VPS public IP. Wait for propagation (typically <5 minutes; verify with `dig prixmaviz.alexis.com`).

2. **SSH in and run the deploy script:**

   ```bash
   ssh root@<your-vps-ip>
   curl -fsSL https://raw.githubusercontent.com/MichaelDanCurtis/PrixmaViz/main/scripts/deploy-hostinger.sh | bash
   ```

   First run will:
   - Install Caddy
   - Clone the repo to `/srv/prixmaviz`
   - Generate `.env` with a strong Postgres password
   - Exit and ask you to review

3. **Review `/srv/prixmaviz/.env`** — adjust `PRIXMAVIZ_WORKSPACE_TTL_MINUTES` if you want longer/shorter TTL, set `KROKI_URL` if you want an external Kroki. Save.

4. **Re-run the script** to build + start:

   ```bash
   cd /srv/prixmaviz && bash scripts/deploy-hostinger.sh
   ```

   The script will build the image, start the stack, wait for `/api/health`, and verify the external HTTPS endpoint.

5. **Visit `https://prixmaviz.alexis.com/`** — your workspace is ready. Bookmark the URL it creates.

### Updates after the first deploy

```bash
ssh root@<vps>
cd /srv/prixmaviz && bash scripts/deploy-hostinger.sh
```

The script is idempotent — it'll `git pull`, rebuild the image, recreate containers with the new image, and verify health.

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

