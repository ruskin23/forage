---
name: update-docs
description: Update project docs, CLAUDE.md, and memory based on session work
disable-model-invocation: true
---

When invoked, perform these three updates based on the current session's work:

## 1. Update docs/ folder

- Read through the session to identify what was built, changed, or decided
- Read the relevant docs in `docs/` (check `docs/index.md` for the doc map)
- Update existing doc files to reflect new code, types, flows, or architecture changes
- Do NOT create new doc files unless a new subsystem was introduced
- Keep the existing doc style and structure

## 2. Update CLAUDE.md

- Update the "What's Built" and "Not Yet Built" sections to reflect current state
- Update "Architecture" section if new files/patterns were added
- Add any new hard rules or conventions that were discussed or decided
- Add implicit observations about how the user thinks/works that would be helpful across sessions (e.g., preferences for error handling patterns, naming conventions, testing approach)
- Keep it concise — CLAUDE.md should be a quick reference, not a novel

## 3. Update memory

- Read the current memory file at `/home/ruskin/.claude/projects/-home-ruskin-Projects-forage/memory/MEMORY.md`
- Update with new architectural decisions, technical gotchas, and user preferences discovered in this session
- Remove or correct any stale entries that contradict what was built
- Do NOT duplicate what's already in CLAUDE.md — memory is for things that supplement CLAUDE.md (gotchas, context, patterns)

## Rules

- Read before writing — always read the current state of a file before editing
- Be surgical — update only what changed, don't rewrite entire sections
- If something moved from "Not Yet Built" to "Complete", move it
- Discuss-first rule is suspended for this skill — just make the updates
