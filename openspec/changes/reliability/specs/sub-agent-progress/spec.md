## ADDED Requirements

### Requirement: Sub-agent progress in ResearchStatusBar
The system SHALL display sub-agent activity in the ResearchStatusBar during orchestrated research so the user can see individual worker progress.

#### Scenario: Sub-agent label shown
- **WHEN** a sub-agent (spawned by the orchestrator) emits a `research:progress` event with a label
- **THEN** the ResearchStatusBar SHALL display the label prefix alongside the progress message (e.g., "[researcher-1] Analyzing results...")

#### Scenario: Multiple sub-agents show progress
- **WHEN** multiple sub-agents are running in parallel
- **THEN** the ResearchStatusBar SHALL update to show the latest progress event from any sub-agent
