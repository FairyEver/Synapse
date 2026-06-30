import { BadRequestException } from "@nestjs/common"
import {
  DRIVE_DEFAULT_ACCESS_SETTINGS,
  type DriveAccessSettingsInput,
  type DriveAccessSettingsUpdateInput,
  type DriveShareAccessMode,
} from "@synapse/shared"

export const DRIVE_SHARE_ACCESS_MODE = {
  linkRead: "link_read",
  linkEdit: "link_edit",
  specifiedUsersEdit: "specified_users_edit",
} as const satisfies Record<string, DriveShareAccessMode>

export type NormalizedDriveAccessSettings = Required<Pick<DriveAccessSettingsInput, "passwordEnabled" | "expiresIn">> & {
  readonly accessMode: DriveShareAccessMode
  readonly editorEmails: readonly string[]
}

export function normalizeDriveAccessSettings(input: DriveAccessSettingsUpdateInput = DRIVE_DEFAULT_ACCESS_SETTINGS): NormalizedDriveAccessSettings {
  const accessMode = normalizeDriveShareAccessMode(input.accessMode)
  const editorEmails = accessMode === DRIVE_SHARE_ACCESS_MODE.specifiedUsersEdit
    ? normalizeDriveShareEditorEmails(input.editorEmails ?? [])
    : []
  if (accessMode === DRIVE_SHARE_ACCESS_MODE.specifiedUsersEdit && editorEmails.length === 0) {
    throw new BadRequestException("请至少添加一个可编辑用户。")
  }
  return {
    passwordEnabled: input.passwordEnabled ?? DRIVE_DEFAULT_ACCESS_SETTINGS.passwordEnabled,
    expiresIn: input.expiresIn ?? DRIVE_DEFAULT_ACCESS_SETTINGS.expiresIn,
    accessMode,
    editorEmails,
  }
}

export function normalizeDriveShareAccessMode(value: unknown): DriveShareAccessMode {
  if (value === DRIVE_SHARE_ACCESS_MODE.linkEdit) return DRIVE_SHARE_ACCESS_MODE.linkEdit
  if (value === DRIVE_SHARE_ACCESS_MODE.specifiedUsersEdit) return DRIVE_SHARE_ACCESS_MODE.specifiedUsersEdit
  if (value === undefined || value === null || value === DRIVE_SHARE_ACCESS_MODE.linkRead) return DRIVE_SHARE_ACCESS_MODE.linkRead
  throw new BadRequestException("分享权限无效。")
}

export function normalizeDriveShareEditorEmails(values: readonly string[]): readonly string[] {
  const emails: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const email = normalizeDriveShareEditorEmail(value)
    if (seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

export function normalizeDriveShareEditorEmail(value: string): string {
  const email = value.trim().toLowerCase()
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new BadRequestException("可编辑用户邮箱无效。")
  }
  return email
}

export function canUserEditShare(input: {
  readonly accessMode: DriveShareAccessMode
  readonly actorUserId: string
  readonly actorEmail: string
  readonly ownerId: string
  readonly editorEmails: readonly string[]
}): boolean {
  if (input.actorUserId === input.ownerId) return true
  if (input.accessMode === DRIVE_SHARE_ACCESS_MODE.linkEdit) return true
  if (input.accessMode !== DRIVE_SHARE_ACCESS_MODE.specifiedUsersEdit) return false
  return input.editorEmails.includes(normalizeDriveShareEditorEmail(input.actorEmail))
}
