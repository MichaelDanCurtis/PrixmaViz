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

Workspaces with no activity (no `last_seen_at` updates) accumulate forever. There's no built-in TTL today. If your workspace count grows unmanageable, a one-shot SQL purge:

```sql
DELETE FROM workspaces
WHERE last_seen_at < now() - interval '180 days'
  AND id NOT IN (SELECT DISTINCT workspace_id FROM diagrams WHERE updated_at > now() - interval '180 days');
```

(Future cycle should add an automated job for this.)

### TLS notes

PrixmaViz itself only listens HTTP. TLS is the reverse proxy's job. This keeps Bun's network stack simple and lets you use whatever cert tooling your team already has.

The `/p/<id>` public-view endpoint sends `Content-Security-Policy: frame-ancestors *` so the SVG can be embedded in any site's iframe. Adjust your reverse proxy's CSP if you want to restrict this.
