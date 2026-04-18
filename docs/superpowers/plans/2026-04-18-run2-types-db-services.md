# Run 2 — Types, DB, Services, Event Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared domain types, `@libsql/client` + Drizzle ORM database layer, repository interfaces with Drizzle implementations, TSyringe DI container, services, typed event bus, and Vitest test infrastructure — leaving the app runnable and fully tested.

**Architecture:** TSyringe DI container wired in `bootstrap.ts`, resolved before IPC handlers register. All services are `@injectable()`, receive repositories via constructor injection using typed Symbol tokens. Repositories implement typed interfaces, enabling clean unit testing with mock implementations.

**Tech Stack:** `@libsql/client`, `drizzle-orm`, `tsyringe`, `reflect-metadata`, `vitest`, `@vitest/coverage-v8`, `unplugin-swc`, `@swc/core`

---

## File Map

**New files:**
```
src/shared/types/project.ts
src/shared/types/message.ts
src/shared/types/artifact.ts
src/shared/types/research.ts
src/shared/types/index.ts

src/main/di/tokens.ts

src/main/db/schema.ts
src/main/db/client.ts
src/main/db/migrate.ts

src/main/repositories/IProjectRepository.ts
src/main/repositories/IMessageRepository.ts
src/main/repositories/IArtifactRepository.ts
src/main/repositories/drizzle/DrizzleProjectRepository.ts
src/main/repositories/drizzle/DrizzleMessageRepository.ts
src/main/repositories/drizzle/DrizzleArtifactRepository.ts

src/main/services/errors.ts
src/main/services/ProjectService.ts
src/main/services/MessageService.ts
src/main/services/ArtifactService.ts
src/main/services/ResearchService.ts
src/main/services/FileService.ts

src/main/event-bus.ts
src/main/bootstrap.ts

tests/setup.ts
vitest.config.ts
drizzle.config.ts
```

**Modified files:**
```
src/main/index.ts          — import reflect-metadata, call bootstrap(), pass container
src/main/ipc-handlers.ts   — receive Container, resolve services, replace mock returns
tsconfig.node.json          — add experimentalDecorators + emitDecoratorMetadata
package.json                — add test + db scripts
```

---

## Task 1: Install Dependencies and Configure Toolchain

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.node.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`

- [ ] **Step 1: Install runtime dependencies**

```bash
bun add @libsql/client drizzle-orm tsyringe reflect-metadata
```

Expected: packages added to `dependencies` in `package.json`.

- [ ] **Step 2: Install dev dependencies**

```bash
bun add -d drizzle-kit vitest @vitest/coverage-v8 @swc/core unplugin-swc
```

Expected: packages added to `devDependencies` in `package.json`.

- [ ] **Step 3: Add scripts to `package.json`**

Open `package.json` and add to the `"scripts"` block:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"db:generate": "drizzle-kit generate"
```

Final scripts block:
```json
"scripts": {
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "preview": "electron-vite preview",
  "lint": "biome lint ./src",
  "format": "biome format --write ./src",
  "check": "biome check --write --no-errors-on-unmatched ./src",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "db:generate": "drizzle-kit generate"
}
```

- [ ] **Step 4: Enable decorator metadata in `tsconfig.node.json`**

Replace the contents of `tsconfig.node.json` with:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "module": "CommonJS",
    "moduleResolution": "node10",
    "lib": ["ES2022"],
    "types": ["node"],
    "outDir": "out/main",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "electron.vite.config.ts"
  ]
}
```

- [ ] **Step 5: Create `tests/setup.ts`**

```ts
import 'reflect-metadata';
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: {
    alias: {
      '@main': resolve('./src/main'),
      '@shared': resolve('./src/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/__tests__/**/*.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 },
      include: ['src/main/**'],
      exclude: ['**/*.d.ts', '**/index.ts', 'src/main/index.ts'],
    },
  },
});
```

- [ ] **Step 7: Run typecheck to confirm no breakage**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.node.json vitest.config.ts tests/setup.ts
git commit -m "chore: add test infrastructure and decorator support"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/shared/types/project.ts`
- Create: `src/shared/types/message.ts`
- Create: `src/shared/types/artifact.ts`
- Create: `src/shared/types/research.ts`
- Create: `src/shared/types/index.ts`

- [ ] **Step 1: Create `src/shared/types/project.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/shared/types/message.ts`**

```ts
export type MessageRole = 'user' | 'assistant' | 'system';

export type Message = {
  id: string;
  projectId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
};
```

- [ ] **Step 3: Create `src/shared/types/artifact.ts`**

```ts
export type Artifact = {
  id: string;
  projectId: string;
  title: string;
  filePath: string;
  createdAt: Date;
};
```

- [ ] **Step 4: Create `src/shared/types/research.ts`**

```ts
export type ResearchStatus = 'pending' | 'running' | 'done' | 'failed';

export type ResearchTask = {
  id: string;
  projectId: string;
  query: string;
  status: ResearchStatus;
  startedAt: Date;
};
```

- [ ] **Step 5: Create `src/shared/types/index.ts`**

```ts
export * from './project';
export * from './message';
export * from './artifact';
export * from './research';
```

- [ ] **Step 6: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types/
git commit -m "feat: add shared domain types"
```

---

## Task 3: Database Schema, Client, and Migrations

**Files:**
- Create: `src/main/db/schema.ts`
- Create: `src/main/db/client.ts`
- Create: `src/main/db/migrate.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create `src/main/db/schema.ts`**

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  filePath: text('file_path').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

- [ ] **Step 2: Create `src/main/db/client.ts`**

```ts
import { createClient } from '@libsql/client';
import { type LibSQLDatabase, drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

export type DrizzleDB = LibSQLDatabase<typeof schema>;

export async function createDatabase(dbPath: string): Promise<DrizzleDB> {
  const client = createClient({ url: `file:${dbPath}` });
  await client.execute('PRAGMA journal_mode=WAL');
  return drizzle(client, { schema });
}
```

- [ ] **Step 3: Create `src/main/db/migrate.ts`**

Uses inline `CREATE TABLE IF NOT EXISTS` — idempotent on every boot, no SQL files to copy at build time.

```ts
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from './client';

export async function runMigrations(db: DrizzleDB): Promise<void> {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
}
```

- [ ] **Step 4: Create `drizzle.config.ts`** (for `db:generate` introspection only)

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/main/db/schema.ts',
  out: './src/main/db/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: 'file:./dev.db',
  },
});
```

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/db/ drizzle.config.ts
git commit -m "feat: add db schema, client, and migration runner"
```

---

## Task 4: DI Tokens and Repository Interfaces

**Files:**
- Create: `src/main/di/tokens.ts`
- Create: `src/main/repositories/IProjectRepository.ts`
- Create: `src/main/repositories/IMessageRepository.ts`
- Create: `src/main/repositories/IArtifactRepository.ts`

- [ ] **Step 1: Create `src/main/repositories/IProjectRepository.ts`**

```ts
import type { Project } from '../../shared/types';

export interface IProjectRepository {
  create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project>;
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | null>;
  delete(id: string): Promise<void>;
}
```

- [ ] **Step 2: Create `src/main/repositories/IMessageRepository.ts`**

```ts
import type { Message } from '../../shared/types';

export interface IMessageRepository {
  create(data: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  listByProject(projectId: string): Promise<Message[]>;
  getRecent(projectId: string, n: number): Promise<Message[]>;
}
```

- [ ] **Step 3: Create `src/main/repositories/IArtifactRepository.ts`**

```ts
import type { Artifact } from '../../shared/types';

export interface IArtifactRepository {
  create(data: Omit<Artifact, 'id' | 'createdAt'>): Promise<Artifact>;
  listByProject(projectId: string): Promise<Artifact[]>;
  get(id: string): Promise<Artifact | null>;
}
```

- [ ] **Step 4: Create `src/main/di/tokens.ts`**

```ts
import type { InjectionToken } from 'tsyringe';
import type { DrizzleDB } from '../db/client';
import type { IProjectRepository } from '../repositories/IProjectRepository';
import type { IMessageRepository } from '../repositories/IMessageRepository';
import type { IArtifactRepository } from '../repositories/IArtifactRepository';

export const DB_TOKEN: InjectionToken<DrizzleDB> = Symbol('DrizzleDB');
export const PROJECT_REPO_TOKEN: InjectionToken<IProjectRepository> = Symbol('IProjectRepository');
export const MESSAGE_REPO_TOKEN: InjectionToken<IMessageRepository> = Symbol('IMessageRepository');
export const ARTIFACT_REPO_TOKEN: InjectionToken<IArtifactRepository> = Symbol('IArtifactRepository');
```

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/repositories/IProjectRepository.ts src/main/repositories/IMessageRepository.ts src/main/repositories/IArtifactRepository.ts src/main/di/tokens.ts
git commit -m "feat: add DI tokens and repository interfaces"
```

---

## Task 5: DrizzleProjectRepository (TDD)

**Files:**
- Create: `src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts`
- Create: `src/main/repositories/drizzle/DrizzleProjectRepository.ts`

- [ ] **Step 1: Create test helper `tests/helpers/db.ts`**

```ts
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../../src/main/db/schema';
import { runMigrations } from '../../src/main/db/migrate';
import type { DrizzleDB } from '../../src/main/db/client';

export async function createTestDatabase(): Promise<DrizzleDB> {
  const client = createClient({ url: 'file::memory:' });
  const db = drizzle(client, { schema });
  await runMigrations(db);
  return db;
}
```

- [ ] **Step 2: Write failing tests**

Create `src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../../../../tests/helpers/db';
import { DrizzleProjectRepository } from '../DrizzleProjectRepository';
import type { DrizzleDB } from '../../../db/client';

describe('DrizzleProjectRepository', () => {
  let db: DrizzleDB;
  let repo: DrizzleProjectRepository;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new DrizzleProjectRepository(db);
  });

  describe('create', () => {
    it('returns a project with generated id and timestamps', async () => {
      const project = await repo.create({ name: 'My Project' });

      expect(project.id).toBeTypeOf('string');
      expect(project.id).toHaveLength(36); // UUID v4
      expect(project.name).toBe('My Project');
      expect(project.createdAt).toBeInstanceOf(Date);
      expect(project.updatedAt).toBeInstanceOf(Date);
    });

    it('persists the project so it appears in list()', async () => {
      await repo.create({ name: 'Alpha' });
      await repo.create({ name: 'Beta' });

      const list = await repo.list();
      expect(list).toHaveLength(2);
    });
  });

  describe('list', () => {
    it('returns empty array when no projects exist', async () => {
      expect(await repo.list()).toEqual([]);
    });

    it('returns projects ordered by createdAt descending', async () => {
      await repo.create({ name: 'First' });
      await repo.create({ name: 'Second' });

      const list = await repo.list();
      expect(list[0].name).toBe('Second');
      expect(list[1].name).toBe('First');
    });
  });

  describe('get', () => {
    it('returns the project by id', async () => {
      const created = await repo.create({ name: 'Find Me' });
      const found = await repo.get(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.name).toBe('Find Me');
    });

    it('returns null when project does not exist', async () => {
      expect(await repo.get('non-existent-id')).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes the project from the database', async () => {
      const project = await repo.create({ name: 'Delete Me' });
      await repo.delete(project.id);

      expect(await repo.get(project.id)).toBeNull();
    });

    it('does not throw when deleting a non-existent id', async () => {
      await expect(repo.delete('ghost-id')).resolves.toBeUndefined();
    });
  });
});
```

- [ ] **Step 3: Run tests — confirm they fail**

```bash
bun run test src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts
```

Expected: FAIL — `DrizzleProjectRepository` not found.

- [ ] **Step 4: Implement `DrizzleProjectRepository`**

Create `src/main/repositories/drizzle/DrizzleProjectRepository.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { DB_TOKEN } from '../../di/tokens';
import type { DrizzleDB } from '../../db/client';
import { projects } from '../../db/schema';
import type { IProjectRepository } from '../IProjectRepository';
import type { Project } from '../../../shared/types';

@injectable()
export class DrizzleProjectRepository implements IProjectRepository {
  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async create(data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const now = new Date();
    const project: Project = {
      id: crypto.randomUUID(),
      name: data.name,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(projects).values({
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
    return project;
  }

  async list(): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .orderBy(desc(projects.createdAt));
    return rows.map(this.rowToProject);
  }

  async get(id: string): Promise<Project | null> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    return rows[0] ? this.rowToProject(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  private rowToProject(row: typeof projects.$inferSelect): Project {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

- [ ] **Step 5: Run tests — confirm they pass**

```bash
bun run test src/main/repositories/drizzle/__tests__/DrizzleProjectRepository.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/helpers/ src/main/repositories/drizzle/
git commit -m "feat: add DrizzleProjectRepository with integration tests"
```

---

## Task 6: DrizzleMessageRepository (TDD)

**Files:**
- Create: `src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts`
- Create: `src/main/repositories/drizzle/DrizzleMessageRepository.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../../../../tests/helpers/db';
import { DrizzleProjectRepository } from '../DrizzleProjectRepository';
import { DrizzleMessageRepository } from '../DrizzleMessageRepository';
import type { DrizzleDB } from '../../../db/client';

describe('DrizzleMessageRepository', () => {
  let db: DrizzleDB;
  let repo: DrizzleMessageRepository;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new DrizzleMessageRepository(db);
    // Messages require an existing project (FK constraint)
    const projectRepo = new DrizzleProjectRepository(db);
    const project = await projectRepo.create({ name: 'Test Project' });
    projectId = project.id;
  });

  describe('create', () => {
    it('returns a message with generated id and timestamp', async () => {
      const msg = await repo.create({ projectId, role: 'user', content: 'Hello' });

      expect(msg.id).toBeTypeOf('string');
      expect(msg.id).toHaveLength(36);
      expect(msg.projectId).toBe(projectId);
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('listByProject', () => {
    it('returns messages in ascending chronological order', async () => {
      await repo.create({ projectId, role: 'user', content: 'First' });
      await repo.create({ projectId, role: 'assistant', content: 'Second' });

      const msgs = await repo.listByProject(projectId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('First');
      expect(msgs[1].content).toBe('Second');
    });

    it('returns empty array for project with no messages', async () => {
      expect(await repo.listByProject(projectId)).toEqual([]);
    });

    it('only returns messages belonging to the given project', async () => {
      const projectRepo = new DrizzleProjectRepository(db);
      const other = await projectRepo.create({ name: 'Other' });

      await repo.create({ projectId, role: 'user', content: 'Mine' });
      await repo.create({ projectId: other.id, role: 'user', content: 'Theirs' });

      const msgs = await repo.listByProject(projectId);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('Mine');
    });
  });

  describe('getRecent', () => {
    it('returns the n most recent messages in ascending order', async () => {
      await repo.create({ projectId, role: 'user', content: 'A' });
      await repo.create({ projectId, role: 'assistant', content: 'B' });
      await repo.create({ projectId, role: 'user', content: 'C' });

      const recent = await repo.getRecent(projectId, 2);
      expect(recent).toHaveLength(2);
      // Most recent 2 (B, C) returned in ascending order
      expect(recent[0].content).toBe('B');
      expect(recent[1].content).toBe('C');
    });

    it('returns all messages when n exceeds the total count', async () => {
      await repo.create({ projectId, role: 'user', content: 'Only one' });
      expect(await repo.getRecent(projectId, 10)).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts
```

Expected: FAIL — `DrizzleMessageRepository` not found.

- [ ] **Step 3: Implement `DrizzleMessageRepository`**

Create `src/main/repositories/drizzle/DrizzleMessageRepository.ts`:

```ts
import { asc, desc, eq } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { DB_TOKEN } from '../../di/tokens';
import type { DrizzleDB } from '../../db/client';
import { messages } from '../../db/schema';
import type { IMessageRepository } from '../IMessageRepository';
import type { Message, MessageRole } from '../../../shared/types';

@injectable()
export class DrizzleMessageRepository implements IMessageRepository {
  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async create(data: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    const message: Message = {
      id: crypto.randomUUID(),
      projectId: data.projectId,
      role: data.role,
      content: data.content,
      createdAt: new Date(),
    };
    await this.db.insert(messages).values({
      id: message.id,
      projectId: message.projectId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    });
    return message;
  }

  async listByProject(projectId: string): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.projectId, projectId))
      .orderBy(asc(messages.createdAt));
    return rows.map(this.rowToMessage);
  }

  async getRecent(projectId: string, n: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.projectId, projectId))
      .orderBy(desc(messages.createdAt))
      .limit(n);
    // Fetch newest-first, return in ascending order
    return rows.map(this.rowToMessage).reverse();
  }

  private rowToMessage(row: typeof messages.$inferSelect): Message {
    return {
      id: row.id,
      projectId: row.projectId,
      role: row.role as MessageRole,
      content: row.content,
      createdAt: row.createdAt,
    };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/repositories/drizzle/DrizzleMessageRepository.ts src/main/repositories/drizzle/__tests__/DrizzleMessageRepository.test.ts
git commit -m "feat: add DrizzleMessageRepository with integration tests"
```

---

## Task 7: DrizzleArtifactRepository (TDD)

**Files:**
- Create: `src/main/repositories/drizzle/__tests__/DrizzleArtifactRepository.test.ts`
- Create: `src/main/repositories/drizzle/DrizzleArtifactRepository.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/repositories/drizzle/__tests__/DrizzleArtifactRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../../../../tests/helpers/db';
import { DrizzleProjectRepository } from '../DrizzleProjectRepository';
import { DrizzleArtifactRepository } from '../DrizzleArtifactRepository';
import type { DrizzleDB } from '../../../db/client';

describe('DrizzleArtifactRepository', () => {
  let db: DrizzleDB;
  let repo: DrizzleArtifactRepository;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    repo = new DrizzleArtifactRepository(db);
    const projectRepo = new DrizzleProjectRepository(db);
    const project = await projectRepo.create({ name: 'Test Project' });
    projectId = project.id;
  });

  describe('create', () => {
    it('returns an artifact with generated id and timestamp', async () => {
      const artifact = await repo.create({
        projectId,
        title: 'Research Report',
        filePath: '/home/user/docs/report.md',
      });

      expect(artifact.id).toBeTypeOf('string');
      expect(artifact.id).toHaveLength(36);
      expect(artifact.projectId).toBe(projectId);
      expect(artifact.title).toBe('Research Report');
      expect(artifact.filePath).toBe('/home/user/docs/report.md');
      expect(artifact.createdAt).toBeInstanceOf(Date);
    });
  });

  describe('listByProject', () => {
    it('returns all artifacts for a project', async () => {
      await repo.create({ projectId, title: 'A', filePath: '/a.md' });
      await repo.create({ projectId, title: 'B', filePath: '/b.md' });

      const list = await repo.listByProject(projectId);
      expect(list).toHaveLength(2);
    });

    it('returns empty array when no artifacts exist', async () => {
      expect(await repo.listByProject(projectId)).toEqual([]);
    });

    it('only returns artifacts belonging to the given project', async () => {
      const projectRepo = new DrizzleProjectRepository(db);
      const other = await projectRepo.create({ name: 'Other' });

      await repo.create({ projectId, title: 'Mine', filePath: '/mine.md' });
      await repo.create({ projectId: other.id, title: 'Theirs', filePath: '/theirs.md' });

      const list = await repo.listByProject(projectId);
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe('Mine');
    });
  });

  describe('get', () => {
    it('returns artifact by id', async () => {
      const created = await repo.create({ projectId, title: 'Find Me', filePath: '/x.md' });
      const found = await repo.get(created.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it('returns null for non-existent id', async () => {
      expect(await repo.get('ghost')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/repositories/drizzle/__tests__/DrizzleArtifactRepository.test.ts
```

Expected: FAIL — `DrizzleArtifactRepository` not found.

- [ ] **Step 3: Implement `DrizzleArtifactRepository`**

Create `src/main/repositories/drizzle/DrizzleArtifactRepository.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import { inject, injectable } from 'tsyringe';
import { DB_TOKEN } from '../../di/tokens';
import type { DrizzleDB } from '../../db/client';
import { artifacts } from '../../db/schema';
import type { IArtifactRepository } from '../IArtifactRepository';
import type { Artifact } from '../../../shared/types';

@injectable()
export class DrizzleArtifactRepository implements IArtifactRepository {
  constructor(@inject(DB_TOKEN) private readonly db: DrizzleDB) {}

  async create(data: Omit<Artifact, 'id' | 'createdAt'>): Promise<Artifact> {
    const artifact: Artifact = {
      id: crypto.randomUUID(),
      projectId: data.projectId,
      title: data.title,
      filePath: data.filePath,
      createdAt: new Date(),
    };
    await this.db.insert(artifacts).values({
      id: artifact.id,
      projectId: artifact.projectId,
      title: artifact.title,
      filePath: artifact.filePath,
      createdAt: artifact.createdAt,
    });
    return artifact;
  }

  async listByProject(projectId: string): Promise<Artifact[]> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.projectId, projectId))
      .orderBy(desc(artifacts.createdAt));
    return rows.map(this.rowToArtifact);
  }

  async get(id: string): Promise<Artifact | null> {
    const rows = await this.db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id))
      .limit(1);
    return rows[0] ? this.rowToArtifact(rows[0]) : null;
  }

  private rowToArtifact(row: typeof artifacts.$inferSelect): Artifact {
    return {
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      filePath: row.filePath,
      createdAt: row.createdAt,
    };
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/repositories/drizzle/__tests__/DrizzleArtifactRepository.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/repositories/drizzle/DrizzleArtifactRepository.ts src/main/repositories/drizzle/__tests__/DrizzleArtifactRepository.test.ts
git commit -m "feat: add DrizzleArtifactRepository with integration tests"
```

---

## Task 8: Error Classes

**Files:**
- Create: `src/main/services/errors.ts`

No test task for this one — errors are simple value classes, covered indirectly by service tests.

- [ ] **Step 1: Create `src/main/services/errors.ts`**

```ts
export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} with id "${id}" not found`);
    this.name = 'NotFoundError';
  }
}

export class NotImplementedError extends Error {
  constructor(method: string, availableIn: string) {
    super(`${method} is not implemented yet — available in ${availableIn}`);
    this.name = 'NotImplementedError';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/errors.ts
git commit -m "feat: add NotFoundError and NotImplementedError"
```

---

## Task 9: ProjectService (TDD)

**Files:**
- Create: `src/main/services/__tests__/ProjectService.test.ts`
- Create: `src/main/services/ProjectService.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/__tests__/ProjectService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectService } from '../ProjectService';
import { NotFoundError } from '../errors';
import type { IProjectRepository } from '../../repositories/IProjectRepository';
import type { Project } from '../../../shared/types';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IProjectRepository> = {}): IProjectRepository {
  return {
    create: vi.fn().mockResolvedValue(makeProject()),
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ProjectService', () => {
  let repo: IProjectRepository;
  let service: ProjectService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new ProjectService(repo);
  });

  describe('createProject', () => {
    it('delegates to repo.create with the given name', async () => {
      const project = makeProject({ name: 'New' });
      vi.mocked(repo.create).mockResolvedValue(project);

      const result = await service.createProject('New');

      expect(repo.create).toHaveBeenCalledWith({ name: 'New' });
      expect(result).toEqual(project);
    });
  });

  describe('listProjects', () => {
    it('returns the list from repo.list', async () => {
      const list = [makeProject({ id: 'a' }), makeProject({ id: 'b' })];
      vi.mocked(repo.list).mockResolvedValue(list);

      const result = await service.listProjects();

      expect(result).toEqual(list);
      expect(repo.list).toHaveBeenCalledOnce();
    });
  });

  describe('getProject', () => {
    it('returns the project when found', async () => {
      const project = makeProject();
      vi.mocked(repo.get).mockResolvedValue(project);

      const result = await service.getProject('proj-1');
      expect(result).toEqual(project);
    });

    it('throws NotFoundError when project does not exist', async () => {
      vi.mocked(repo.get).mockResolvedValue(null);

      await expect(service.getProject('missing')).rejects.toThrow(NotFoundError);
      await expect(service.getProject('missing')).rejects.toThrow(
        'Project with id "missing" not found'
      );
    });
  });

  describe('deleteProject', () => {
    it('deletes the project when it exists', async () => {
      vi.mocked(repo.get).mockResolvedValue(makeProject());

      await service.deleteProject('proj-1');

      expect(repo.delete).toHaveBeenCalledWith('proj-1');
    });

    it('throws NotFoundError when project does not exist', async () => {
      vi.mocked(repo.get).mockResolvedValue(null);

      await expect(service.deleteProject('ghost')).rejects.toThrow(NotFoundError);
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/services/__tests__/ProjectService.test.ts
```

Expected: FAIL — `ProjectService` not found.

- [ ] **Step 3: Implement `ProjectService`**

Create `src/main/services/ProjectService.ts`:

```ts
import { inject, injectable } from 'tsyringe';
import { PROJECT_REPO_TOKEN } from '../di/tokens';
import type { IProjectRepository } from '../repositories/IProjectRepository';
import type { Project } from '../../shared/types';
import { NotFoundError } from './errors';

@injectable()
export class ProjectService {
  constructor(
    @inject(PROJECT_REPO_TOKEN) private readonly repo: IProjectRepository
  ) {}

  async createProject(name: string): Promise<Project> {
    return this.repo.create({ name });
  }

  async listProjects(): Promise<Project[]> {
    return this.repo.list();
  }

  async getProject(id: string): Promise<Project> {
    const project = await this.repo.get(id);
    if (!project) throw new NotFoundError('Project', id);
    return project;
  }

  async deleteProject(id: string): Promise<void> {
    await this.getProject(id); // throws NotFoundError if missing
    await this.repo.delete(id);
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/services/__tests__/ProjectService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ProjectService.ts src/main/services/__tests__/ProjectService.test.ts
git commit -m "feat: add ProjectService with unit tests"
```

---

## Task 10: MessageService (TDD)

**Files:**
- Create: `src/main/services/__tests__/MessageService.test.ts`
- Create: `src/main/services/MessageService.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/__tests__/MessageService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageService } from '../MessageService';
import type { IMessageRepository } from '../../repositories/IMessageRepository';
import type { Message } from '../../../shared/types';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    projectId: 'proj-1',
    role: 'user',
    content: 'Hello',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IMessageRepository> = {}): IMessageRepository {
  return {
    create: vi.fn().mockResolvedValue(makeMessage()),
    listByProject: vi.fn().mockResolvedValue([]),
    getRecent: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('MessageService', () => {
  let repo: IMessageRepository;
  let service: MessageService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new MessageService(repo);
  });

  describe('addMessage', () => {
    it('delegates to repo.create and returns the message', async () => {
      const data = { projectId: 'proj-1', role: 'user' as const, content: 'Hi' };
      const created = makeMessage(data);
      vi.mocked(repo.create).mockResolvedValue(created);

      const result = await service.addMessage(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(created);
    });
  });

  describe('getHistory', () => {
    it('returns messages from repo.listByProject', async () => {
      const msgs = [makeMessage({ id: 'a' }), makeMessage({ id: 'b' })];
      vi.mocked(repo.listByProject).mockResolvedValue(msgs);

      const result = await service.getHistory('proj-1');

      expect(repo.listByProject).toHaveBeenCalledWith('proj-1');
      expect(result).toEqual(msgs);
    });
  });

  describe('getRecentContext', () => {
    it('delegates to repo.getRecent with projectId and n', async () => {
      const msgs = [makeMessage()];
      vi.mocked(repo.getRecent).mockResolvedValue(msgs);

      const result = await service.getRecentContext('proj-1', 5);

      expect(repo.getRecent).toHaveBeenCalledWith('proj-1', 5);
      expect(result).toEqual(msgs);
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/services/__tests__/MessageService.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `MessageService`**

Create `src/main/services/MessageService.ts`:

```ts
import { inject, injectable } from 'tsyringe';
import { MESSAGE_REPO_TOKEN } from '../di/tokens';
import type { IMessageRepository } from '../repositories/IMessageRepository';
import type { Message } from '../../shared/types';

@injectable()
export class MessageService {
  constructor(
    @inject(MESSAGE_REPO_TOKEN) private readonly repo: IMessageRepository
  ) {}

  async addMessage(data: Omit<Message, 'id' | 'createdAt'>): Promise<Message> {
    return this.repo.create(data);
  }

  async getHistory(projectId: string): Promise<Message[]> {
    return this.repo.listByProject(projectId);
  }

  async getRecentContext(projectId: string, n: number): Promise<Message[]> {
    return this.repo.getRecent(projectId, n);
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/services/__tests__/MessageService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/MessageService.ts src/main/services/__tests__/MessageService.test.ts
git commit -m "feat: add MessageService with unit tests"
```

---

## Task 11: ArtifactService (TDD)

**Files:**
- Create: `src/main/services/__tests__/ArtifactService.test.ts`
- Create: `src/main/services/ArtifactService.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/__tests__/ArtifactService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtifactService } from '../ArtifactService';
import type { IArtifactRepository } from '../../repositories/IArtifactRepository';
import type { Artifact } from '../../../shared/types';

function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'art-1',
    projectId: 'proj-1',
    title: 'Report',
    filePath: '/docs/report.md',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeMockRepo(overrides: Partial<IArtifactRepository> = {}): IArtifactRepository {
  return {
    create: vi.fn().mockResolvedValue(makeArtifact()),
    listByProject: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('ArtifactService', () => {
  let repo: IArtifactRepository;
  let service: ArtifactService;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new ArtifactService(repo);
  });

  describe('saveArtifact', () => {
    it('delegates to repo.create and returns the artifact', async () => {
      const data = { projectId: 'proj-1', title: 'My Report', filePath: '/x.md' };
      const created = makeArtifact(data);
      vi.mocked(repo.create).mockResolvedValue(created);

      const result = await service.saveArtifact(data);

      expect(repo.create).toHaveBeenCalledWith(data);
      expect(result).toEqual(created);
    });
  });

  describe('listArtifacts', () => {
    it('returns artifacts from repo.listByProject', async () => {
      const list = [makeArtifact({ id: 'a' }), makeArtifact({ id: 'b' })];
      vi.mocked(repo.listByProject).mockResolvedValue(list);

      const result = await service.listArtifacts('proj-1');

      expect(repo.listByProject).toHaveBeenCalledWith('proj-1');
      expect(result).toEqual(list);
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/services/__tests__/ArtifactService.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `ArtifactService`**

Create `src/main/services/ArtifactService.ts`:

```ts
import { inject, injectable } from 'tsyringe';
import { ARTIFACT_REPO_TOKEN } from '../di/tokens';
import type { IArtifactRepository } from '../repositories/IArtifactRepository';
import type { Artifact } from '../../shared/types';

@injectable()
export class ArtifactService {
  constructor(
    @inject(ARTIFACT_REPO_TOKEN) private readonly repo: IArtifactRepository
  ) {}

  async saveArtifact(data: Omit<Artifact, 'id' | 'createdAt'>): Promise<Artifact> {
    return this.repo.create(data);
  }

  async listArtifacts(projectId: string): Promise<Artifact[]> {
    return this.repo.listByProject(projectId);
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/services/__tests__/ArtifactService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ArtifactService.ts src/main/services/__tests__/ArtifactService.test.ts
git commit -m "feat: add ArtifactService with unit tests"
```

---

## Task 12: ResearchService (TDD)

**Files:**
- Create: `src/main/services/__tests__/ResearchService.test.ts`
- Create: `src/main/services/ResearchService.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/__tests__/ResearchService.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ResearchService } from '../ResearchService';
import { NotImplementedError } from '../errors';

describe('ResearchService', () => {
  describe('startResearch', () => {
    it('throws NotImplementedError (wired in Run 6)', async () => {
      const service = new ResearchService();

      await expect(service.startResearch('proj-1', 'quantum computing')).rejects.toThrow(
        NotImplementedError
      );
      await expect(service.startResearch('proj-1', 'quantum computing')).rejects.toThrow(
        'Run 6'
      );
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `ResearchService`**

Create `src/main/services/ResearchService.ts`:

```ts
import { injectable } from 'tsyringe';
import type { ResearchTask } from '../../shared/types';
import { NotImplementedError } from './errors';

@injectable()
export class ResearchService {
  async startResearch(
    _projectId: string,
    _query: string
  ): Promise<ResearchTask> {
    throw new NotImplementedError('ResearchService.startResearch', 'Run 6');
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/services/__tests__/ResearchService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ResearchService.ts src/main/services/__tests__/ResearchService.test.ts
git commit -m "feat: add ResearchService stub with unit tests"
```

---

## Task 13: FileService (TDD)

**Files:**
- Create: `src/main/services/__tests__/FileService.test.ts`
- Create: `src/main/services/FileService.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/services/__tests__/FileService.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileService } from '../FileService';

vi.mock('node:fs/promises');
vi.mock('node:fs');

import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';

describe('FileService', () => {
  let service: FileService;

  beforeEach(() => {
    service = new FileService();
    vi.resetAllMocks();
  });

  describe('readFile', () => {
    it('reads file content as utf-8 string', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValue('file content' as never);

      const result = await service.readFile('/some/path.md');

      expect(fsPromises.readFile).toHaveBeenCalledWith('/some/path.md', 'utf-8');
      expect(result).toBe('file content');
    });
  });

  describe('writeFile', () => {
    it('writes content to path as utf-8', async () => {
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      await service.writeFile('/some/path.md', 'content here');

      expect(fsPromises.writeFile).toHaveBeenCalledWith('/some/path.md', 'content here', 'utf-8');
    });
  });

  describe('listFiles', () => {
    it('returns directory entries', async () => {
      vi.mocked(fsPromises.readdir).mockResolvedValue(['a.md', 'b.md'] as never);

      const result = await service.listFiles('/some/dir');

      expect(fsPromises.readdir).toHaveBeenCalledWith('/some/dir');
      expect(result).toEqual(['a.md', 'b.md']);
    });
  });

  describe('watchDirectory', () => {
    it('returns an unsubscribe function that closes the watcher', () => {
      const mockClose = vi.fn();
      const mockWatcher = { close: mockClose } as unknown as fs.FSWatcher;
      vi.mocked(fs.watch).mockReturnValue(mockWatcher);

      const cb = vi.fn();
      const unsubscribe = service.watchDirectory('/some/dir', cb);

      expect(fs.watch).toHaveBeenCalledWith('/some/dir', { recursive: true }, cb);

      unsubscribe();
      expect(mockClose).toHaveBeenCalledOnce();
    });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/services/__tests__/FileService.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `FileService`**

Create `src/main/services/FileService.ts`:

```ts
import { watch } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { injectable } from 'tsyringe';

@injectable()
export class FileService {
  async readFile(filePath: string): Promise<string> {
    return readFile(filePath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await writeFile(filePath, content, 'utf-8');
  }

  async listFiles(dir: string): Promise<string[]> {
    return readdir(dir);
  }

  watchDirectory(
    dir: string,
    cb: (event: string, filename: string) => void
  ): () => void {
    const watcher = watch(dir, { recursive: true }, cb);
    return () => watcher.close();
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/services/__tests__/FileService.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/FileService.ts src/main/services/__tests__/FileService.test.ts
git commit -m "feat: add FileService with unit tests"
```

---

## Task 14: EventBus (TDD)

**Files:**
- Create: `src/main/event-bus.test.ts`
- Create: `src/main/event-bus.ts`

- [ ] **Step 1: Write failing tests**

Create `src/main/event-bus.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './event-bus';

describe('EventBus', () => {
  it('delivers payload to registered handler', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('research:started', handler);
    bus.emit({
      type: 'research:started',
      payload: { taskId: 't1', projectId: 'p1', query: 'AI' },
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ taskId: 't1', projectId: 'p1', query: 'AI' });
  });

  it('does not deliver to handler after unsubscribe', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    const unsubscribe = bus.on('research:progress', handler);
    unsubscribe();
    bus.emit({ type: 'research:progress', payload: { taskId: 't1', message: 'Working...' } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers to multiple handlers on the same event', () => {
    const bus = new EventBus();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    bus.on('research:complete', handlerA);
    bus.on('research:complete', handlerB);
    bus.emit({ type: 'research:complete', payload: { taskId: 't1', artifactId: 'a1' } });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it('does not cross-deliver between event types', () => {
    const bus = new EventBus();
    const startedHandler = vi.fn();
    const failedHandler = vi.fn();

    bus.on('research:started', startedHandler);
    bus.on('research:failed', failedHandler);
    bus.emit({ type: 'research:started', payload: { taskId: 't1', projectId: 'p1', query: 'Q' } });

    expect(startedHandler).toHaveBeenCalledOnce();
    expect(failedHandler).not.toHaveBeenCalled();
  });

  it('delivers correct typed payload for each event type', () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on('research:failed', handler);
    bus.emit({ type: 'research:failed', payload: { taskId: 't2', error: 'timeout' } });

    expect(handler).toHaveBeenCalledWith({ taskId: 't2', error: 'timeout' });
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
bun run test src/main/event-bus.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `EventBus`**

Create `src/main/event-bus.ts`:

```ts
import { EventEmitter } from 'node:events';
import { injectable } from 'tsyringe';

type AppEvent =
  | { type: 'research:started'; payload: { taskId: string; projectId: string; query: string } }
  | { type: 'research:progress'; payload: { taskId: string; message: string } }
  | { type: 'research:complete'; payload: { taskId: string; artifactId: string } }
  | { type: 'research:failed'; payload: { taskId: string; error: string } };

@injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();

  emit<T extends AppEvent>(event: T): void {
    this.emitter.emit(event.type, event.payload);
  }

  on<K extends AppEvent['type']>(
    type: K,
    handler: (payload: Extract<AppEvent, { type: K }>['payload']) => void
  ): () => void {
    this.emitter.on(type, handler);
    return () => this.emitter.off(type, handler);
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
bun run test src/main/event-bus.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/event-bus.ts src/main/event-bus.test.ts
git commit -m "feat: add typed EventBus with unit tests"
```

---

## Task 15: Bootstrap and IPC Wiring

**Files:**
- Create: `src/main/bootstrap.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc-handlers.ts`

- [ ] **Step 1: Create `src/main/bootstrap.ts`**

```ts
import { join } from 'node:path';
import { app } from 'electron';
import { Container } from 'tsyringe';
import { createDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import {
  ARTIFACT_REPO_TOKEN,
  DB_TOKEN,
  MESSAGE_REPO_TOKEN,
  PROJECT_REPO_TOKEN,
} from './di/tokens';
import { DrizzleArtifactRepository } from './repositories/drizzle/DrizzleArtifactRepository';
import { DrizzleMessageRepository } from './repositories/drizzle/DrizzleMessageRepository';
import { DrizzleProjectRepository } from './repositories/drizzle/DrizzleProjectRepository';
import { ArtifactService } from './services/ArtifactService';
import { FileService } from './services/FileService';
import { MessageService } from './services/MessageService';
import { ProjectService } from './services/ProjectService';
import { ResearchService } from './services/ResearchService';
import { EventBus } from './event-bus';

export async function bootstrap(): Promise<Container> {
  const dbPath = join(app.getPath('userData'), 'research-assistant.db');
  const db = await createDatabase(dbPath);
  await runMigrations(db);

  const container = new Container();

  container.registerInstance(DB_TOKEN, db);

  container.register(PROJECT_REPO_TOKEN, { useClass: DrizzleProjectRepository });
  container.register(MESSAGE_REPO_TOKEN, { useClass: DrizzleMessageRepository });
  container.register(ARTIFACT_REPO_TOKEN, { useClass: DrizzleArtifactRepository });

  container.registerSingleton(ProjectService);
  container.registerSingleton(MessageService);
  container.registerSingleton(ArtifactService);
  container.registerSingleton(ResearchService);
  container.registerSingleton(FileService);
  container.registerSingleton(EventBus);

  return container;
}
```

- [ ] **Step 2: Replace `src/main/index.ts`**

```ts
import 'reflect-metadata';
import { join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import { bootstrap } from './bootstrap';
import { registerIpcHandlers } from './ipc-handlers';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(async () => {
  const container = await bootstrap();
  const win = createWindow();
  registerIpcHandlers(win, container);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 3: Replace `src/main/ipc-handlers.ts`**

```ts
import { type BrowserWindow, ipcMain } from 'electron';
import type { Container } from 'tsyringe';
import { IPC } from '../shared/ipc-channels';
import { ArtifactService } from './services/ArtifactService';
import { MessageService } from './services/MessageService';
import { ProjectService } from './services/ProjectService';

export function registerIpcHandlers(win: BrowserWindow, container: Container): void {
  const projectService = container.resolve(ProjectService);
  const messageService = container.resolve(MessageService);
  const artifactService = container.resolve(ArtifactService);

  ipcMain.handle(IPC.GET_PROJECTS, async () => {
    return projectService.listProjects();
  });

  ipcMain.handle(IPC.CREATE_PROJECT, async (_event, payload: unknown) => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { name?: unknown }).name !== 'string'
    ) {
      throw new Error('Invalid payload: expected { name: string }');
    }
    return projectService.createProject((payload as { name: string }).name);
  });

  ipcMain.handle(IPC.GET_ARTIFACTS, async (_event, payload: unknown) => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== 'string'
    ) {
      throw new Error('Invalid payload: expected { projectId: string }');
    }
    return artifactService.listArtifacts((payload as { projectId: string }).projectId);
  });

  ipcMain.on(IPC.SEND_MESSAGE, async (_event, payload: unknown) => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== 'string' ||
      typeof (payload as { content?: unknown }).content !== 'string'
    ) {
      console.error('[IPC] SEND_MESSAGE: invalid payload', payload);
      return;
    }
    const { projectId, content } = payload as { projectId: string; content: string };
    await messageService.addMessage({ projectId, role: 'user', content });
    // TODO(run-5): route to OpenRouter via Mastra agent, stream chunks back via MESSAGE_CHUNK
  });
}
```

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Run biome check**

```bash
bun run check
```

Expected: clean (fix any auto-fixable issues).

- [ ] **Step 6: Commit**

```bash
git add src/main/bootstrap.ts src/main/index.ts src/main/ipc-handlers.ts
git commit -m "feat: wire DI container bootstrap and real IPC handlers"
```

---

## Task 16: Final Verification

- [ ] **Step 1: Run all tests**

```bash
bun run test
```

Expected: all tests PASS, zero failures.

- [ ] **Step 2: Run coverage and verify ≥90% threshold**

```bash
bun run test:coverage
```

Expected output (abbreviated):
```
Coverage report:
  Statements : 90%+ ✓
  Branches   : 90%+ ✓
  Functions  : 90%+ ✓
  Lines      : 90%+ ✓
```

If any threshold fails, add tests for the uncovered branch before continuing.

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Run biome check**

```bash
bun run check
```

Expected: clean exit.

- [ ] **Step 5: Start the app and verify it opens**

```bash
bun run dev
```

Expected: Electron window opens, AppShell renders, no console errors. Open DevTools (`Cmd+Option+I`) and verify `window.electronAPI` is available.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: Run 2 complete — types, DB, services, event bus"
```
