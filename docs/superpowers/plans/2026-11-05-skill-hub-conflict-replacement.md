# Skill Hub Conflict Replacement Implementation Plan

> **For agentic workers:** Implement on the current branch with the approved interaction and verify each layer.

**Goal:** Allow confirmed whole-directory replacement of a same-name Skill in a selected global or project location.

**Architecture:** Keep replaceable targets visible in the shared installer. Bind confirmation to the resolved directory. Stage the verified Hub package and use the existing transactional directory swap with environment inheritance disabled for a cross-source replacement.

**Spec:** [Skill Hub installation design](../specs/2026-11-04-snap-skill-hub-design.md)

- [x] Cover both scopes, opening the old folder, explicit confirmation, removing old-only files and env, and restoring the old directory on a late failure.
- [x] Expose a replaceable directory conflict, revalidate it immediately before the swap, and surface the two actions in the shared installer.
- [x] Verify the installer, shell bridge, desktop types and architecture constraints. Update the installation rules and release notes.
