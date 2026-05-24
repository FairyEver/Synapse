import { PageContainer, ProCard } from '@ant-design/pro-components';
import { history, useParams, useSearchParams } from '@umijs/max';
import { App, Button, Checkbox, Result, Space, Spin, Table, Tag, Typography } from 'antd';
import React from 'react';

import {
  adminApi,
  type PermissionDefinition,
  type TeamAccessRoleRow,
} from '@/services/synapse/api';

const permissionGroupLabels: Record<string, string> = {
  agent: 'Agent',
  automation: '自动化',
  content: '内容',
  database: '数据',
  local: '本机',
  team: '团队',
  usage: '使用分析',
};

function formatPermissionGroup(group: string): string {
  return permissionGroupLabels[group] ?? group;
}

function groupPermissions(permissions: readonly PermissionDefinition[]) {
  const grouped = new Map<string, PermissionDefinition[]>();
  for (const permission of permissions) {
    const group = formatPermissionGroup(permission.group);
    grouped.set(group, [...(grouped.get(group) ?? []), permission]);
  }
  return [...grouped.entries()].map(([group, items]) => ({ group, permissions: items }));
}

export default function TeamPermissionsPage() {
  const { message } = App.useApp();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const teamId = String(params.teamId ?? '');
  const teamName = searchParams.get('name') ?? '';
  const [permissions, setPermissions] = React.useState<PermissionDefinition[]>([]);
  const [permissionKeys, setPermissionKeys] = React.useState<Set<string>>(() => new Set());
  const [accessRoles, setAccessRoles] = React.useState<TeamAccessRoleRow[]>([]);
  const [rolePermissionKeys, setRolePermissionKeys] = React.useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [nextPermissions, entitlements, roles] = await Promise.all([
        adminApi.listPermissions(),
        adminApi.listTeamEntitlements(teamId),
        adminApi.listTeamAccessRoles(teamId),
      ]);
      setPermissions(nextPermissions);
      setPermissionKeys(new Set(entitlements.permissionKeys));
      setAccessRoles(roles);
      setRolePermissionKeys(Object.fromEntries(roles.map((role) => [role.id, new Set(role.permissionKeys)])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (teamId) void loadData();
  }, [teamId]);

  function updatePermissionKey(permissionKey: string, checked: boolean) {
    setPermissionKeys((previous) => {
      const next = new Set(previous);
      if (checked) next.add(permissionKey);
      else next.delete(permissionKey);
      return next;
    });
    if (!checked) {
      setRolePermissionKeys((previous) => Object.fromEntries(
        Object.entries(previous).map(([roleId, keys]) => {
          const next = new Set(keys);
          next.delete(permissionKey);
          return [roleId, next];
        }),
      ));
    }
  }

  function updateRolePermissionKey(roleId: string, permissionKey: string, checked: boolean) {
    setRolePermissionKeys((previous) => {
      const nextKeys = new Set(previous[roleId] ?? []);
      if (checked) nextKeys.add(permissionKey);
      else nextKeys.delete(permissionKey);
      return { ...previous, [roleId]: nextKeys };
    });
  }

  async function saveTeamPermissions() {
    setSaving(true);
    try {
      const orderedKeys = permissions.filter((permission) => permissionKeys.has(permission.key)).map((permission) => permission.key);
      const entitlementSet = new Set(orderedKeys);
      await adminApi.replaceTeamPermissions(teamId, {
        permissionKeys: orderedKeys,
        rolePermissions: accessRoles
          .filter((role) => !role.locked)
          .map((role) => ({
            roleId: role.id,
            permissionKeys: permissions
              .filter((permission) => entitlementSet.has(permission.key))
              .filter((permission) => rolePermissionKeys[role.id]?.has(permission.key))
              .map((permission) => permission.key),
          })),
      });
      history.push('/teams');
    } catch (caught) {
      message.error(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spin />;
  if (error) return <Result status="error" title={error} extra={<Button onClick={() => void loadData()}>重试</Button>} />;

  const permissionGroups = groupPermissions(permissions);

  return (
    <PageContainer title={teamName ? `${teamName} 权限` : '团队权限'} extra={<Button onClick={() => history.push('/teams')}>返回</Button>}>
      <ProCard direction="column" gutter={[0, 16]}>
        <ProCard title="团队可用功能">
          <Space direction="vertical">
            {permissionGroups.map((group) => (
              <Space key={group.group} direction="vertical">
                <Typography.Text type="secondary">{group.group}</Typography.Text>
                <Checkbox.Group
                  value={Array.from(permissionKeys)}
                  options={group.permissions.map((permission) => ({
                    label: permission.label,
                    value: permission.key,
                  }))}
                  onChange={(values) => {
                    const next = new Set(values.map(String));
                    for (const permission of group.permissions) {
                      updatePermissionKey(permission.key, next.has(permission.key));
                    }
                  }}
                />
              </Space>
            ))}
          </Space>
        </ProCard>
        <ProCard title="角色可用功能">
          <Table
            rowKey="id"
            pagination={false}
            dataSource={accessRoles}
            columns={[
              {
                title: '角色',
                dataIndex: 'name',
                render: (_, role: TeamAccessRoleRow) => (
                  <Space>
                    <span>{role.name}</span>
                    {role.locked ? <Tag>系统</Tag> : null}
                  </Space>
                ),
              },
              ...permissions.map((permission) => ({
                title: permission.label,
                render: (_: unknown, role: TeamAccessRoleRow) => (
                  <Checkbox
                    checked={permissionKeys.has(permission.key) && Boolean(rolePermissionKeys[role.id]?.has(permission.key))}
                    disabled={saving || role.locked || !permissionKeys.has(permission.key)}
                    onChange={(event) => updateRolePermissionKey(role.id, permission.key, event.target.checked)}
                  />
                ),
              })),
            ]}
          />
        </ProCard>
        <Space>
          <Button onClick={() => history.push('/teams')}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void saveTeamPermissions()}>
            保存
          </Button>
        </Space>
      </ProCard>
    </PageContainer>
  );
}
