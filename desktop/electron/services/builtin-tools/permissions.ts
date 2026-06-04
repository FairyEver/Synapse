import type { PermissionAction } from "../../runtime/security"
import { BuiltinToolError } from "./errors"
import type { BuiltinToolDescriptor, BuiltinToolPermissionRequirement } from "./types"

export interface ResolvedBuiltinToolPermission {
  readonly action: PermissionAction
  readonly resource: string
}

export function resolveBuiltinToolPermissions(
  descriptor: BuiltinToolDescriptor,
  input: Record<string, unknown>,
): readonly ResolvedBuiltinToolPermission[] {
  return descriptor.permissions
    .filter((permission) => conditionMatches(permission, input))
    .map((permission) => ({
      action: permission.action,
      resource: stringFromPath(input, permission.pathFromInput, descriptor.id),
    }))
}

function conditionMatches(permission: BuiltinToolPermissionRequirement, input: Record<string, unknown>): boolean {
  if (!permission.when) return true
  return Object.entries(permission.when).every(([field, value]) => input[field] === value)
}

function stringFromPath(input: Record<string, unknown>, field: string, toolId: string): string {
  const value = input[field]
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BuiltinToolError("invalid_input", `Permission path field "${field}" is missing for ${toolId}.`)
  }
  return value
}

