## ADDED Requirements

### Requirement: OS notification on research complete
The system SHALL fire an OS-level notification via the Electron `Notification` API when background research completes and the application window is not focused.

#### Scenario: Notification fires when window unfocused
- **WHEN** a `research:complete` event is received
- **AND** the BrowserWindow is not focused (`!win.isFocused()`)
- **THEN** the system SHALL show an OS notification with title "Research Complete" and body containing the research query

#### Scenario: No notification when window focused
- **WHEN** a `research:complete` event is received
- **AND** the BrowserWindow is focused
- **THEN** the system SHALL NOT fire an OS notification

### Requirement: Notification content
The notification SHALL include the research query so the user knows what completed.

#### Scenario: Notification shows query
- **WHEN** an OS notification is shown
- **THEN** the notification title SHALL be "Research Complete"
- **THEN** the notification body SHALL be the research query string (truncated to 80 characters if longer)

### Requirement: Notification click focuses window
The notification SHALL bring the application window to focus when clicked.

#### Scenario: Clicking notification focuses app
- **WHEN** the user clicks the OS notification
- **THEN** the application window SHALL be brought to focus
