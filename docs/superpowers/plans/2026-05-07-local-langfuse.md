# Local Langfuse Observability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local Langfuse Docker Compose stack and documentation so developers can self-host traces without cloud keys.

**Architecture:** Bundle official Langfuse v3 `docker-compose.yml` at repo root as `docker-compose.langfuse.yml`. Provide `.env.langfuse.example` for secrets. Update `.env.example` with commented local vars. Add setup guide. No runtime code changes — app already reads `LANGFUSE_HOST` env var.

**Tech Stack:** Docker Compose v2, official Langfuse images (`langfuse/langfuse`, `langfuse/langfuse-worker`)

---

### Task 1: Create docker-compose.langfuse.yml

**Files:**
- Create: `docker-compose.langfuse.yml`

- [ ] **Step 1: Write compose file**

```yaml
services:
  langfuse-worker:
    image: langfuse/langfuse-worker:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      clickhouse:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/postgres
      - SALT=${SALT:-salt}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}
      - TELEMETRY_ENABLED=${TELEMETRY_ENABLED:-true}
      - LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES=${LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES:-false}
      - CLICKHOUSE_URL=${CLICKHOUSE_URL:-http://clickhouse:8123}
      - CLICKHOUSE_USER=${CLICKHOUSE_USER:-clickhouse}
      - CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD:-clickhouse}
      - CLICKHOUSE_CLUSTER_ENABLED=${CLICKHOUSE_CLUSTER_ENABLED:-false}
      - LANGFUSE_S3_EVENT_UPLOAD_BUCKET=${LANGFUSE_S3_EVENT_UPLOAD_BUCKET:-langfuse}
      - LANGFUSE_S3_EVENT_UPLOAD_REGION=${LANGFUSE_S3_EVENT_UPLOAD_REGION:-auto}
      - LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=${LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID:-minio}
      - LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=${LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY:-miniosecret}
      - LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=${LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT:-http://minio:9000}
      - LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=${LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE:-true}
      - LANGFUSE_S3_EVENT_UPLOAD_PREFIX=${LANGFUSE_S3_EVENT_UPLOAD_PREFIX:-events/}
      - LANGFUSE_S3_MEDIA_UPLOAD_BUCKET=${LANGFUSE_S3_MEDIA_UPLOAD_BUCKET:-langfuse}
      - LANGFUSE_S3_MEDIA_UPLOAD_REGION=${LANGFUSE_S3_MEDIA_UPLOAD_REGION:-auto}
      - LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID=${LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID:-minio}
      - LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=${LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY:-miniosecret}
      - LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=${LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT:-http://minio:9000}
      - LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE=${LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE:-true}
      - LANGFUSE_S3_MEDIA_UPLOAD_PREFIX=${LANGFUSE_S3_MEDIA_UPLOAD_PREFIX:-media/}
      - REDIS_HOST=${REDIS_HOST:-redis}
      - REDIS_PORT=${REDIS_PORT:-6379}
      - REDIS_AUTH=${REDIS_AUTH:-redis}
      - REDIS_CONNECTION_STRING=${REDIS_CONNECTION_STRING:-redis://:redis@redis:6379}
      - LANGFUSE_WORKER_PASSWORD=${LANGFUSE_WORKER_PASSWORD:-worker}

  langfuse-web:
    image: langfuse/langfuse:latest
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      clickhouse:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/postgres
      - SALT=${SALT:-salt}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}
      - TELEMETRY_ENABLED=${TELEMETRY_ENABLED:-true}
      - LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES=${LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES:-false}
      - NEXTAUTH_URL=http://localhost:3000
      - NEXTAUTH_SECRET=${NEXTAUTH_SECRET:-secret}
      - CLICKHOUSE_URL=${CLICKHOUSE_URL:-http://clickhouse:8123}
      - CLICKHOUSE_USER=${CLICKHOUSE_USER:-clickhouse}
      - CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD:-clickhouse}
      - CLICKHOUSE_CLUSTER_ENABLED=${CLICKHOUSE_CLUSTER_ENABLED:-false}
      - LANGFUSE_S3_EVENT_UPLOAD_BUCKET=${LANGFUSE_S3_EVENT_UPLOAD_BUCKET:-langfuse}
      - LANGFUSE_S3_EVENT_UPLOAD_REGION=${LANGFUSE_S3_EVENT_UPLOAD_REGION:-auto}
      - LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=${LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID:-minio}
      - LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=${LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY:-miniosecret}
      - LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=${LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT:-http://minio:9000}
      - LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=${LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE:-true}
      - LANGFUSE_S3_EVENT_UPLOAD_PREFIX=${LANGFUSE_S3_EVENT_UPLOAD_PREFIX:-events/}
      - LANGFUSE_S3_MEDIA_UPLOAD_BUCKET=${LANGFUSE_S3_MEDIA_UPLOAD_BUCKET:-langfuse}
      - LANGFUSE_S3_MEDIA_UPLOAD_REGION=${LANGFUSE_S3_MEDIA_UPLOAD_REGION:-auto}
      - LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID=${LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID:-minio}
      - LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=${LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY:-miniosecret}
      - LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=${LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT:-http://minio:9000}
      - LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE=${LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE:-true}
      - LANGFUSE_S3_MEDIA_UPLOAD_PREFIX=${LANGFUSE_S3_MEDIA_UPLOAD_PREFIX:-media/}
      - REDIS_HOST=${REDIS_HOST:-redis}
      - REDIS_PORT=${REDIS_PORT:-6379}
      - REDIS_AUTH=${REDIS_AUTH:-redis}
      - REDIS_CONNECTION_STRING=${REDIS_CONNECTION_STRING:-redis://:redis@redis:6379}
      - LANGFUSE_WORKER_PASSWORD=${LANGFUSE_WORKER_PASSWORD:-worker}
    ports:
      - "3000:3000"

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    restart: unless-stopped
    environment:
      CLICKHOUSE_DB: default
      CLICKHOUSE_USER: ${CLICKHOUSE_USER:-clickhouse}
      CLICKHOUSE_PASSWORD: ${CLICKHOUSE_PASSWORD:-clickhouse}
    volumes:
      - langfuse_clickhouse_data:/var/lib/clickhouse
    ports:
      - "127.0.0.1:8123:8123"
      - "127.0.0.1:9000:9000"
    healthcheck:
      test: wget --no-verbose --tries=1 --spider http://localhost:8123/ping || exit 1
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    entrypoint: sh
    command: -c 'mkdir -p /data/langfuse && minio server --address ":9000" --console-address ":9001" /data'
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minio}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-miniosecret}
    ports:
      - "127.0.0.1:9090:9000"
      - "127.0.0.1:9091:9001"
    volumes:
      - langfuse_minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: >
      sh -c 'redis-server --appendonly yes --requirepass $${REDIS_AUTH}'
    environment:
      REDIS_AUTH: ${REDIS_AUTH:-redis}
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - langfuse_redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  postgres:
    image: postgres:${POSTGRES_VERSION:-17}-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: ${POSTGRES_DB:-postgres}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - langfuse_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

volumes:
  langfuse_clickhouse_data:
    driver: local
  langfuse_minio_data:
    driver: local
  langfuse_redis_data:
    driver: local
  langfuse_postgres_data:
    driver: local
```

- [ ] **Step 2: Verify YAML is valid**

Run: `docker compose -f docker-compose.langfuse.yml config`
Expected: No errors, compose config printed.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.langfuse.yml
git commit -m "feat: add local Langfuse Docker Compose stack"
```

---

### Task 2: Create .env.langfuse.example

**Files:**
- Create: `.env.langfuse.example`

- [ ] **Step 1: Write secrets template**

```
# Langfuse Local Stack Secrets
# Copy this file to .env.langfuse and change ALL default values.
# Never commit .env.langfuse.

# Generate with: openssl rand -hex 32
SALT=salt

# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

# Generate with: openssl rand -hex 32
NEXTAUTH_SECRET=secret

# Postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=postgres

# ClickHouse
CLICKHOUSE_USER=clickhouse
CLICKHOUSE_PASSWORD=clickhouse

# Redis
REDIS_AUTH=redis
REDIS_CONNECTION_STRING=redis://:redis@redis:6379

# MinIO
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=miniosecret

# S3 buckets (point at MinIO above)
LANGFUSE_S3_EVENT_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_EVENT_UPLOAD_REGION=auto
LANGFUSE_S3_EVENT_UPLOAD_ACCESS_KEY_ID=minio
LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY=miniosecret
LANGFUSE_S3_EVENT_UPLOAD_ENDPOINT=http://minio:9000
LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE=true
LANGFUSE_S3_EVENT_UPLOAD_PREFIX=events/
LANGFUSE_S3_MEDIA_UPLOAD_BUCKET=langfuse
LANGFUSE_S3_MEDIA_UPLOAD_REGION=auto
LANGFUSE_S3_MEDIA_UPLOAD_ACCESS_KEY_ID=minio
LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY=miniosecret
LANGFUSE_S3_MEDIA_UPLOAD_ENDPOINT=http://minio:9000
LANGFUSE_S3_MEDIA_UPLOAD_FORCE_PATH_STYLE=true
LANGFUSE_S3_MEDIA_UPLOAD_PREFIX=media/

# Worker
LANGFUSE_WORKER_PASSWORD=worker

# Telemetry
TELEMETRY_ENABLED=true

# Experimental features
LANGFUSE_ENABLE_EXPERIMENTAL_FEATURES=false

# ClickHouse cluster
CLICKHOUSE_CLUSTER_ENABLED=false
```

- [ ] **Step 2: Commit**

```bash
git add .env.langfuse.example
git commit -m "chore: add .env.langfuse.example for local Langfuse secrets"
```

---

### Task 3: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add commented local Langfuse vars**

Replace the existing `.env.example` content with:

```
OPENROUTER_API_KEY=sk-or-...

# Cloud Langfuse (default) — get keys from https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com

# Local Langfuse (optional — uncomment to use self-hosted stack)
# See docs/langfuse-local-setup.md for Docker Compose instructions.
# LANGFUSE_PUBLIC_KEY=pk-lf-...
# LANGFUSE_SECRET_KEY=sk-lf-...
# LANGFUSE_HOST=http://localhost:3000
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: update .env.example with local Langfuse vars"
```

---

### Task 4: Create docs/langfuse-local-setup.md

**Files:**
- Create: `docs/langfuse-local-setup.md`

- [ ] **Step 1: Write setup guide**

```markdown
# Local Langfuse Setup

Self-host Langfuse traces on your machine for development. No cloud account required.

## Prerequisites

- Docker Engine 20.x+
- Docker Compose v2
- ~4 GB RAM, 20 GB free disk

## 1. Configure Secrets

```bash
cp .env.langfuse.example .env.langfuse
# Edit .env.langfuse — change ALL default passwords/keys.
# Generate hex values with: openssl rand -hex 32
```

## 2. Start Stack

```bash
docker compose -f docker-compose.langfuse.yml up -d
```

Wait 1–3 minutes for ClickHouse init. Check status:

```bash
docker compose -f docker-compose.langfuse.yml ps
```

All services show `healthy` before proceeding.

## 3. Create Account & Project

1. Open http://localhost:3000
2. Sign up (any email — local only)
3. Create a new project
4. Go to Project Settings → API Keys
5. Copy `Public Key` (starts with `pk-lf-`) and `Secret Key` (starts with `sk-lf-`)

## 4. Point App at Local Langfuse

In your app `.env` (or shell env):

```
LANGFUSE_HOST=http://localhost:3000
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
```

Or uncomment the local section in `.env.example` and copy to `.env`.

## 5. Enable in App

Open the app → Settings → General → toggle "Enable Langfuse Tracing" ON.

Send a chat message. Traces appear at http://localhost:3000 under your project.

## Stop / Reset

```bash
# Stop
docker compose -f docker-compose.langfuse.yml down

# Stop and wipe all data
docker compose -f docker-compose.langfuse.yml down -v
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Port 3000 in use | Free the port or edit `docker-compose.langfuse.yml` ports |
| Services stuck `starting` | Wait longer — ClickHouse first boot is slow |
| Traces not appearing | Verify `LANGFUSE_HOST` env var is set before starting app |
```

- [ ] **Step 2: Commit**

```bash
git add docs/langfuse-local-setup.md
git commit -m "docs: add local Langfuse setup guide"
```

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add local Langfuse section**

Find the "## Agent Home Directory" section (or another suitable place near the top) and insert after it:

```markdown
## Local Langfuse (Development Only)

The app can send traces to a self-hosted Langfuse instance instead of cloud.langfuse.com.
This is purely a developer convenience — the app does not manage Docker containers.

- Compose file: `docker-compose.langfuse.yml` (6-service official v3 stack)
- Setup guide: `docs/langfuse-local-setup.md`
- Dashboard: http://localhost:3000
- Env vars: `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document local Langfuse in CLAUDE.md"
```

---

### Task 6: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: Zero errors.

- [ ] **Step 2: Run checks**

Run: `bun run check`
Expected: Clean.

- [ ] **Step 3: Verify compose syntax**

Run: `docker compose -f docker-compose.langfuse.yml config > /dev/null`
Expected: Silent success (exit 0).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.langfuse.yml .env.langfuse.example .env.example docs/langfuse-local-setup.md CLAUDE.md
git commit -m "feat: local Langfuse Docker Compose stack with docs"
```

---

## Self-Review

**Spec coverage check:**
- `docker-compose.langfuse.yml` with 6 services — Task 1
- `.env.langfuse.example` with all secrets — Task 2
- `.env.example` updated with commented local vars — Task 3
- Setup guide — Task 4
- `CLAUDE.md` updated — Task 5
- Zero runtime code changes — verified (no tasks touching `src/`)

**Placeholder scan:** No TBD, TODO, or vague steps. All code blocks present.

**Type consistency:** N/A — no code changes, only config and docs.
