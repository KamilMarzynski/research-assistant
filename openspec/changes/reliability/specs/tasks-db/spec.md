## ADDED Requirements

### Requirement: Tasks table in Drizzle schema
The system SHALL store research tasks in a Drizzle SQLite table instead of filesystem JSON files.

#### Scenario: Tasks table exists
- **WHEN** the database is migrated
- **THEN** a `tasks` table SHALL exist with columns: `id` (text PK), `projectId` (text, FK to projects), `projectName` (text), `query` (text), `folderPath` (text, nullable), `status` (text enum: `pending | in_progress | complete | failed`), `error` (text, nullable), `createdAt` (integer, timestamp_ms), `updatedAt` (integer, timestamp_ms)

### Requirement: CRUD operations use DB
The system SHALL replace `HomeService.saveTask()`, `deleteTask()`, and `getInProgressTasks()` with Drizzle queries against the `tasks` table.

#### Scenario: Save task inserts row
- **WHEN** `saveTask()` is called
- **THEN** a new row SHALL be inserted into the `tasks` table with status `in_progress`

#### Scenario: Delete task removes row
- **WHEN** `deleteTask()` is called
- **THEN** the row with matching `id` SHALL be deleted from the `tasks` table

#### Scenario: Get in-progress tasks queries DB
- **WHEN** `getInProgressTasks()` is called
- **THEN** all rows with status `in_progress` SHALL be returned

### Requirement: Migration from filesystem JSON
The system SHALL migrate existing in-progress tasks from `~/.research-assistant/tasks/*.json` to the DB on startup.

#### Scenario: Existing tasks migrated
- **WHEN** the app starts
- **AND** JSON task files exist in `~/.research-assistant/tasks/`
- **THEN** each JSON task SHALL be inserted into the `tasks` table
- **THEN** the JSON files SHALL be deleted
- **THEN** auto-resume SHALL use the DB table (same as current behavior)

#### Scenario: No JSON tasks directory
- **WHEN** the app starts
- **AND** no `~/.research-assistant/tasks/` directory exists
- **THEN** no migration SHALL occur
- **THEN** `getInProgressTasks()` SHALL return an empty array

### Requirement: Task status updates
The system SHALL update task status as research progresses.

#### Scenario: Status set to failed on error
- **WHEN** a research task errors
- **THEN** the task's status SHALL be updated to `failed`
- **THEN** the error column SHALL store the error message string

#### Scenario: Status set to complete on success
- **WHEN** a research task completes successfully
- **THEN** the task's status SHALL be updated to `complete`
