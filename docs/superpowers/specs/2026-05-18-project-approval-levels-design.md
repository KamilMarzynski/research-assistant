# Project Approval Levels

Date: 2026-05-18

## Goal

Add per-project approval levels so a project can either use the current approval behavior or bypass user approval prompts during agent work.

Initial levels:

- `default`: current behavior. Commands, code execution, and out-of-jail paths ask the user when they need approval.
- `bypass_approvals`: approval prompts for that project are automatically approved. The agent keeps working without waiting for the user.

The setting must work immediately inside the existing project session. It must not recreate or delete the agent session.

## Non-Goals

- Do not change model switching behavior.
- Do not add a global approval setting.
- Do not add a new hard-block policy in this feature.
- Do not bypass non-approval safeguards such as schema validation, `write_file` hash checks, memory-directory restrictions, SSRF protection, or `safe_bash` inline/script execution reroutes.

## Data Model

Add a shared type:

```ts
type ApprovalLevel = "default" | "bypass_approvals";
```

Persist the value on each project:

- database column: `projects.approval_level TEXT NOT NULL DEFAULT 'default'`
- shared `Project` field: `approvalLevel: ApprovalLevel`
- repository create/list/get/update support
- migration defaults existing projects to `default`

## Approval Policy Service

Add `ApprovalPolicyService` as the single owner of live approval policy:

- `getLevel(projectId): Promise<ApprovalLevel>`
- `setLevel(projectId, level): Promise<void>`
- `shouldBypass(projectId): Promise<boolean>`

The service reads from the project repository and keeps an in-memory cache by project ID. `setLevel` updates both the database and cache before any auto-resolution work runs, so the current project session sees the new policy on the next approval check.

Tool implementations must not capture approval level when the agent session is created. They should consult the service at the approval gate.

## Approval Gate Behavior

Wire `ApprovalPolicyService` into every current user approval gate.

### `safe_bash`

When `safe_bash` determines a command requires user approval, check `shouldBypass(projectId)` before entering the existing approval gate.

If bypass is enabled:

- run the command immediately
- keep the normal audit entry for executed commands
- do not emit `BASH_BLOCKED`

Existing non-approval reroutes for inline code and script-file execution stay unchanged.

### `execute_code`

Before `enterExecuteCodeApprovalGate`, check `shouldBypass(projectId)`.

If bypass is enabled:

- proceed as if the user selected `approve_once`
- keep existing audit behavior
- do not emit `EXECUTE_CODE_APPROVAL_REQUIRED`

### File And Path Tools

When `PathJail` raises `ApprovalRequiredError`, check `shouldBypass(projectId)` before emitting `PATH_APPROVAL_REQUIRED`.

If bypass is enabled:

- add the path to the existing project session allowlist
- retry or continue validation so the original operation completes
- do not emit `PATH_APPROVAL_REQUIRED`

This covers `read_file`, `write_file`, `list_dir`, `compress`, and future tools that use the same path approval path.

Bypass only answers the approval question. It does not skip `write_file` `expected_hash` checks or restrictions that are intentionally not approval gates.

## Mid-Turn Setting Changes

Changing a project to `bypass_approvals` must unblock already-pending approvals for that project.

Add IPC:

- `SET_PROJECT_APPROVAL_LEVEL`: renderer to main
- `APPROVALS_AUTO_RESOLVED`: main to renderer, payload `{ projectId }`

When `SET_PROJECT_APPROVAL_LEVEL` receives `bypass_approvals`:

1. persist the new level
2. update `ApprovalPolicyService` cache
3. resolve pending bash approvals for the project as `approve_once`
4. resolve pending `execute_code` approvals for the project as `approve_once`
5. resolve pending path approvals for the project as `approve_session`
6. emit `APPROVALS_AUTO_RESOLVED`

Resolution functions should continue to tolerate missing IDs, because a user click and auto-resolution can race.

When switching back to `default`, do not revoke already-approved work. The change only affects future approval gates.

## Renderer Behavior

Add a compact approval-level selector next to the model selector in `MessageInput`, below the message text area.

Labels:

- `Default permissions`
- `Bypass approvals`

When bypass is selected, render the label in the app accent color. Do not use danger/red styling and do not add a separate warning banner.

On change:

- call `SET_PROJECT_APPROVAL_LEVEL`
- update the local active project state after success
- do not disable the control while the model is thinking unless the request itself is in flight

Pending approval banners should subscribe to `APPROVALS_AUTO_RESOLVED` and remove matching items for the project. If a modal is open for a removed item, close it.

## Testing

Add focused tests for:

- migration and repository mapping default `approvalLevel`
- `ProjectService` or `ApprovalPolicyService` setting and reading levels
- `safe_bash` bypasses the approval gate and executes immediately
- `execute_code` bypasses approval and proceeds
- file tools auto-allow an out-of-jail path in bypass mode
- `SET_PROJECT_APPROVAL_LEVEL` persists the value without deleting the session
- switching to bypass resolves pending bash, execute_code, and path approvals and emits `APPROVALS_AUTO_RESOLVED`
- `MessageInput` renders and changes the approval-level selector
- pending banners clear on `APPROVALS_AUTO_RESOLVED`

Run the normal quality commands before implementation is considered complete:

```bash
bun run typecheck
bun run check
bun run test
bun run test:coverage
```
