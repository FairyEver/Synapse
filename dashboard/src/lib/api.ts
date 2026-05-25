export type AdminSession = {
  email: string;
  role: 'admin' | 'user';
};

export type SystemOverview = {
  serverTime: string;
  counts: {
    auditLogs: number;
    users: number;
    teams: number;
    invitations: number;
    teamEntitlements: number;
    teamAccessRoles: number;
    teamAccessRolePermissions: number;
    teamMemberAccessRoles: number;
  };
};

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type AuditLog = {
  id: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: unknown;
  ipAddress: string;
  createdAt: string;
};

export type AdminUserRow = {
  id: string;
  email: string;
  status: 'active' | 'disabled';
  memberships: Array<{
    id?: string;
    role: 'owner' | 'member';
    team: { id: string; name: string };
    accessRoles: Array<{ role: { id: string; name: string } }>;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type AdminTeamRow = {
  id: string;
  name: string;
  createdByUser: { email: string };
  memberships: Array<{
    id: string;
    role: 'owner' | 'member';
    user: { id?: string; email: string };
    accessRoles: Array<{ role: { id: string; name: string } }>;
    createdAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type PermissionDefinition = {
  key: string;
  label: string;
  description?: string;
  group: string;
  level: 'module' | 'action' | 'management';
  status: 'active' | 'deprecated';
  clientVisibility: 'visible' | 'hidden';
};

export type TeamEntitlementsResponse = {
  permissionKeys: string[];
};

export type DeletedRolePermission = {
  roleId: string;
  permissionKey: string;
};

export type ReplaceTeamEntitlementsResponse = TeamEntitlementsResponse & {
  deletedRolePermissions: DeletedRolePermission[];
};

export type TeamAccessRoleRow = {
  id: string;
  name: string;
  description: string | null;
  kind: 'system' | 'custom';
  locked: boolean;
  sortOrder: number;
  permissionKeys: string[];
  createdAt: string;
  updatedAt: string;
};

export type MemberAccessRolesResponse = {
  roles: Array<{
    id: string;
    name: string;
    description: string | null;
    kind: 'system' | 'custom';
    locked: boolean;
    sortOrder: number;
    assignedAt: string;
  }>;
};

export type AdminInvitationRow = {
  id: string;
  type: 'user_signup' | 'team_join';
  inviteUrl: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdByAdmin: { email: string } | null;
  createdByUser: { email: string } | null;
  team: { name: string } | null;
  acceptedByUser: { email: string } | null;
  createdAt: string;
};

export type CreateSignupInvitationResponse = {
  id: string;
  token: string;
  inviteUrl: string;
  expiresAt: string;
};

export type BackupFile = {
  filename: string;
  size: number;
  createdAt: string;
};

export type BackupResult = {
  filename: string;
  size: number;
  uploadedAt: string;
  status: 'success' | 'failed';
  error?: string;
};

export type LogFileInfo = {
  name: string;
  size: number;
  modifiedAt: string;
};

export type LogEntry = {
  time: string;
  level: string;
  msg: string;
  req?: { method: string; url: string };
  err?: { message: string; stack: string };
};

export type UserTokenPair = {
  accessToken: string;
  refreshToken: string;
};

type RequestOptions = RequestInit;

const adminApiBasePath = '/api/admin';
const authExpiredListeners = new Set<() => void>();

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readErrorMessage(response: Response) {
  const fallback = response.statusText || '请求失败';

  try {
    const payload = (await response.json()) as { message?: unknown };

    if (typeof payload.message === 'string') {
      return payload.message;
    }

    if (Array.isArray(payload.message)) {
      return (
        payload.message.filter((item) => typeof item === 'string').join('，') ||
        fallback
      );
    }
  } catch {
    return fallback;
  }

  return fallback;
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const headers =
    options.body === undefined
      ? options.headers
      : {
          'Content-Type': 'application/json',
          ...options.headers,
        };

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    if (shouldNotifyAuthExpired(path, response.status)) {
      notifyAuthExpired();
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function subscribeAuthExpired(listener: () => void) {
  authExpiredListeners.add(listener);
  return () => {
    authExpiredListeners.delete(listener);
  };
}

function notifyAuthExpired() {
  for (const listener of authExpiredListeners) {
    listener();
  }
}

function shouldNotifyAuthExpired(path: string, status: number) {
  if (status !== 401) return false;
  if (!path.startsWith(adminApiBasePath)) return false;
  return ![
    `${adminApiBasePath}/login`,
    `${adminApiBasePath}/logout`,
    `${adminApiBasePath}/session`,
  ].includes(path);
}

function paginationSuffix(options: { page?: number; pageSize?: number }) {
  const query = new URLSearchParams();
  if (options.page) query.set('page', String(options.page));
  if (options.pageSize) query.set('pageSize', String(options.pageSize));
  const value = query.toString();
  return value ? `?${value}` : '';
}

function querySuffix(options: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value));
    }
  }
  const value = query.toString();
  return value ? `?${value}` : '';
}

async function downloadFile(path: string, filename: string) {
  const response = await fetch(path, { credentials: 'include' });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
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
  getSession: () => request<AdminSession>(`${adminApiBasePath}/session`),
  login: (credentials: { email: string; password: string }) =>
    request<AdminSession>(`${adminApiBasePath}/login`, {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  logout: () =>
    request<{ ok: true }>(`${adminApiBasePath}/logout`, { method: 'POST' }),
  getSystemOverview: () =>
    request<SystemOverview>(`${adminApiBasePath}/system`),
  createSignupInvitation: () =>
    request<CreateSignupInvitationResponse>(`${adminApiBasePath}/invitations`, {
      method: 'POST',
    }),
  listInvitations: (options: { page?: number; pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminInvitationRow>>(
      `${adminApiBasePath}/invitations${paginationSuffix(options)}`,
    ),
  deleteInvitation: (id: string) =>
    request<{ ok: true }>(
      `${adminApiBasePath}/invitations/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
    ),
  listUsers: (options: { page?: number; pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminUserRow>>(
      `${adminApiBasePath}/users${paginationSuffix(options)}`,
    ),
  updateUserStatus: (id: string, status: 'active' | 'disabled') =>
    request<AdminUserRow>(`${adminApiBasePath}/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  listTeams: (options: { page?: number; pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminTeamRow>>(
      `${adminApiBasePath}/teams${paginationSuffix(options)}`,
    ),
  listPermissions: () =>
    request<PermissionDefinition[]>(`${adminApiBasePath}/permissions`),
  listTeamEntitlements: (teamId: string) =>
    request<TeamEntitlementsResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/entitlements`,
    ),
  replaceTeamEntitlements: (teamId: string, permissionKeys: string[]) =>
    request<ReplaceTeamEntitlementsResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/entitlements`,
      {
        method: 'PUT',
        body: JSON.stringify({ permissionKeys }),
      },
    ),
  replaceTeamPermissions: (
    teamId: string,
    input: {
      permissionKeys: string[];
      rolePermissions: Array<{ roleId: string; permissionKeys: string[] }>;
    },
  ) =>
    request<{
      permissionKeys: string[];
      rolePermissions: Array<{ roleId: string; permissionKeys: string[] }>;
    }>(`${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/permissions`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listTeamAccessRoles: (teamId: string) =>
    request<TeamAccessRoleRow[]>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/access-roles`,
    ),
  replaceRolePermissions: (
    teamId: string,
    roleId: string,
    permissionKeys: string[],
  ) =>
    request<TeamEntitlementsResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/access-roles/${encodeURIComponent(roleId)}/permissions`,
      {
        method: 'PUT',
        body: JSON.stringify({ permissionKeys }),
      },
    ),
  listMemberAccessRoles: (teamId: string, membershipId: string) =>
    request<MemberAccessRolesResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/access-roles`,
    ),
  assignMemberAccessRole: (
    teamId: string,
    membershipId: string,
    roleId: string,
  ) =>
    request<MemberAccessRolesResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/access-roles`,
      {
        method: 'POST',
        body: JSON.stringify({ roleId }),
      },
    ),
  replaceMemberAccessRoles: (
    teamId: string,
    membershipId: string,
    roleIds: string[],
  ) =>
    request<MemberAccessRolesResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/access-roles`,
      {
        method: 'PUT',
        body: JSON.stringify({ roleIds }),
      },
    ),
  removeMemberAccessRole: (
    teamId: string,
    membershipId: string,
    roleId: string,
  ) =>
    request<MemberAccessRolesResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}/access-roles/${encodeURIComponent(roleId)}`,
      { method: 'DELETE' },
    ),
  listBackups: () => request<BackupFile[]>(`${adminApiBasePath}/backup/list`),
  triggerBackup: () =>
    request<BackupResult>(`${adminApiBasePath}/backup`, { method: 'POST' }),
  downloadBackup: (filename: string) =>
    downloadFile(
      `${adminApiBasePath}/backup/download/${encodeURIComponent(filename)}`,
      filename,
    ),
  deleteBackup: (filename: string) =>
    request<{ ok: true }>(
      `${adminApiBasePath}/backup/${encodeURIComponent(filename)}`,
      {
        method: 'DELETE',
      },
    ),
  listAuditLogs: (
    options: {
      action?: string;
      from?: string;
      to?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) =>
    request<PaginatedResponse<AuditLog>>(
      `${adminApiBasePath}/audit-logs${querySuffix(options)}`,
    ),
  exportAuditLogs: (
    options: { action?: string; from?: string; to?: string } = {},
  ) =>
    downloadFile(
      `${adminApiBasePath}/audit-logs/export${querySuffix(options)}`,
      'audit-logs.csv',
    ),
  listLogFiles: () => request<LogFileInfo[]>(`${adminApiBasePath}/logs/files`),
  fetchRecentLogs: (options: { level?: string; limit?: number } = {}) =>
    request<LogEntry[]>(
      `${adminApiBasePath}/logs/recent${querySuffix(options)}`,
    ),
  downloadLogs: (options: { from?: string; to?: string } = {}) =>
    downloadFile(
      `${adminApiBasePath}/logs/download${querySuffix(options)}`,
      'logs.zip',
    ),
  cleanupLogs: (before: string) =>
    request<{ deleted: number }>(
      `${adminApiBasePath}/logs/cleanup?${new URLSearchParams({ before }).toString()}`,
      { method: 'DELETE' },
    ),
};

export const userApi = {
  register: (input: {
    invitationToken: string;
    email: string;
    password: string;
  }) =>
    request<UserTokenPair>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  joinTeam: (input: { invitationToken: string }) =>
    request<unknown>('/api/teams/join', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
