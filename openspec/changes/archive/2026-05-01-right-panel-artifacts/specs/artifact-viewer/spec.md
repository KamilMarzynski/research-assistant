## ADDED Requirements

### Requirement: Artifact list displays per active project
When user selects a project, the right panel SHALL fetch and display all artifacts for that project ordered by creation date descending.
The artifact list SHALL update when the active project changes.
Each artifact entry SHALL show its title and creation date.

#### Scenario: Artifacts load on project selection
- **WHEN** user selects a project
- **THEN** right panel fetches artifacts via `GET_ARTIFACTS` IPC
- **THEN** artifact list displays with title and date

#### Scenario: No artifacts for project
- **WHEN** user selects a project with no artifacts
- **THEN** right panel shows "No artifacts yet" empty state

#### Scenario: Artifact list updates on project switch
- **WHEN** user switches to a different project
- **THEN** artifact list clears and fetches artifacts for the new project

### Requirement: User can view artifact content
When user clicks an artifact in the list, the right panel SHALL read the file content from disk and render it as markdown.
The panel SHALL show a back button or breadcrumb to return to the artifact list.
If the file does not exist at the stored path, the panel SHALL display a "File not found" message.

#### Scenario: Click artifact opens viewer
- **WHEN** user clicks an artifact in the list
- **THEN** right panel switches to viewer mode
- **THEN** file content is fetched via `READ_ARTIFACT_FILE` IPC
- **THEN** content is rendered as markdown

#### Scenario: Back to artifact list
- **WHEN** user clicks back button in viewer
- **THEN** right panel returns to artifact list view

#### Scenario: File not found
- **WHEN** artifact file has been deleted or moved
- **THEN** viewer displays "File not found" message
- **THEN** app does not crash

### Requirement: Right panel uses collapsible sections
The right panel SHALL use MUI Accordion sections to organize content.
The "Artifacts" section SHALL be the first section.
Sections SHALL be independently expandable and collapsible.

#### Scenario: Artifacts section collapses
- **WHEN** user clicks the Artifacts section header
- **THEN** section collapses, hiding artifact list or viewer
- **THEN** clicking again expands it

### Requirement: READ_ARTIFACT_FILE IPC validates paths
The `READ_ARTIFACT_FILE` IPC handler SHALL reject paths containing `..`, `~`, or null bytes.
The handler SHALL resolve the path and verify the file exists before reading.
The handler SHALL return the file content as a UTF-8 string.
The handler SHALL limit reads to 500KB.

#### Scenario: Valid path returns content
- **WHEN** handler receives a valid absolute path to an existing file
- **THEN** it reads and returns up to 500KB of UTF-8 content

#### Scenario: Path traversal rejected
- **WHEN** handler receives a path containing `..` or `~`
- **THEN** it throws an error without reading the file

#### Scenario: Non-existent file
- **WHEN** handler receives a path to a non-existent file
- **THEN** it throws a "File not found" error
