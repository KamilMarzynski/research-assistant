# Research Eval Harness Design

> **Status:** Ready for review | **Fixture:** `solid-state-batteries` | **Target:** Artifact quality + task completion traces

---

## 1. Problem

Need an implementation-agnostic e2e eval for research quality. If Pi agent swapped for LangGraph later, same test must pass. Tests artifact structure, cross-source synthesis accuracy, and actionable quality — not UI or internal wiring.

---

## 2. Architecture

```
tests/eval/
├── fixtures/
│   └── solid-state-batteries/
│       ├── local-project/              # Copied to believable temp location
│       │   ├── notes/
│       │   │   ├── reading-notes.md    # Book notes (Toyota claim, skeptical)
│       │   │   └── meeting-notes.txt   # Colleague convo (QuantumScape challenges)
│       │   ├── researches/
│       │   │   └── initial-findings.md # User's partial draft (CATL timeline)
│       │   ├── scripts/
│       │   │   └── analyze_battery_data.py  # Parses CSV
│       │   └── data/
│       │       └── battery_specimens.csv      # Manufacturer specs + targets
│       └── scholar/
│           ├── GOAL.md                 # Research goal: SSB commercial by 2030?
│           └── FILES.md                # Truthful description of local-project/
├── harness.ts                          # Main orchestrator (TypeScript/Bun)
├── promptfooconfig.yaml                # Three-tier rubric assertions
└── reports/                            # gitignored
    └── 2026-05-11T14-30-00-ssb/
        ├── 00-fixture/                 # Exact copy of fixture
        ├── 01-local-project/             # Snapshot of temp dir during run
        ├── 02-scholar/                   # GOAL.md + FILES.md used
        ├── 03-db-dump/                   # messages, tasks, artifacts from DB
        ├── 04-artifacts/                 # Research output files
        ├── 05-promptfoo/                 # Raw eval results
        └── report.md                     # Human-readable summary
```

---

## 3. Harness Flow

```
1. Generate run ID (timestamp + fixture slug)
2. Create temp dir: ~/Projects/private/research-assistant-tests/eval-ssb-<timestamp>/
3. Copy fixture local-project/ → temp dir
4. Launch Electron app (headless, PLAYWRIGHT_TEST=1)
5. Create project via IPC CREATE_PROJECT with folderPath = temp dir
6. Copy fixture scholar/ → ~/.scholar/projects/<slug>/
7. Send message: "Research whether solid-state batteries will reach commercial EV scale by 2030"
8. Poll DB for task completion (timeout 5 min)
9. On completion:
   a. Snapshot everything → reports/<run-id>/
   b. Run Promptfoo on artifact
   c. Generate report.md
10. Cleanup:
    a. Delete project from DB
    b. Delete ~/.scholar/projects/<slug>/
    c. Delete temp dir
    d. Close Electron
```

**Invariant:** After cleanup, system is back to pre-test state. Only `reports/` grows.

---

## 4. Fixture: Solid-State Batteries

### 4.1 Local Project Files

| File | Format | Content | What Agent Must Do |
|------|--------|---------|-------------------|
| `notes/reading-notes.md` | Markdown | Book notes about SSB. Mentions Toyota 2026 claim with skepticism (author says "optimistic, needs verification") | Extract claim + skepticism |
| `notes/meeting-notes.txt` | Plain text | Colleague says ceramic separator is main blocker for mass production | Identify technical barrier |
| `researches/initial-findings.md` | Markdown | User draft with partial CATL info: "targeting 2028-2030 for EV scale" | Note timeline, identify gap vs Toyota |
| `data/battery_specimens.csv` | CSV | 4 rows: manufacturer, chemistry, density (Wh/kg), prototype year, commercial target | Parse or reference data |
| `scripts/analyze_battery_data.py` | Python | Reads CSV, finds leader by energy density, prints summary | Optionally run to get analysis |

### 4.2 Scholar Config Files

**GOAL.md:**
```markdown
# Solid-State Battery Commercial Viability

Research whether solid-state batteries will reach commercial EV scale by 2030.
Consider:
- Timeline claims from major manufacturers
- Technical barriers (especially ceramic separator and manufacturing)
- Energy density improvements needed
- Whether optimistic claims are credible
```

**FILES.md:**
```markdown
# Project Files

## Local Notes
- `notes/reading-notes.md` — Book notes on SSB technology, includes Toyota 2026 claim
- `notes/meeting-notes.txt` — Colleague discussion, ceramic separator as blocker
- `researches/initial-findings.md` — Partial draft with CATL 2028-2030 timeline

## Data
- `data/battery_specimens.csv` — Manufacturer specs (Toyota, QuantumScape, CATL, Samsung)
- `scripts/analyze_battery_data.py` — Script to analyze CSV data
```

---

## 5. Three-Tier Rubric (Promptfoo)

### Tier 1 — Completeness (Deterministic + LLM)

Checks that artifact exists and references expected sources.

```yaml
asserts:
  - type: contains
    value: "solid-state"
  - type: contains
    value: "2030"
  - type: contains
    value: "Toyota"
  - type: contains
    value: "QuantumScape"
  - type: contains
    value: "CATL"
  - type: contains
    value: "ceramic separator"
  - type: llm-rubric
    value: "The document has a clear title, executive summary, and a sources/references section"
```

### Tier 2 — Cross-Source Synthesis (LLM Rubric)

Evaluates whether agent reconciled conflicting claims and used both local + web sources.

```yaml
asserts:
  - type: llm-rubric
    value: |
      The document reconciles the conflicting timeline claims:
      - Toyota's 2026 claim (from reading-notes.md)
      - CATL's 2028-2030 target (from initial-findings.md)
      - QuantumScape's manufacturing challenges (from meeting-notes.txt)
      Does not simply list them but provides analysis of which is most credible.
  - type: llm-rubric
    value: |
      The document identifies the ceramic separator as a key technical barrier
      and explains why it affects mass production timelines.
  - type: llm-rubric
    value: |
      The document references data from battery_specimens.csv or its analysis
      (e.g., energy density numbers, manufacturer comparison).
```

### Tier 3 — Actionable Quality (LLM Rubric)

Scores whether output is useful for decision-making.

```yaml
asserts:
  - type: llm-rubric
    value: |
      Rate the document's actionable quality for an engineer making a go/no-go decision
      on investing in SSB technology for EVs by 2030.
      Score: 1 = vague, no decision support; 5 = clear recommendation with evidence.
      Provide the score and one-sentence reasoning.
```

---

## 6. Report Format

```markdown
# Eval Run: solid-state-batteries @ 2026-05-11T14:30:00

## Summary
| Metric | Value |
|--------|-------|
| Task completed | ✅ 3m 42s |
| Artifact count | 2 files |
| Tier 1 pass | 7/7 |
| Tier 2 pass | 3/3 |
| Tier 3 score | 4/5 — "Clear timeline analysis but lacks specific investment recommendation" |

## Tier 1 — Completeness
- ✅ Contains "solid-state"
- ✅ Contains "2030"
- ✅ Contains "Toyota"
- ✅ Contains "QuantumScape"
- ✅ Contains "CATL"
- ✅ Contains "ceramic separator"
- ✅ Has clear structure (title, summary, sources)

## Tier 2 — Cross-Source Synthesis
- ✅ Reconciled Toyota 2026 vs CATL 2028-2030 (favors CATL as more realistic)
- ✅ Identified ceramic separator as mass production blocker
- ✅ Referenced CSV data (energy density 400 Wh/kg for Toyota)

## Tier 3 — Actionable Quality
- Score: 4/5
- Reasoning: "Clear timeline analysis with credible sources, but stops short of explicit go/no-go recommendation"

## Artifacts
- `ssb-analysis.md` — Main synthesis
- `timeline-table.md` — Manufacturer comparison

## Full Output
See `04-artifacts/` and `05-promptfoo/results.json`
```

---

## 7. CLI Interface

```bash
# Run single fixture
bun run test:eval --fixture solid-state-batteries

# Run with specific judge model (default: gemma4:9b-cloud)
bun run test:eval --fixture solid-state-batteries --judge gemma4:27b-cloud

# Keep temp files for debugging (skip cleanup)
bun run test:eval --fixture solid-state-batteries --keep

# List past runs
bun run test:eval --list

# Show report for specific run
bun run test:eval --show 2026-05-11T14-30-00-ssb
```

---

## 8. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Fixture location | `tests/eval/fixtures/` | Version controlled, portable |
| Temp project dir | `~/Projects/private/research-assistant-tests/` | Believable path, outside `.scholar` |
| Judge model | `gemma4:9b-cloud` via Ollama proxy | Fast, cheap, sufficient for rubric scoring |
| Cleanup default | Yes, with `--keep` override | Keeps system clean, opt-in for debugging |
| Report storage | `tests/eval/reports/` (gitignored) | Persistent, timestamped, inspectable |
| DB snapshot | JSON dump of messages + tasks + artifacts | Full trace of what happened |

---

## 9. Open Questions

1. **Timeout:** 5 minutes enough for shallow research? Deep research may need 10m+. Make configurable per fixture?
2. **Parallel runs:** Should multiple eval runs be allowed simultaneously? Sequential is safer (shared Electron, shared DB).
3. **Web mocking:** Should web search results be mocked for determinism, or use real search? Real search = flakier but tests actual capability. Mock = deterministic but less realistic.
4. **Python script execution:** Should the harness verify the agent actually ran `analyze_battery_data.py`, or just that the artifact references its output?

---

## 10. Next Steps (Post-Approval)

1. Write `promptfooconfig.yaml` with rubric definitions
2. Create fixture files (local-project/ + scholar/)
3. Implement `harness.ts` (orchestrator)
4. Add `bun run test:eval` to `package.json`
5. Write first test run, iterate on rubric thresholds
