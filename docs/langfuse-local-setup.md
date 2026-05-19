# Local Langfuse Setup

This project uses [Langfuse](https://langfuse.com/) for LLM observability. For local development, you can run Langfuse locally using Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running.

## Quick Start

From the project root, run:

```bash
docker compose -f docker-compose.langfuse.yml --env-file .env.langfuse up -d
```

This starts the following services in the background:

| Service | Port | Description |
|---|---|---|
| `langfuse-web` | `3000` | Langfuse UI (http://localhost:3000) |
| `langfuse-worker` | — | Background worker |
| `postgres` | `5432` (localhost only) | Metadata database |
| `clickhouse` | `8123`, `9000` (localhost only) | OLAP database |
| `redis` | `6379` (localhost only) | Queue / cache |
| `minio` | `9090`, `9091` (localhost only) | S3-compatible object storage |

## First-Time Setup

1. Open the Langfuse UI at [http://localhost:3000](http://localhost:3000).
2. Complete the initial setup wizard to create an organization and project.
3. Go to **Project Settings > API Keys** and generate a new key pair.
4. Copy the **Secret Key** and **Public Key**.

## Connecting the App

1. Go to the Scholar app settings.
2. Enable the **Langfuse** toggle.
3. Paste the **Secret Key** and **Public Key**.
4. Set the **Host** to `http://localhost:3000`.
5. Save the settings.

The app will now automatically trace all LLM calls and agent runs to your local Langfuse instance.

## Stopping

To stop the local Langfuse stack:

```bash
docker compose -f docker-compose.langfuse.yml --env-file .env.langfuse down
```

To stop and remove all data (volumes):

```bash
docker compose -f docker-compose.langfuse.yml --env-file .env.langfuse down -v
```

## Configuration

You can customize the stack by creating a `.env.langfuse` file in the project root. See `.env.langfuse.example` for available options.

```bash
cp .env.langfuse.example .env.langfuse
# Edit .env.langfuse with your preferred settings
docker compose -f docker-compose.langfuse.yml --env-file .env.langfuse up -d
```

## Troubleshooting

- **Ports already in use:** If ports `3000`, `5432`, `6379`, `8123`, `9000`, `9090`, or `9091` are already in use, modify the port mappings in `docker-compose.langfuse.yml` or your `.env.langfuse` file.
- **MinIO health check fails:** Ensure you have enough disk space and that the MinIO data directory is writable.
