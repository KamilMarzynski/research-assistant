# Local Langfuse Observability — Design

## Goal

Move Langfuse tracing from cloud-hosted to a fully local Docker Compose stack for development use. The Electron app does **not** manage containers — Docker is started manually by the developer.

## Scope

- Add a `docker-compose.langfuse.yml` that runs the official 6-service Langfuse v3 stack.
- Provide `.env.langfuse.example` with all required secrets.
- Update `.env.example` to show local Langfuse vars (commented).
- Document the exact setup steps (sign up, create project, copy keys, point app).
- No runtime code changes: `model-factory.ts` already supports `LANGFUSE_HOST` env var.
- No UI changes: toggle stays boolean, keys stay env-driven.

## Architecture

### Docker Compose Services

| Service | Purpose | Exposed Port | Bind Address |
|---|---|---|---|
| `langfuse-web` | Dashboard + API | `3000` | `0.0.0.0` |
| `langfuse-worker` | Background jobs | `3030` | `127.0.0.1` |
| `postgres` | Transactional DB | `5432` | `127.0.0.1` |
| `clickhouse` | Analytics / traces | `8123`, `9000` | `127.0.0.1` |
| `redis` | Queue + cache | `6379` | `127.0.0.1` |
| `minio` | Blob storage | `9090`, `9091` | `0.0.0.0` |

All non-web services bound to localhost for security. Only `langfuse-web` (UI) and `minio` (optional S3 UI) are reachable externally.

### File Layout

```
repo-root/
  docker-compose.langfuse.yml   # local dev stack
  .env.langfuse.example         # secrets template
  .env.example                  # updated with local Langfuse vars (commented)
  docs/langfuse-local-setup.md  # step-by-step guide
```

### Environment Variables

`.env.langfuse.example` contains:

- `SALT` — Langfuse internal salt
- `ENCRYPTION_KEY` — AES key for sensitive data
- `NEXTAUTH_SECRET` — NextAuth.js secret
- `DATABASE_URL` — Postgres connection string
- `CLICKHOUSE_URL` — ClickHouse connection string
- `CLICKHOUSE_PASSWORD` — ClickHouse auth
- `REDIS_AUTH` — Redis password
- `MINIO_ROOT_PASSWORD` — MinIO admin password
- `LANGFUSE_S3_EVENT_UPLOAD_*` — MinIO bucket config
- `LANGFUSE_S3_MEDIA_UPLOAD_*` — MinIO media bucket config

`.env.example` gets new commented entries:

```
# Local Langfuse (uncomment to use self-hosted instead of cloud)
# LANGFUSE_HOST=http://localhost:3000
# LANGFUSE_PUBLIC_KEY=pk-lf-...
# LANGFUSE_SECRET_KEY=sk-lf-...
```

### App Integration

`model-factory.ts` already checks `process.env.LANGFUSE_HOST`. If set to `http://localhost:3000`, the proxy base URL becomes `http://localhost:3000/api/proxy/openai/v1`. Zero code changes.

### Setup Flow

1. Developer copies `.env.langfuse.example` → `.env.langfuse` and fills secrets.
2. Runs `docker compose -f docker-compose.langfuse.yml up -d`.
3. Waits ~1–3 min for ClickHouse init.
4. Opens `http://localhost:3000`, creates account + project.
5. Copies `pk-lf-...` / `sk-lf-...` from project settings.
6. Sets `LANGFUSE_HOST=http://localhost:3000` and keys in app `.env` (or local shell env).
7. Enables Langfuse toggle in app Settings.

## Error Handling / Edge Cases

| Case | Behavior |
|---|---|
| Langfuse container down | `model-factory.ts` falls back to direct OpenRouter (same as cloud key missing) |
| Wrong keys | Langfuse proxy returns 401; Pi SDK retries/fails as usual |
| Port 3000 already in use | Docker Compose startup fails; developer must free port |
| First boot slow | Documented in setup guide; normal for ClickHouse init |

## Testing

- Manual: run compose, create project, verify traces appear in dashboard after sending a chat message.
- Automated: none — dev tooling, no runtime UI to test.

## Dependencies

- Docker Engine 20.x+
- Docker Compose v2
- ~4 GB RAM, 20 GB disk
