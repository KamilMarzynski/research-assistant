# Skill Management UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Skills tab to Settings modal — browse, view, delete, and toggle enable/disable for installed skills.

**Architecture:** New IPC channels (`GET_SKILLS`, `TOGGLE_SKILL`, `DELETE_SKILL`) + `HomeService` methods + `.disabled` marker file in skill dir. Frontend adds 4th tab to existing SettingsModal.

**Tech Stack:** TypeScript, Electron IPC, React 19 + MUI v9, Vitest

---

### Task 1: Add IPC channels and shared SkillInfo type

**Files:** Modify `src/shared/ipc-channels.ts`

- [ ] **Add IPC channel constants**

Add after `REJECT_TOOL: "REJECT_TOOL"` (line 25):

```
GET_SKILLS: "GET_SKILLS",
TOGGLE_SKILL: "TOGGLE_SKILL",
DELETE_SKILL: "DELETE_SKILL",
```

- [ ] **Add SkillInfo interface**

After the `ResearchProgressPayload` interface at bottom of file (line 54):

```ts
export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  content: string;
}
```

- [ ] **Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat: add GET_SKILLS, TOGGLE_SKILL, DELETE_SKILL IPC channels + SkillInfo type"
```

---

### Task 2: Write HomeService tests for skill management

**Files:** Modify `src/main/services/__tests__/HomeService.test.ts`

Add a new `describe("skill management")` block inside the existing outer describe, before the closing `});`.

- [ ] **Add test for getSkills — empty when no skills dir**

```ts
it("getSkills returns empty array when no skills installed", async () => {
  const db = mockDb();
  const svc = new HomeService(db);
  await svc.ensureDirectories();
  const skills = await svc.getSkills();
  expect(skills).toEqual([]);
});
```

- [ ] **Add test for getSkills — returns parsed skills**

```ts
it("getSkills returns skills with parsed frontmatter", async () => {
  const db = mockDb();
  const svc = new HomeService(db);
  await svc.ensureDirectories();
  const skillDir = join(svc.getHomePath(), "skills", "test-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    `---\nname: test-skill\ndescription: A test skill.\n---\n\n# Test Skill\n\nSome content.`,
  );

  const skills = await svc.getSkills();
  expect(skills).toHaveLength(1);
  expect(skills[0].name).toBe("test-skill");
  expect(skills[0].description).toBe("A test skill.");
  expect(skills[0].enabled).toBe(true);
  expect(skills[0].content).toContain("Some content.");
});
```

- [ ] **Add test for getSkills — disabled when .disabled file exists**

```ts
it("getSkills returns enabled=false when .disabled file exists", async () => {
  const db = mockDb();
  const svc = new HomeService(db);
  await svc.ensureDirectories();
  const skillDir = join(svc.getHomePath(), "skills", "disabled-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: disabled-skill\ndescription: Disabled.\n---\n# Content",
  );
  await writeFile(join(skillDir, ".disabled"), "");

  const skills = await svc.getSkills();
  expect(skills[0].enabled).toBe(false);
});
```

- [ ] **Add test for toggleSkill — disable then enable**

```ts
it("toggleSkill creates and removes .disabled file", async () => {
  const db = mockDb();
  const svc = new HomeService(db);
  await svc.ensureDirectories();
  const skillDir = join(svc.getHomePath(), "skills", "togglable");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: togglable\ndescription: Togglable.\n---\n# Content",
  );

  await svc.toggleSkill("togglable", false);
  const disabledFile = join(skillDir, ".disabled");
  await expect(access(disabledFile)).resolves.toBeUndefined();

  await svc.toggleSkill("togglable", true);
  await expect(access(disabledFile)).rejects.toThrow();
});
```

- [ ] **Add test for deleteSkill — removes dir**

```ts
it("deleteSkill removes the skill directory", async () => {
  const db = mockDb();
  const svc = new HomeService(db);
  await svc.ensureDirectories();
  const skillDir = join(svc.getHomePath(), "skills", "deletable");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: deletable\ndescription: Deletable.\n---\n# Content",
  );

  await svc.deleteSkill("deletable");
  await expect(readdir(join(svc.getHomePath(), "skills"))).resolves.not.toContain("deletable");
});
```

- [ ] **Run tests to verify they fail**

Run: `bun run test -- src/main/services/__tests__/HomeService.test.ts`
Expected: FAIL — `getSkills`, `toggleSkill`, `deleteSkill` not defined

---

### Task 3: Implement HomeService skill management methods

**Files:** Modify `src/main/services/HomeService.ts`

Add imports at top (line 1):

```ts
import { readFile, readdir, mkdir, writeFile, rename, rm, access } from "node:fs/promises";
```

Note: `access`, `readFile`, `readdir`, `mkdir`, `writeFile`, `rename`, `rm` are already imported — just verify. Add `access` if missing. Add the `SkillInfo` import:

```ts
import type { SkillInfo } from "../../shared/ipc-channels";
```

Also need to add `parse` from yaml and `join` from path:

```ts
import { parse } from "yaml";
```

- [ ] **Add getSkills method**

After `rejectPendingTool` method (around line 168), before `copyBuiltinSkillsIfNeeded`:

```ts
async getSkills(): Promise<SkillInfo[]> {
  const dir = join(this.getHomePath(), "skills");
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    const skillDir = join(dir, entry);
    const skillMdPath = join(skillDir, "SKILL.md");
    try {
      const content = await readFile(skillMdPath, "utf-8");
      const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
      const meta = match ? (parse(match[1]) as { name?: string; description?: string }) : {};
      const disabledFile = join(skillDir, ".disabled");
      let enabled = true;
      try {
        await access(disabledFile);
        enabled = false;
      } catch {
        // not disabled
      }
      skills.push({
        name: meta.name ?? entry,
        description: meta.description ?? "",
        enabled,
        content,
      });
    } catch {
      // skip malformed
    }
  }
  return skills;
}
```

- [ ] **Add toggleSkill method**

```ts
async toggleSkill(name: string, enabled: boolean): Promise<void> {
  const dir = join(this.getHomePath(), "skills", name);
  const disabledFile = join(dir, ".disabled");
  if (enabled) {
    try { await rm(disabledFile); } catch { /* already not disabled */ }
  } else {
    await writeFile(disabledFile, "");
  }
}
```

- [ ] **Add deleteSkill method**

```ts
async deleteSkill(name: string): Promise<void> {
  await rm(join(this.getHomePath(), "skills", name), { recursive: true, force: true });
}
```

- [ ] **Run tests to verify they pass**

Run: `bun run test -- src/main/services/__tests__/HomeService.test.ts`
Expected: PASS — all 5 new skill management tests pass

- [ ] **Commit**

```bash
git add src/main/services/HomeService.ts src/main/services/__tests__/HomeService.test.ts
git commit -m "feat: add getSkills, toggleSkill, deleteSkill to HomeService"
```

---

### Task 4: Write context.ts test for .disabled skipping

**Files:** Modify `src/main/agent/context.test.ts`

`readSkillsFromDir` is private — test via `loadSkills()`.

- [ ] **Add test for .disabled skip inside existing loadSkills describe**

```ts
it("skips skill directories that contain .disabled file", async () => {
  const skillDir = join(tmpHome, ".research-assistant", "skills", "disabled-skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: disabled-skill\ndescription: Should not appear.\n---\n# Content",
  );
  await writeFile(join(skillDir, ".disabled"), "");

  const result = await loadSkills(undefined);
  expect(result).not.toContain("disabled-skill");
});
```

- [ ] **Run test to verify it fails**

Run: `bun run test -- src/main/agent/context.test.ts`
Expected: FAIL — loadSkills still includes disabled-skill in output

---

### Task 5: Implement .disabled skip in context.ts

**Files:** Modify `src/main/agent/context.ts`

- [ ] **Add import at top**

```ts
import { access } from "node:fs/promises";
```

Note: `access` may not be imported yet — check existing imports. Currently line 1 imports `readdir, readFile` from `fs/promises`.

- [ ] **Modify readSkillsFromDir to check for .disabled**

Change the for loop body in `readSkillsFromDir` (lines 21-32). Before reading `skillMdPath`, add a disabled check:

```ts
for (const entry of entries) {
  const skillDirPath = join(dir, entry);
  const skillMdPath = join(skillDirPath, "SKILL.md");
  try {
    // Skip disabled skills
    try {
      await access(join(skillDirPath, ".disabled"));
      continue; // disabled — skip
    } catch {
      // not disabled, proceed
    }
    const content = await readFile(skillMdPath, "utf-8");
    const meta = parseFrontmatter(content);
    if (meta.name && meta.description) {
      skills.push({ name: meta.name, description: meta.description, location: skillMdPath });
    }
  } catch {
    // skip malformed or missing SKILL.md
  }
}
```

- [ ] **Run test to verify it passes**

Run: `bun run test -- src/main/agent/context.test.ts`
Expected: PASS — new test and all existing tests pass

- [ ] **Commit**

```bash
git add src/main/agent/context.ts src/main/agent/context.test.ts
git commit -m "feat: readSkillsFromDir skips dirs with .disabled marker"
```

---

### Task 6: Add IPC handlers for skill management

**Files:** Modify `src/main/ipc-handlers.ts`

- [ ] **Add handlers after REJECT_TOOL handler (line 345)**

```ts
ipcMain.handle(IPC.GET_SKILLS, async () => {
  return homeService.getSkills();
});

ipcMain.handle(IPC.TOGGLE_SKILL, async (_event, payload: unknown) => {
  const p = payload as { name: string; enabled: boolean };
  if (typeof p?.name !== "string" || typeof p?.enabled !== "boolean") {
    throw new Error("Invalid payload: expected { name: string, enabled: boolean }");
  }
  await homeService.toggleSkill(p.name, p.enabled);
});

ipcMain.handle(IPC.DELETE_SKILL, async (_event, payload: unknown) => {
  const p = payload as { name: string };
  if (typeof p?.name !== "string") {
    throw new Error("Invalid payload: expected { name: string }");
  }
  await homeService.deleteSkill(p.name);
});
```

- [ ] **Commit**

```bash
git add src/main/ipc-handlers.ts
git commit -m "feat: add GET_SKILLS, TOGGLE_SKILL, DELETE_SKILL IPC handlers"
```

---

### Task 7: Add Skills tab to SettingsModal

**Files:** Modify `src/renderer/components/settings/SettingsModal.tsx`

- [ ] **Add SkillInfo import at top**

```ts
import type { SkillInfo } from "../../../shared/ipc-channels";
```

- [ ] **Add skills state**

After `confirmClear` state (line 68), add:

```ts
const [skills, setSkills] = useState<SkillInfo[]>([]);
const [skillsLoading, setSkillsLoading] = useState(false);
const [skillsError, setSkillsError] = useState<string | null>(null);
const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
const [confirmDeleteSkill, setConfirmDeleteSkill] = useState<string | null>(null);
```

- [ ] **Add fetchSkills helper**

After `loadAuditLog` (line 112), add:

```ts
const fetchSkills = async () => {
  setSkillsLoading(true);
  setSkillsError(null);
  try {
    const result = await window.electronAPI.invoke(IPC.GET_SKILLS);
    setSkills(result as SkillInfo[]);
  } catch {
    setSkillsError("Failed to load skills");
  } finally {
    setSkillsLoading(false);
  }
};
```

- [ ] **Add effect to load skills on tab switch**

After the existing `useEffect` for audit log (line 122), add:

```ts
useEffect(() => {
  if (open && tab === 3) {
    void fetchSkills();
  }
}, [open, tab]);
```

- [ ] **Add handleToggleSkill**

After `handleClearAuditLog` (line 166), add:

```ts
const handleToggleSkill = async (name: string, enabled: boolean) => {
  await window.electronAPI.invoke(IPC.TOGGLE_SKILL, { name, enabled });
  setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled } : s)));
};

const handleDeleteSkill = async (name: string) => {
  await window.electronAPI.invoke(IPC.DELETE_SKILL, { name });
  setSkills((prev) => prev.filter((s) => s.name !== name));
  setConfirmDeleteSkill(null);
};
```

- [ ] **Add "Skills" tab to Tabs**

Change line 183 from:
```tsx
<Tab label="Audit Log" />
```
to:
```tsx
<Tab label="Audit Log" />
<Tab label="Skills" />
```

- [ ] **Add Skills tab content after the Audit Log tab block (after line 446)**

```tsx
{tab === 3 && (
  <Box sx={{ pt: 2 }}>
    {skillsLoading && (
      <Typography variant="body2" color="text.secondary">
        Loading skills...
      </Typography>
    )}
    {skillsError && (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography variant="body2" color="error">
          {skillsError}
        </Typography>
        <Button size="small" onClick={fetchSkills} variant="outlined">
          Retry
        </Button>
      </Box>
    )}
    {!skillsLoading && !skillsError && skills.length === 0 && (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
        No skills installed. Skills are created when an agent proposes a new tool.
      </Typography>
    )}
    {skills.map((skill) => (
      <Box key={skill.name}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            py: 1,
            borderBottom: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {skill.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {skill.description}
            </Typography>
          </Box>
          <FormControlLabel
            control={
              <Switch
                checked={skill.enabled}
                onChange={(e) => handleToggleSkill(skill.name, e.target.checked)}
                size="small"
              />
            }
            label={skill.enabled ? "On" : "Off"}
            labelPlacement="end"
            sx={{ mr: 0 }}
          />
          <Button
            size="small"
            variant="text"
            onClick={() => setExpandedSkill(expandedSkill === skill.name ? null : skill.name)}
          >
            {expandedSkill === skill.name ? "Hide" : "View"}
          </Button>
          <Button
            size="small"
            color="error"
            variant="text"
            onClick={() => setConfirmDeleteSkill(skill.name)}
          >
            Delete
          </Button>
        </Box>
        {expandedSkill === skill.name && (
          <Box
            component="pre"
            sx={{
              p: 2,
              bgcolor: "grey.900",
              color: "grey.100",
              borderRadius: 1,
              overflow: "auto",
              fontSize: 12,
              maxHeight: 300,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {skill.content}
          </Box>
        )}
      </Box>
    ))}
  </Box>
)}
```

- [ ] **Add delete confirmation dialog**

After the existing `confirmClear` dialog (after line 470), add:

```tsx
<Dialog open={confirmDeleteSkill !== null} onClose={() => setConfirmDeleteSkill(null)}>
  <DialogTitle>Delete Skill?</DialogTitle>
  <DialogContent>
    <DialogContentText>
      This will permanently delete the skill <strong>{confirmDeleteSkill}</strong>.
      This action cannot be undone.
    </DialogContentText>
  </DialogContent>
  <DialogActions>
    <Button onClick={() => setConfirmDeleteSkill(null)}>Cancel</Button>
    <Button
      onClick={() => confirmDeleteSkill && handleDeleteSkill(confirmDeleteSkill)}
      color="error"
    >
      Delete
    </Button>
  </DialogActions>
</Dialog>
```

- [ ] **Commit**

```bash
git add src/renderer/components/settings/SettingsModal.tsx
git commit -m "feat: add Skills tab to Settings modal"
```

---

### Task 8: Full verification

- [ ] **Typecheck**

Run: `bun run typecheck`
Expected: zero errors

- [ ] **Lint + format**

Run: `bun run check`
Expected: clean

- [ ] **Run full test suite**

Run: `bun run test`
Expected: all tests pass

- [ ] **Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address review findings"
```
