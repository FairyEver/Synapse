import { request } from '@umijs/max';

type ApiRequestOptions = {
  readonly method?: string;
  readonly data?: unknown;
  readonly credentials?: RequestCredentials;
  readonly skipErrorHandler?: boolean;
};

export interface AdminSession {
  readonly email: string;
  readonly role: 'admin' | 'user';
}

export interface SystemOverview {
  readonly serverTime: string;
  readonly counts: {
    readonly auditLogs: number;
    readonly users: number;
    readonly teams: number;
    readonly invitations: number;
    readonly teamEntitlements: number;
    readonly teamAccessRoles: number;
    readonly teamAccessRolePermissions: number;
    readonly teamMemberAccessRoles: number;
  };
}

export interface PaginatedResponse<T> {
  readonly data: T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface AuditLog {
  readonly id: string;
  readonly adminEmail: string;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly detail: unknown;
  readonly ipAddress: string;
  readonly createdAt: string;
}

export interface AdminUserRow {
  readonly id: string;
  readonly email: string;
  readonly status: 'active' | 'disabled';
  readonly memberships: Array<{
    readonly id?: string;
    readonly role: 'owner' | 'member';
    readonly team: { readonly id: string; readonly name: string };
    readonly accessRoles: Array<{ readonly role: { readonly id: string; readonly name: string } }>;
  }>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminTeamRow {
  readonly id: string;
  readonly name: string;
  readonly createdByUser: { readonly email: string };
  readonly memberships: Array<{
    readonly id: string;
    readonly role: 'owner' | 'member';
    readonly user: { readonly id?: string; readonly email: string };
    readonly accessRoles: Array<{ readonly role: { readonly id: string; readonly name: string } }>;
    readonly createdAt: string;
  }>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PermissionDefinition {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly group: string;
  readonly level: 'module' | 'action' | 'management';
  readonly status: 'active' | 'deprecated';
  readonly clientVisibility: 'visible' | 'hidden';
}

export interface TeamEntitlementsResponse {
  readonly permissionKeys: string[];
}

export interface TeamPermissionsResponse {
  readonly permissionKeys: string[];
  readonly rolePermissions: Array<{
    readonly roleId: string;
    readonly permissionKeys: string[];
  }>;
}

export interface TeamRolePermissionsInput {
  readonly roleId: string;
  readonly permissionKeys: readonly string[];
}

export interface TeamAccessRoleRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: 'system' | 'custom';
  readonly locked: boolean;
  readonly sortOrder: number;
  readonly permissionKeys: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemberAccessRoleRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly kind: 'system' | 'custom';
  readonly locked: boolean;
  readonly sortOrder: number;
  readonly assignedAt: string;
}

export interface MemberAccessRolesResponse {
  readonly roles: MemberAccessRoleRow[];
}

export interface AdminInvitationRow {
  readonly id: string;
  readonly type: 'user_signup' | 'team_join';
  readonly inviteUrl: string | null;
  readonly expiresAt: string;
  readonly usedAt: string | null;
  readonly createdByAdmin: { readonly email: string } | null;
  readonly createdByUser: { readonly email: string } | null;
  readonly team: { readonly name: string } | null;
  readonly acceptedByUser: { readonly email: string } | null;
  readonly createdAt: string;
}

export interface CreateSignupInvitationResponse {
  readonly id: string;
  readonly token: string;
  readonly inviteUrl: string;
  readonly expiresAt: string;
}

export interface BackupFile {
  readonly filename: string;
  readonly size: number;
  readonly createdAt: string;
}

export interface BackupResult {
  readonly filename: string;
  readonly size: number;
  readonly uploadedAt: string;
  readonly status: 'success' | 'failed';
  readonly error?: string;
}

export interface UserRegisterInput {
  readonly invitationToken: string;
  readonly email: string;
  readonly password: string;
}

export interface TeamUser {
  readonly id: string;
  readonly email: string;
  readonly status: 'active' | 'disabled';
}

export interface TeamMember {
  readonly id: string;
  readonly userId: string;
  readonly teamId: string;
  readonly role: 'owner' | 'member';
  readonly createdAt: string;
  readonly user: TeamUser;
  readonly accessRoles: Array<{ readonly role: { readonly id: string; readonly name: string } }>;
}

export interface MyTeam {
  readonly id: string;
  readonly teamId: string;
  readonly userId: string;
  readonly role: 'owner' | 'member';
  readonly team: {
    readonly id: string;
    readonly name: string;
    readonly createdByUserId: string;
    readonly memberships: TeamMember[];
  };
}

export interface TeamSummary {
  readonly id: string;
  readonly name: string;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TeamInvitationResponse {
  readonly id: string;
  readonly token: string;
  readonly inviteUrl: string;
  readonly expiresAt: string;
}

export interface UserMe {
  readonly user: TeamUser;
  readonly teams: Array<{
    readonly id: string;
    readonly name: string;
    readonly membershipId: string;
    readonly membershipRole: 'owner' | 'member';
    readonly roles: Array<{ readonly id: string; readonly name: string }>;
    readonly effectivePermissions: string[];
  }>;
}

export interface LogFileInfo {
  readonly name: string;
  readonly size: number;
  readonly modifiedAt: string;
}

export interface LogEntry {
  readonly time: string;
  readonly level: string;
  readonly msg: string;
  readonly req?: { readonly method: string; readonly url: string };
  readonly err?: { readonly message: string; readonly stack: string };
}

const adminApiBasePath = '/api/admin';
export const adminAuthExpiredEvent = 'synapse:admin-auth-expired';

export function readErrorMessage(body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const value = (body as { message: unknown }).message;
    if (Array.isArray(value)) return value.join('；');
    if (typeof value === 'string') return value;
  }
  if (body && typeof body === 'object' && 'errorMessage' in body) {
    const value = (body as { errorMessage: unknown }).errorMessage;
    if (typeof value === 'string') return value;
  }
  return '请求失败';
}

function paginationSuffix(options: { readonly page?: number; readonly pageSize?: number }): string {
  const query = new URLSearchParams();
  if (options.page) query.set('page', String(options.page));
  if (options.pageSize) query.set('pageSize', String(options.pageSize));
  const value = query.toString();
  return value ? `?${value}` : '';
}

function querySuffix(options: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `?${value}` : '';
}

async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return (request as unknown as (url: string, options?: ApiRequestOptions) => Promise<T>)(path, {
    credentials: 'include',
    ...options,
  });
}

async function downloadFile(url: string, filename: string): Promise<void> {
  const response = await fetch(url, { credentials: 'include' });
  const contentType = response.headers.get('content-type');
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      window.dispatchEvent(new CustomEvent(adminAuthExpiredEvent));
    }
    const body = contentType?.includes('application/json') ? await response.json() : null;
    throw new Error(readErrorMessage(body));
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const adminApi = {
  async getSession(options: { readonly skipErrorHandler?: boolean } = {}): Promise<API.CurrentUser> {
    const session = await apiRequest<AdminSession>(`${adminApiBasePath}/session`, options);
    const name = session.email.split('@')[0] || session.email;
    return { name, email: session.email, role: session.role };
  },
  login: (input: { readonly email: string; readonly password: string }) =>
    apiRequest<AdminSession>(`${adminApiBasePath}/login`, {
      method: 'POST',
      data: input,
    }),
  logout: () => apiRequest<{ ok: true }>(`${adminApiBasePath}/logout`, { method: 'POST' }),
  getSystemOverview: () => apiRequest<SystemOverview>(`${adminApiBasePath}/system`),
  createSignupInvitation: () =>
    apiRequest<CreateSignupInvitationResponse>(`${adminApiBasePath}/invitations`, { method: 'POST' }),
  listInvitations: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    apiRequest<PaginatedResponse<AdminInvitationRow>>(`${adminApiBasePath}/invitations${paginationSuffix(options)}`),
  deleteInvitation: (id: string) =>
    apiRequest<{ ok: true }>(`${adminApiBasePath}/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteInvitations: (ids: readonly string[]) =>
    apiRequest<{ ok: true; count: number }>(`${adminApiBasePath}/invitations`, {
      method: 'DELETE',
      data: { ids },
    }),
  listUsers: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    apiRequest<PaginatedResponse<AdminUserRow>>(`${adminApiBasePath}/users${paginationSuffix(options)}`),
  updateUserStatus: (id: string, status: 'active' | 'disabled') =>
    apiRequest<AdminUserRow>(`${adminApiBasePath}/users/${id}/status`, {
      method: 'PATCH',
      data: { status },
    }),
  listPermissions: () => apiRequest<PermissionDefinition[]>(`${adminApiBasePath}/permissions`),
  listTeams: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    apiRequest<PaginatedResponse<AdminTeamRow>>(`${adminApiBasePath}/teams${paginationSuffix(options)}`),
  listTeamEntitlements: (teamId: string) =>
    apiRequest<TeamEntitlementsResponse>(`${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/entitlements`),
  replaceTeamPermissions: (
    teamId: string,
    input: { readonly permissionKeys: readonly string[]; readonly rolePermissions: readonly TeamRolePermissionsInput[] },
  ) =>
    apiRequest<TeamPermissionsResponse>(`${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/permissions`, {
      method: 'PUT',
      data: input,
    }),
  listTeamAccessRoles: (teamId: string) =>
    apiRequest<TeamAccessRoleRow[]>(`${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/access-roles`),
  listMemberAccessRoles: (teamId: string, membershipId: string) =>
    apiRequest<MemberAccessRolesResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/access-roles`,
    ),
  replaceMemberAccessRoles: (teamId: string, membershipId: string, roleIds: readonly string[]) =>
    apiRequest<MemberAccessRolesResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/access-roles`,
      {
        method: 'PUT',
        data: { roleIds },
      },
    ),
  listBackups: () => apiRequest<BackupFile[]>(`${adminApiBasePath}/backup/list`),
  triggerBackup: () => apiRequest<BackupResult>(`${adminApiBasePath}/backup`, { method: 'POST' }),
  downloadBackup: (filename: string) =>
    downloadFile(`${adminApiBasePath}/backup/download/${encodeURIComponent(filename)}`, filename),
  deleteBackup: (filename: string) =>
    apiRequest<{ ok: true }>(`${adminApiBasePath}/backup/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
  listAuditLogs: (
    options: { readonly action?: string; readonly from?: string; readonly to?: string; readonly page?: number; readonly pageSize?: number } = {},
  ) => apiRequest<PaginatedResponse<AuditLog>>(`${adminApiBasePath}/audit-logs${querySuffix(options)}`),
  exportAuditLogs: (options: { readonly action?: string; readonly from?: string; readonly to?: string } = {}) =>
    downloadFile(`${adminApiBasePath}/audit-logs/export${querySuffix(options)}`, 'audit-logs.csv'),
  listLogFiles: () => apiRequest<LogFileInfo[]>(`${adminApiBasePath}/logs/files`),
  fetchRecentLogs: (options: { readonly level?: string; readonly limit?: number } = {}) =>
    apiRequest<LogEntry[]>(`${adminApiBasePath}/logs/recent${querySuffix(options)}`),
  downloadLogs: (options: { readonly from?: string; readonly to?: string } = {}) =>
    downloadFile(`${adminApiBasePath}/logs/download${querySuffix(options)}`, 'logs.zip'),
  cleanupLogs: (before: string) =>
    apiRequest<{ deleted: number }>(`${adminApiBasePath}/logs/cleanup?${new URLSearchParams({ before }).toString()}`, {
      method: 'DELETE',
    }),
};

export const userAuthApi = {
  register: (input: UserRegisterInput) =>
    apiRequest<{ accessToken: string; refreshToken: string }>('/api/auth/register', {
      method: 'POST',
      data: input,
    }),
};

export const userDashboardApi = {
  getMe: () => apiRequest<UserMe>('/api/auth/me'),
  getMyTeam: () => apiRequest<MyTeam | null>('/api/teams/me'),
  createTeam: (input: { readonly name: string }) =>
    apiRequest<TeamSummary>('/api/teams', {
      method: 'POST',
      data: input,
    }),
  createInvitation: () => apiRequest<TeamInvitationResponse>('/api/teams/invitations', { method: 'POST' }),
  joinTeam: (invitationToken: string) =>
    apiRequest<TeamMember>('/api/teams/join', {
      method: 'POST',
      data: { invitationToken },
    }),
  removeMember: (userId: string) =>
    apiRequest<{ ok: true }>(`/api/teams/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  leaveTeam: () => apiRequest<{ ok: true }>('/api/teams/me', { method: 'DELETE' }),
};
