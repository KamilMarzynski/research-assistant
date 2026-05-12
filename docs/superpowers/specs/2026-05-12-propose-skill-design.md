# Design: Wire Up `propose_skill` and Remove Auto-Crystallization

## Problem Statement

- `propose_tool` exists in code but is **dead code** — no caller passes `proposeToolFn` to `createAgentTools`.
- `CrystallizationService.crystallizeAndSave` auto-creates skills after research **without user approval**, producing noise and bypassing user gating.
- No clear distinction between:
  - **Explicit creation**: user asks for a skill → write directly to `~/.scholar/skills/`.
  - **Implicit proposal**: agent discovers pattern during research → propose for approval.

## Goals

1. Wire `proposeSkillFn` into the **main chat agent only** so it can propose skills for user approval.
2. Remove `CrystallizationService.crystallizeAndSave` — keep evaluation logic but stop auto-saving skills.
3. Teach the chat agent (via system prompt) when to create directly vs when to propose.
4. Preserve existing `PendingToolBanner` / `ToolApprovalService` UI flow.
5. Never expose `propose_skill` to background worker/research agents.

## Naming Unification

Rename `propose_tool` → `propose_skill` across the codebase:
- `src/main/agent/tools/propose-tool.ts` → `propose-skill.ts`
- Update `AgentToolName` union in `tools.ts`
- Update all call sites in `tools.ts`, `worker-agent.ts`, `tools.test.ts`

## Detailed Design

### 1. Wire `proposeSkillFn` into `AgentSession`

In `src/main/ipc/chat-handlers.ts`, when constructing `AgentSession`, pass:

```typescript
proposeSkillFn: async (name, skillContent, script) => {
  await homeService.savePendingTool(name, skillContent, script);
  eventBus.emit({ type: "tool:pending", payload: { name, skillContent } });
},
```

**Chain of plumbing:**
- `chat-handlers.ts` → passes `proposeSkillFn` in `AgentSessionOptions`
- `AgentSession` constructor → passes it to `createAgentTools`
- `createAgentTools` → when `proposeSkillFn` is present, includes `createProposeSkillTool(proposeSkillFn)` in the tool list

**Key constraint:** Only `AgentSession` (main chat agent) receives this callback. Worker agents created via `createWorkerAgent` do **not**.

### 2. Update `AgentSession`

- Add `proposeSkillFn?: (name, skillContent, script) => Promise<void>` to `AgentSessionOptions`.
- Forward it through `createAgentTools`.

### 3. Remove Auto-Crystallization

In `src/main/services/ResearchService.ts`:
- Delete the post-research block that calls `this.crystallizationService.crystallizeAndSave(...)`.

In `src/main/services/CrystallizationService.ts`:
- Delete `crystallizeAndSave` entirely.
- Keep `evaluateForCrystallization` — it returns a JSON verdict. The main chat agent can read this verdict (if passed in research results) and decide to propose a skill, but the service itself no longer writes anything.

### 4. System Prompt Instruction

Append to `BASE_SYSTEM_PROMPT` in `src/main/agent/session.ts`:

```
When the user explicitly asks you to create or write a skill, write it directly to ~/.scholar/skills/<name>/SKILL.md so it is available immediately. If you discover a reusable pattern during research that the user did not explicitly request, use the propose_skill tool to suggest it for their approval instead.
```

### 5. Worker Agents Never Get `proposeSkillFn`

- `createWorkerAgent` in `worker-agent.ts` still accepts `proposeToolFn` in its config type, but no production caller passes it.
- `ResearchService` does not pass `proposeSkillFn` to `createWorkerAgent`.
- `CrystallizationService` no longer creates skills.
- Background agents research, report findings, and stop. The main chat agent decides whether to propose.

### 6. Existing UI Flow Preserved

`ToolApprovalService.savePendingTool` writes to `~/.scholar/pending-tools/<name>/SKILL.md` (and optional script). The `eventBus.emit("tool:pending")` triggers `PendingToolBanner` in the renderer. User approves → `approvePendingTool` moves dir to `~/.scholar/skills/<name>/`. No changes needed to:
- `ToolApprovalService`
- `HomeService` (delegation methods)
- `PendingToolBanner` / `PendingToolModal`
- `admin-handlers.ts` (APPROVE_TOOL, REJECT_TOOL, GET_PENDING_TOOLS)

### 7. Error Handling

- If `savePendingTool` throws (e.g., disk full), `proposeSkillFn` rejects and the tool returns an error to the agent via `AgentToolResult`.
- `eventBus.emit("tool:pending")` happens **only after** save succeeds, so no phantom UI state.

## Testing Considerations

- Add test in `session.test.ts`: verify `AgentSession` includes `propose_skill` tool when `proposeSkillFn` is provided.
- Update `tools.test.ts`: rename all `propose_tool` references to `propose_skill`.
- Verify `CrystallizationService` test mocks still pass after removing `crystallizeAndSave`.
- End-to-end: trigger `propose_skill` from a test agent, verify `pending-tools/` gets the file and `TOOL_PENDING` event fires.

## Out of Scope

- Adding a new built-in skill file (e.g., `proposing-skills`). The system prompt instruction is sufficient.
- Changing `safe_bash` behavior for skill scripts. Python scripts in skills run through the same `safe_bash` path as any command; no special execution privilege is granted.
- Modifying `SkillRouter` or skill watching logic.
- Changing how skills are loaded into the system prompt.
