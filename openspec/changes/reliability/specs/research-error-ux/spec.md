## ADDED Requirements

### Requirement: Error detail in ResearchStatusBar
The system SHALL display the error message when a research task fails, instead of a generic "Research failed." message.

#### Scenario: Research error shown
- **WHEN** a `research:failed` event is received
- **THEN** the ResearchStatusBar SHALL display the error string from the event payload

### Requirement: Retry button for failed research
The system SHALL provide a retry button when a research task fails, allowing the user to re-queue the task.

#### Scenario: Retry button visible on failure
- **WHEN** a `research:failed` event is received
- **THEN** the ResearchStatusBar SHALL display a retry button alongside the error message

#### Scenario: Retry re-dispatches research
- **WHEN** the user clicks the retry button
- **THEN** the system SHALL re-queue the research task via the `RETRY_RESEARCH` IPC channel
- **THEN** the ResearchStatusBar SHALL show the research as active again

#### Scenario: Retry button hidden when research active
- **WHEN** research is actively running (not in failed state)
- **THEN** the retry button SHALL NOT be displayed

### Requirement: RETRY_RESEARCH IPC channel
The system SHALL provide an IPC channel to re-queue a failed research task.

#### Scenario: Retry invokes research
- **WHEN** `RETRY_RESEARCH` is called with `{ taskId, query, projectId, projectName, folderPath }`
- **THEN** the system SHALL call `researchService.startResearch()` with the saved parameters
- **THEN** the system SHALL return the new `taskId`

### Requirement: Error persists until dismissed or retried
The error message and retry button SHALL remain visible until the user clicks retry or a timeout clears the message.

#### Scenario: Error persists beyond 3 seconds
- **WHEN** a research task fails
- **THEN** the error SHALL remain visible for at least 30 seconds (not the current 3-second auto-dismiss)
