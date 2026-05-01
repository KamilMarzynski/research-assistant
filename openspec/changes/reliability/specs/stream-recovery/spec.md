## ADDED Requirements

### Requirement: Stream timeout detection
The system SHALL detect when an LLM stream fails to complete within a configurable timeout period.

#### Scenario: Stream completes before timeout
- **WHEN** the agent successfully completes and fires `agent_end` within the timeout period
- **THEN** the timeout timer SHALL be cleared and `MESSAGE_DONE` SHALL fire normally

#### Scenario: Stream stalls and timeout fires
- **WHEN** the agent does not fire `agent_end` within 120 seconds of `send()` returning
- **THEN** the system SHALL fire `MESSAGE_DONE` with an error message indicating the stream timed out

#### Scenario: Stream errors before timeout
- **WHEN** the agent subscriber's catch block fires before the timeout
- **THEN** the system SHALL clear the timeout and fire `MESSAGE_DONE` with the error message

### Requirement: User-visible timeout message
The system SHALL display a clear error message in the chat when a stream times out.

#### Scenario: Timeout message displayed
- **WHEN** a stream timeout occurs
- **THEN** the UI SHALL display "⚠️ The response timed out. Please try again." in the chat
