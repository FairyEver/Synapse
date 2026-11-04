# Cloud Tables MCP Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement each task and verify it.

**Goal:** Let an AI create and operate Synapse cloud tables as the user already signed into the desktop client.

**Architecture:** Register a separate cloud_tables domain in the existing search/invoke router. Main-process code uses fixed routes on the existing authenticated cloud-table API via AccountService. Server-side authorization and public form access continue to use the existing cloud table rules.

**Tech Stack:** Electron, TypeScript, Zod, NestJS, Vitest.

**Spec:** The approved desktop MCP entry supplements [Cloud Tables v1](../specs/2026-11-01-cloud-tables-design.md).

## Constraints and verification

- [x] Start with failing dispatcher tests for input validation, authenticated transport, blocked callers, and account switching. Keep credentials inside AccountService and audit operation metadata only.
- [x] Share the server input schemas with desktop. Map typed operations to fixed HTTP methods and paths, keep schema and record version checks, and preserve idempotency for supported writes.
- [x] Register the capability, update the existing system Skill and release notes, and verify MCP discovery, dispatch, server ACL, and anonymous create-only behavior with the lunch use case.
- [x] Run type checks, targeted suites, and an unsigned local package check before committing.
