# Security Review Notes

Quick audit of security-critical modules, 2025-05-30. Updated 2026-06-03.

## Solid

- **SSRF guard** (`src/main/agent/tools/web/ssrf-guard.ts`) — Private IP blocking (IPv4+IPv6), DNS resolution check, redirect following with cap, protocol lock. No bypasses.
- **Safe bash** (`src/main/agent/extensions/safe-bash.ts`) — Binary allowlist, dangerous command patterns, shell operator blocking, inline code redirect, session-scoped approval gate with SHA-256 hashed command memory, audit logging.
- **PathJail** (`src/main/agent/path-jail.ts`) — Per-component symlink traversal check via `realpathSync()`. Hard blocks on memories dir, cross-project writes. Skill dir writes require approval.
- **Docker sandbox** (`src/main/agent/extensions/docker-sandbox.ts`) — Ephemeral containers, network disabled by default, timeout, guaranteed cleanup.
- **Preload** (`src/preload/index.ts`) — Channel whitelist, no raw Node.js exposure.

## Resolved

1. **`SaveSettingsSchema.passthrough()`** (`src/main/ipc-validation.ts:42`) — Fixed 2026-06-03: changed to `.strict()`.
2. **`extractBinary` strips only one `VAR=val` prefix** (`src/main/agent/extensions/safe-bash.ts`) — Fixed 2026-06-03: loop strips all VAR=val prefixes, and `env` passthrough is skipped to find the real binary.
3. **Approval gate unbounded** (`src/main/agent/extensions/safe-bash.ts`) — Fixed 2026-06-03: `blockedPromises` restructured to per-project Map with reverse index. Per-project isolation prevents cross-project flooding.

## Notes

- Token estimation in TPS monitor uses `chars / 4.0` (heuristic). No real tokenizer.
- TPS now counts both `text_delta` and `thinking_delta` events from extended thinking models.
