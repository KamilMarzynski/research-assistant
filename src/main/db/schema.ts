import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug"),
  folderPath: text("folder_path"),
  projectPath: text("project_path"),
  modelOverride: text("model_override"),
  approvalLevel: text("approval_level", { enum: ["default", "bypass_approvals"] })
    .notNull()
    .default("default"),
  maxRecentMessages: integer("max_recent_messages").notNull().default(20),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// Messages are immutable after creation — no updatedAt column.
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

// Artifacts are immutable after creation — no updatedAt column.
export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  filePath: text("file_path").notNull(),
  relativePath: text("relative_path"),
  acknowledged: integer("acknowledged", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  projectName: text("project_name").notNull(),
  query: text("query").notNull(),
  brief: text("brief"),
  folderPath: text("folder_path"),
  status: text("status", {
    enum: ["pending", "in_progress", "complete", "failed"],
  })
    .notNull()
    .default("in_progress"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
