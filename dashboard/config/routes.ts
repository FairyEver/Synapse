export default [
  {
    path: '/login',
    layout: false,
    component: './Login',
  },
  {
    path: '/signup',
    layout: false,
    component: './Signup',
  },
  {
    path: '/team-invite',
    layout: false,
    component: './TeamInvite',
  },
  {
    path: '/',
    redirect: '/system',
  },
  {
    path: '/system',
    name: '系统',
    icon: 'dashboard',
    component: './System',
  },
  {
    path: '/users',
    name: '用户',
    icon: 'user',
    component: './Users',
    access: 'canAdmin',
  },
  {
    path: '/teams',
    name: '团队',
    icon: 'team',
    component: './Teams',
  },
  {
    path: '/teams/:teamId/permissions',
    name: '团队权限',
    hideInMenu: true,
    component: './TeamPermissions',
    access: 'canAdmin',
  },
  {
    path: '/invitations',
    name: '邀请',
    icon: 'mail',
    component: './Invitations',
    access: 'canAdmin',
  },
  {
    path: '/audit-logs',
    name: '审计日志',
    icon: 'fileSearch',
    component: './AuditLogs',
    access: 'canAdmin',
  },
  {
    path: '/backup',
    name: '备份管理',
    icon: 'cloudServer',
    component: './Backup',
    access: 'canAdmin',
  },
  {
    path: '/logs',
    name: '系统日志',
    icon: 'fileText',
    component: './Logs',
    access: 'canAdmin',
  },
  {
    path: '*',
    redirect: '/system',
  },
];
