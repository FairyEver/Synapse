# API + MCP CLI Retirement Documentation Cleanup Spec

## Background

Synapse is retiring its own `synapse` CLI as a capability entrypoint. The supported capability surfaces are now:

- MCP tools for external agents and automation.
- Authenticated local HTTP `/api` actions for internal callers.

The capability registry remains the source of truth for capability IDs, MCP tool names, HTTP actions, and service methods.

## Problem

Runtime code, tests, settings UI, diagnostics, and public website docs have already moved to the API + MCP model. Some historical `docs/superpowers/specs` and `docs/superpowers/plans` files still describe Synapse-owned CLI commands as active capability entrypoints, including examples such as `synapse database ...`, `synapse scheduler ...`, and `synapse content ...`.

These files are often read by future agents before code changes. Leaving unqualified CLI instructions there can reintroduce old assumptions.

## Goals

- Mark affected historical superpowers specs/plans as superseded where they still discuss Synapse-owned CLI capability entrypoints.
- Replace active capability-chain language from API + CLI + MCP to API + MCP.
- Add a regression test that fails when active docs reintroduce Synapse-owned CLI command examples or `CLI command` matrix columns.
- Keep external agent CLI mentions, such as Claude Code, Codex, Gemini, Obsidian, or build tooling, out of scope.

## Non-Goals

- Do not remove user-machine `synapse` shims.
- Do not rewrite archived plans wholesale.
- Do not change runtime capability behavior.
- Do not remove unrelated external CLI documentation.

## Acceptance Criteria

- `docs/superpowers` no longer contains unqualified Synapse-owned CLI capability promises.
- Any historical doc that retains old CLI text clearly states it is superseded by the API + MCP model.
- Unit tests cover the docs regression.
- Existing API/MCP parity, diagnostics, build, and hard-constraint checks still pass.
