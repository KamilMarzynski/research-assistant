# Run 2 Design Spec — Types, DB, Services, Event Bus

**Date:** 2026-04-18  
**Scope:** Groups 5, 5b, 6, 7 from the implementation roadmap  
**Depends on:** Run 1 scaffold (complete)  
**Blocks:** Run 3 (verification + git hygiene)

---

## Goals

- Define all shared domain types used across main/renderer/preload
- Introduce `@libsql/client` + Drizzle ORM as the DB layer (replaces planned `bun:sqlite`)
- Establish repository interfaces and Drizzle implementations for all three entities
- Wire services via TSyringe DI container with a clean bootstrap sequence
- Add typed event bus for future main-process internal events (research signals)
- Set up Vitest with >90% coverage thresholds

---

## Non-Goals (deferred)

- Mastra memory / `LibSQLStore` — Run 7
- Semantic search on messages — Run 7
- `ModelPreset` DB table — Run 5 (hardcoded constants for now)
- Obsidian artifact sync — Run 6/8
- Backend / cross-machine sync — future (repo interfaces are the swap seam)
- Renderer/UI tests — Run 4+
- Real research orchestration — Run 6

---

## Section 1: Shared Types

**Location:** `src/shared/types/`

All types shared across the three Electron processes. Dates are `Date` objects in the domain layer; serialized to ISO strings at the IPC boundary.

```ts
// project.ts
export type Project = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ModelPreset = {
  id: string;
  name: string;
  provider: 'openrouter';
  modelId: string;
};

// message.ts
export type MessageRole = 'user' | 'assistant' | 'system';

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
};

// artifact.ts
export type Artifact = {
  id: string;
  projectId: string;
  title: string;
  filePath: string;  // absolute path on disk
  createdAt: Date;
};

// research.ts — ephemeral, never persisted to DB
export type ResearchStatus = 'pending' | 'running' | 'done' | 'failed';

export type ResearchTask = {
  id: string;
  projectId: string;
  query: string;
  status: ResearchStatus;
  startedAt: Date;
};
```

`src/shared/types/index.ts` is a barrel re-export of all types. IDs generated with `nanoid` at the repository layer.

---

## Section 2: Database Layer

### Driver

`@libsql/client` + `drizzle-orm` (not `bun:sqlite`). Reason: Mastra's `LibSQLStore` (Run 7) also uses `@libsql/client` — unified driver, no WAL locking edge cases, no `drizzle-kit` driver conflict.

**DB file:** `app.getPath('userData')/research-assistant.db`  
Both Drizzle and future Mastra `LibSQLStore` point to this file. Mastra uses `mastra_*`-prefixed tables — no collision with app tables.

### Schema (`src/main/db/schema.ts`)

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const messages = sqliteTable('messages', {
  id:        text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  role:      text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content:   text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const artifacts = sqliteTable('artifacts', {
  id:        text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  title:     text('title').notNull(),
  filePath:  text('file_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

### Client (`src/main/db/client.ts`)

Creates `@libsql/client` with `url: file:<dbPath>`, wraps with `drizzle()`. Enables WAL mode via `PRAGMA journal_mode=WAL` on first connection.

Exports a typed `DrizzleDB` type alias used as the injection token value.

### Migrations

`drizzle-kit generate` produces SQL files into `src/main/db/migrations/`.  
`migrate()` from `drizzle-orm/libsql/migrator` runs on boot — idempotent, runs before any service initializes.

`drizzle.config.ts` at project root points to `src/main/db/schema.ts` and `src/main/db/migrations/`.

---

## Section 3: DI Container + Bootstrap

**Library:** `tsyringe` + `reflect-metadata`.  
`tsconfig.node.json` must have `experimentalDecorators: true` and `emitDecoratorMetadata: true`.

### Bootstrap (`src/main/bootstrap.ts`)

```ts
export async function bootstrap(): Promise<Container> {
  const dbPath = join(app.getPath('userData'), 'research-assistant.db');
  const db = await createDatabase(dbPath);
  await runMigrations(db);

  const container = new Container();

  container.registerInstance(DB_TOKEN, db);

  container.register<IProjectRepository>(PROJECT_REPO_TOKEN,  { useClass: DrizzleProjectRepository });
  container.register<IMessageRepository>(MESSAGE_REPO_TOKEN,  { useClass: DrizzleMessageRepository });
  container.register<IArtifactRepository>(ARTIFACT_REPO_TOKEN, { useClass: DrizzleArtifactRepository });

  container.registerSingleton<ProjectService>(ProjectService);
  container.registerSingleton<MessageService>(MessageService);
  container.registerSingleton<ArtifactService>(ArtifactService);
  container.registerSingleton<ResearchService>(ResearchService);
  container.registerSingleton<FileService>(FileService);
  container.registerSingleton<EventBus>(EventBus);

  return container;
}
```

### Updated `src/main/index.ts`

```ts
app.whenReady().then(async () => {
  const container = await bootstrap();
  const win = createWindow();
  registerIpcHandlers(win, container);
  // …
});
```

### DI Tokens (`src/main/di/tokens.ts`)

Typed injection tokens for all interfaces:

```ts
import type { InjectionToken } from 'tsyringe';

export const DB_TOKEN:            InjectionToken<DrizzleDB>            = Symbol('DrizzleDB');
export const PROJECT_REPO_TOKEN:  InjectionToken<IProjectRepository>   = Symbol('IProjectRepository');
export const MESSAGE_REPO_TOKEN:  InjectionToken<IMessageRepository>   = Symbol('IMessageRepository');
export const ARTIFACT_REPO_TOKEN: InjectionToken<IArtifactRepository>  = Symbol('IArtifactRepository');
```

---

## Section 4: Repository Pattern

**Location:** `src/main/repositories/`

### Interfaces

```ts
interface IProjectRepository {
  create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  delete(id: string): Promise<void>;
}

interface IMessageRepository {
  create(data: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  listByProject(projectId: string): Promise<Message[]>;
  getRecent(projectId: string, n: number): Promise<Message[]>;
}

interface IArtifactRepository {
  create(data: Omit<Artifact, 'id' | 'createdAt'>): Promise<Artifact>;
  listByProject(projectId: string): Promise<Artifact[]>;
  get(id: string): Promise<Artifact | null>;
}
```

**Drizzle implementations** in `src/main/repositories/drizzle/`. Each receives `DrizzleDB` via `@inject(DB_TOKEN)`. IDs generated with `nanoid()` inside `create()`.

**Run 7 swap path:** `IMessageRepository` implementation can be replaced with a Mastra-backed adapter without touching services or IPC handlers.

---

## Section 5: Services

**Location:** `src/main/services/`

Each service is `@injectable()`. Cross-domain calls go service→service, never service→foreign-repository.

Custom `NotFoundError` class thrown by `get*` methods when entity doesn't exist — caught at the IPC boundary and mapped to a typed error response.

```ts
// ProjectService
async createProject(name: string): Promise<Project>
async listProjects(): Promise<Project[]>
async getProject(id: string): Promise<Project>   // throws NotFoundError
async deleteProject(id: string): Promise<void>

// MessageService
async addMessage(data: Omit<Message, 'id' | 'createdAt'>): Promise<Message>
async getHistory(projectId: string): Promise<Message[]>
async getRecentContext(projectId: string, n: number): Promise<Message[]>

// ArtifactService
async saveArtifact(data: Omit<Artifact, 'id' | 'createdAt'>): Promise<Artifact>
async listArtifacts(projectId: string): Promise<Artifact[]>

// FileService — no DB, pure filesystem
async readFile(path: string): Promise<string>
async writeFile(path: string, content: string): Promise<void>
async listFiles(dir: string): Promise<string[]>
watchDirectory(dir: string, cb: (event: string, file: string) => void): () => void

// ResearchService — stub
async startResearch(projectId: string, query: string): Promise<ResearchTask>
// throws NotImplementedError until Run 6
```

---

## Section 6: Event Bus

**Location:** `src/main/event-bus.ts`

Main-process internal only. Never crosses IPC directly — a future IPC forwarder (Run 6) will subscribe and call `win.webContents.send`.

```ts
type AppEvent =
  | { type: 'research:started';  payload: { taskId: string; projectId: string; query: string } }
  | { type: 'research:progress'; payload: { taskId: string; message: string } }
  | { type: 'research:complete'; payload: { taskId: string; artifactId: string } }
  | { type: 'research:failed';   payload: { taskId: string; error: string } };

@singleton()
class EventBus {
  emit<T extends AppEvent>(event: T): void;
  on<K extends AppEvent['type']>(
    type: K,
    handler: (payload: Extract<AppEvent, { type: K }>['payload']) => void
  ): () => void;  // returns unsubscribe fn
}
```

No CRUD events on the bus — those flows are linear (IPC handler → service → repo) and need no pub/sub.

---

## Section 7: Test Infrastructure

**Runner:** Vitest  
**Coverage:** `@vitest/coverage-v8`, threshold 90% on branches/functions/lines/statements

### Structure

```
src/main/
  services/__tests__/        unit — mocked repositories
  repositories/__tests__/    integration — in-memory libsql
  event-bus.test.ts
tests/
  setup.ts                   global: imports reflect-metadata
```

### Unit tests (services)

TSyringe container built per test with `vi.fn()` mock implementations bound to repository tokens. No DB, no filesystem. Fast.

### Integration tests (repositories)

`createClient({ url: ':memory:' })` — real libsql, real Drizzle schema, real migrations. Each test gets a fresh in-memory DB. Exercises actual SQL including cascades and ordering.

### Coverage config (`vitest.config.ts`)

```ts
coverage: {
  provider: 'v8',
  thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 },
  exclude: ['src/renderer/**', 'src/preload/**', '**/*.d.ts', '**/index.ts'],
}
```

Renderer/UI tests added in Run 4 when real components exist. E2E via agent-browser at that point.

---

## File Map

```
src/
  shared/
    types/
      project.ts
      message.ts
      artifact.ts
      research.ts
      index.ts
  main/
    di/
      tokens.ts
    db/
      schema.ts
      client.ts
      migrate.ts
      migrations/           ← generated by drizzle-kit
    repositories/
      IProjectRepository.ts
      IMessageRepository.ts
      IArtifactRepository.ts
      drizzle/
        DrizzleProjectRepository.ts
        DrizzleMessageRepository.ts
        DrizzleArtifactRepository.ts
    services/
      ProjectService.ts
      MessageService.ts
      ArtifactService.ts
      ResearchService.ts
      FileService.ts
      errors.ts             ← NotFoundError, NotImplementedError
    event-bus.ts
    bootstrap.ts
    ipc-handlers.ts         ← updated: receives container
    index.ts                ← updated: calls bootstrap()
drizzle.config.ts
tests/
  setup.ts
```

---

## Dependencies to Install

```bash
bun add @libsql/client drizzle-orm nanoid tsyringe reflect-metadata
bun add -d drizzle-kit @vitest/coverage-v8
```

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| DB driver | `@libsql/client` | Unifies with future Mastra `LibSQLStore`; avoids WAL locking edge cases |
| DI | TSyringe | Proper IoC, testable, scales to Run 6 without refactor |
| Migration strategy | Auto on boot (`migrate()`) | Single-user desktop, idempotent, zero friction |
| `IMessageRepository` | `create` + `listByProject` + `getRecent(n)` | Sufficient for Runs 2–6; semantic recall lives inside Mastra (Run 7) |
| Event bus scope | Research events only | CRUD flows are linear; bus only needed for async cross-component signals |
| `MessageService` | Yes | Consistent service layer; right seam for Run 6 agent wiring |
| Test coverage | >90% threshold enforced | Non-negotiable project standard |
