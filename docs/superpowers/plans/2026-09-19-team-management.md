# 团队 · 实施计划

日期：2026-09-19
配套：`产品设计文档.md`、`原型.html`（同目录）
范围：`server/`、`dashboard/`。**不涉及** `desktop/`、`SynapseMobile/`、`shared/`、`document/`。

## 0. 开工前

- 先读 `产品设计文档.md`，尤其是 §3「做与不做」和 §9「要拆掉的旧栅栏」。
- 根规则：`CLAUDE.md`；改服务端控制器前读 `.claude/rules/api.md`；改 renderer 前读 `.claude/rules/frontend.md`；改测试前读 `.claude/rules/testing.md`。
- **本仓库是多会话共用工作区**（同一份目录、同一条分支）。提交一律用 `git commit -- <文件列表>`，**不要** `git add` 后再裸 `git commit`——先前的 `git add` 保护不了你，别人在这两条命令之间塞进索引的东西会被一起提交。禁止 `amend` / `reset` / 任何改写历史。
- 开工前 `git status --short` 看一眼有没有别人的在途改动，别把他们的文件卷进来。

---

## 阶段 1：数据模型与迁移

### 1.1 `server/prisma/schema.prisma`

新增 `Team` 与 `TeamMembership` 两个模型（定义见设计文档 §5），并给 `User` 加反向关系字段：

```prisma
teamMemberships TeamMembership[]
```

放在 `User` 现有关系字段那一块里，紧跟 `meetingTranscriptions`/`meetings` 之类的末尾关系字段之后，保持与该模型既有风格一致。

### 1.2 生成迁移

```bash
cd server && pnpm prisma:dev --name team_foundation
```

目标目录 `server/prisma/migrations/20260919130000_team_foundation/`。生成后**人工检查** `migration.sql`：

- 只有 `CREATE TABLE "Team"` / `CREATE TABLE "TeamMembership"` / 唯一索引 / 外键 / 普通索引
- **不能出现** `DROP` 或 `ALTER TABLE ... ADD ... NOT NULL`
  （出现就会被 `scripts/deploy/check-prisma-migration-risk.mjs` 判为高风险，正式部署要额外审批）

> 注意：`prisma migrate dev` 会跑到 `server/.env.local` 指向的本地开发库上。确认没有别的会话正在跑服务端测试或迁移。

### 1.3 验证

```bash
cd server && npx prisma validate && pnpm prisma:generate
```

预期：`prisma generate` 产出的 client 里能拿到 `prisma.team` 和 `prisma.teamMembership`。

---

## 阶段 2：服务端 TeamModule

团队走**独立模块**，不塞进现有的 `admin.service.ts`（它已经 333 行，团队 CRUD 会让它翻倍）。模块只服务管理员，路由挂在 `/api/admin/teams`。

### 2.1 新建 `server/src/team/`

| 文件 | 内容 |
|---|---|
| `team.service.ts` | 业务逻辑 + Prisma 访问 |
| `team.controller.ts` | `@UseGuards(AdminAuthGuard)`，`@Controller("/api/admin/teams")` |
| `team.module.ts` | 声明 controller / service，导入 `PrismaModule` |

服务层要实现的方法：

```
listTeams(pagination)            -> PaginatedResponse<{ id, name, createdAt, updatedAt, memberCount }>
createTeam(input, actorEmail, ip)
renameTeam(id, input, actorEmail, ip)
deleteTeam(id, actorEmail, ip)
listMembers(id, pagination)      -> PaginatedResponse<{ userId, email, handle, status, joinedAt }>
listMemberCandidates(id, pagination, query)
addMembers(id, userIds, actorEmail, ip)  -> { added: number }
removeMember(id, userId, actorEmail, ip)
```

### 2.2 关键实现点

- **`memberCount` 用 `_count`**，别把成员全查回来在内存里数。
- **重名不要先查后写**。让数据库的唯一约束抛 `P2002`，在 service 里捕获并映射成业务错误「已存在同名团队。」——先查后写有竞态。
- **`addMembers` 做整体校验**：`userIds` 里去重后先确认全部存在（`count` 比对或 `findMany` 长度比对），有一个不存在就整体抛错，**不做部分成功**；然后 `createMany({ skipDuplicates: true })`；返回 `{ added }` 用 `createMany` 的 `count`。
- **`userIds` 上限 100**，超了抛业务错误。
- **候选用户必须排除已在团队里的**：`where: { teamMemberships: { none: { teamId } } }`，`query` 匹配 `email` 或 `handle`（`mode: "insensitive"`），形状与用户管理页一致。
- **审计**：五个写操作 + 一个读操作，action / targetType / detail 见设计文档 §6。写审计用已有的「吞错不失败」写法（参考 `admin.service.ts` 的 `recordServiceManagedAuditSafely`）。
- **错误类型**：找不到团队/用户用 `NotFoundException`，参数问题用 `BadRequestException`，跟现有 admin 代码一致。

### 2.3 `server/src/app.module.ts`

把 `TeamModule` 加进 `imports`。

### 2.4 改 `server/src/app.module.spec.ts`（重要）

现有断言：

```ts
it("does not assemble retired team or invitation modules", () => {
  expect(moduleNames).not.toContain("TeamsModule")
  expect(moduleNames).not.toContain("InvitationsModule")
})
```

新模块叫 `TeamModule` 不会撞上它，**但那是绕过去、不是它想表达的意图**。把这条改成正反两面都说清楚：

- 断言 `TeamModule` **已被装配**（并入上面那条「assembled modules」的断言）
- 断言 `InvitationsModule` **仍然不被装配**（邀请域没有回来）

### 2.5 测试 `server/src/team/team.service.spec.ts` + `team.controller.spec.ts`

沿用 `server/src/admin/admin.controller.spec.ts` 的写法（mock service、`createController` 工厂）。至少覆盖：

- 创建：正常、重名（P2002 映射）、名称空白、名称超 30 字
- 重命名：正常、重名、团队不存在
- 删除：正常（连带成员关系）、团队不存在
- 添加成员：正常、含不存在的 userId 整体拒绝、含已在团队的人被跳过、超 100 个上限
- 移除成员：正常、不是成员
- 候选列表：排除已在团队的人、query 命中邮箱与用户名
- 每个写操作都调用了审计

### 2.6 验证

```bash
pnpm --filter @synapse/server run typecheck
cd server && ./node_modules/.bin/vitest run src/team src/app.module.spec.ts
```

> 用 `./node_modules/.bin/vitest` 而不是 `npx vitest`——`npx` 会解析到缓存副本，可能静默少跑文件。

---

## 阶段 3：用户管理接口加团队列

### 3.1 `server/src/admin/admin.service.ts`

`adminUserSelect` 增加嵌套查询：

```ts
teams: {
  select: { team: { select: { id: true, name: true } } },
  orderBy: { createdAt: "asc" },
},
```

返回给前端时要拍平成 `{ id, name }[]`（Prisma 回来的是 `{ team: {...} }[]`）。在 service 里映射，别把这个包装形状漏到接口外面。

> 实测一下 `select` + `orderBy` 的组合是否被当前 Prisma 版本接受；不接受就退成 `include` 或在内存里排，但**接口形状保持 `{ id, name }[]` 不变**。

### 3.2 测试

在 `admin.service.spec.ts` 补一条：用户列表每行带 `teams`，且形状是 `{ id, name }[]`。

### 3.3 验证

```bash
pnpm --filter @synapse/server run typecheck
cd server && ./node_modules/.bin/vitest run src/admin
```

---

## 阶段 4：拆掉旧栅栏

**这一步不做完，`/admin/teams` 会一直是 404。**

### 4.1 `server/nginx.conf`

现在是一条正则同时盖住 teams 和 invitations（第 65 行）。拆成两条，读起来才清楚：

```nginx
# 邀请域永久下线
location ~ ^/(?:team-invite|(?:console|dashboard)/team-invite|(?:admin|console|dashboard)/invitations(?:/.*)?)/?$ {
  return 404;
}

# 团队页只存在于管理后台；旧的控制台路径继续兜 404
location ~ ^/(?:console|dashboard)/teams(?:/.*)?/?$ {
  return 404;
}
```

`/admin/teams` 不再被拦。

### 4.2 `server/src/deploy-config.spec.ts`

那条 `"returns 404 before SPA fallback for retired team and invitation pages"` 断言的是旧正则的前缀锚点。跟着新写法更新，并**补一条正面断言**：`/admin/teams` 不出现在任何 404 规则里。

### 4.3 `dashboard/vite.config.ts`

`isRetiredTeamRoutePath` 同步拆成「邀请永久 404」+「只有 console/dashboard 的 teams 404」，`/admin/teams` 放行。

### 4.4 `dashboard/vite.config.test.ts`

现有断言里 `/admin/teams` 属于退役路由，改成**不再属于**；`/console/teams`、`/dashboard/teams`、`/team-invite`、`/invitations` 保持属于。

### 4.5 `dashboard/src/lib/admin-redirect.ts`

`adminRoutePatterns` 加入：

```ts
/^\/teams\/?$/u,
/^\/teams\/[^/]+\/?$/u,
```

（第二条是团队详情 `/admin/teams/<id>`。）

### 4.6 `dashboard/src/lib/admin-redirect.test.ts`

`normalizeAdminRedirect('/teams')` 从 `toBeUndefined()` 改成返回 `'/teams'`；补一条 `/admin/teams/t1` → `'/teams/t1'`。`/invitations` 保持被拒。

### 4.7 验证

```bash
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/dashboard run tsc
cd server && ./node_modules/.bin/vitest run src/deploy-config.spec.ts
cd dashboard && ./node_modules/.bin/vitest run vite.config.test.ts src/lib/admin-redirect.test.ts
```

---

## 阶段 5：Web 端

### 5.1 `dashboard/src/lib/api.ts`

新增类型：

```ts
export type AdminTeamRow = { id: string; name: string; createdAt: string; updatedAt: string; memberCount: number }
export type AdminTeamMemberRow = { userId: string; email: string; handle: string; status: 'active' | 'disabled'; joinedAt: string }
export type AdminTeamCandidateRow = { id: string; email: string; handle: string; status: 'active' | 'disabled' }
```

`AdminUserRow` 增加 `teams: { id: string; name: string }[]`。

`adminApi` 增加八个方法（路径见设计文档 §6），沿用 `request<...>` 与 `paginationSuffix` 的既有写法。列表方法的 `sortBy` 白名单是 `createdAt` / `updatedAt` / `name` / `memberCount`。

### 5.2 新建 `dashboard/src/features/teams/`

| 文件 | 内容 |
|---|---|
| `index.tsx` | 团队列表页 |
| `team-detail.tsx` | 详情页（成员管理） |
| `team-dialogs.tsx` | 新建 / 重命名 / 删除确认 |
| `add-members-dialog.tsx` | 添加成员（搜索 + 多选） |

沿用现有实现，不要新造轮子：

- 表格用 `ServerDataTable` + `DataTableColumnHeader` + `getServerTableSortQuery`（照抄 `features/users/index.tsx`）
- 删除确认用 `@/components/confirm-dialog`
- 长文本用 `LongText`，时间用 `RelativeTime`
- 数据与副作用全走 React Query（`useQuery` / `useMutation` + `invalidateQueries`），不要手写 loading 状态
- 组件只用 `@/components/ui/` 里已有的 shadcn/Radix 组件与主题 token；不要自定义颜色、不要内联样式

**添加成员对话框的行为**：

- 打开时拉第一页候选（pageSize 50）
- 搜索框输入**走服务端**（`query` 参数），不要在前端过滤——候选是服务端分页的，前端过滤会得到空列表
- 选中态是本地 state（`Set<string>`），确认时一次性 `addMembers`
- 搜索或换页后**保留已勾选**（跨页多选不能丢）
- 成功后 toast 用返回的 `added` 报实际人数，并 invalidate 成员列表与团队列表（成员数变了）

### 5.3 `dashboard/src/admin-routes.tsx`

- `adminPage('teams', TeamsPage)`
- 详情路由 `teams/$teamId`（参考现有 `webhooks/$webhookId` 的写法）

### 5.4 `dashboard/src/components/layout/data/admin-sidebar-data.ts`

在「用户管理」之后插入：`{ title: '团队', url: '/teams', icon: <图标> }`。图标从 `lucide-react` 里挑一个表示群体的（`Users` 已被「用户管理」占用，用 `UsersRound`）。

### 5.5 `dashboard/src/features/users/index.tsx`

表格在「客户端」和「创建时间」之间插入「团队」列：

- 一个团队都没有 → `-`（用 `text-muted-foreground`）
- 有团队 → 用 `Badge variant='secondary'` 渲染，容器用 `flex flex-wrap items-center gap-2`（照抄「客户端」列的写法，多团队会自动换行）
- 该列**不可排序**（跨表关联，服务端排序没有意义），照「客户端」列那样不挂 `DataTableColumnHeader`

### 5.6 前端测试

沿用 `features/users/index-status-confirm.test.tsx` 的风格，至少覆盖：

- 用户表在有 / 无团队时分别渲染徽标和 `-`
- 添加成员对话框：候选里不出现已在团队的人；搜索走后端参数；跨页保留勾选
- 删除团队走确认弹窗，取消不调用接口

### 5.7 验证

```bash
pnpm --filter @synapse/dashboard run tsc
cd dashboard && ./node_modules/.bin/vitest run src/features/teams src/features/users
```

---

## 阶段 6：整体验证

```bash
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server test
pnpm --filter @synapse/dashboard run tsc
pnpm --filter @synapse/dashboard test:browser
```

手工验收按设计文档 §10 的十条逐条走一遍，重点是：

- 第 4 条：把一个人加进两个团队，确认两处都显示
- 第 6 条：删掉一个有成员的团队，确认那几个用户的账号和其他团队关系都没动
- 第 9 条：桌面端和手机端**完全没有变化**（不新增接口、不改既有响应字段，除了管理员专用的 `/api/admin/users`）
- 第 10 条：`/admin/teams` 能开，`/console/teams`、`/dashboard/teams`、`/invitations` 仍然 404

---

## 阶段 7：收尾

### 7.1 `RELEASE_NOTES_PENDING.md`

团队是**管理员专用的预备性基础设施**，普通用户感知不到。按根规则「纯内部整理、无产品影响通常不记录」——**这一条要不要写进发布说明，按最终判断处理**：如果发布说明是对普通用户讲的，就不写；如果管理后台的变化也算在内，在「新增功能」里加一句管理员视角的说明。

### 7.2 文档同步

`产品设计文档.md` 里 §9 列的六处旧栅栏如果实际改法与此处不同，回头把文档也改一致——文档和代码不要分叉。

### 7.3 提交

按阶段分别提交，每次 `git commit -F - -- <文件列表>`：

1. `feat(team): 团队数据模型与迁移`
2. `feat(team): 管理员团队管理接口`
3. `feat(admin): 用户列表返回所属团队`
4. `chore(team): 拆掉团队下线时留下的路由栅栏`
5. `feat(admin): 管理后台的团队管理界面`

---

## 风险清单

| 风险 | 表现 | 处理 |
|---|---|---|
| 旧栅栏没拆干净 | `/admin/teams` 一直 404，界面能构建但打不开 | 阶段 4 必须完整跑完，并跑 §4.7 的测试 |
| 候选用户在前端过滤 | 候选列表经常性为空 | 候选必须服务端过滤，见 §2.2 与 §5.2 |
| 重名先查后写 | 并发下出现重名团队 | 靠数据库唯一约束 + 捕获 P2002 |
| 成员数用内存统计 | 团队数一多，列表页变慢 | 用 Prisma `_count` |
| 团队列在用户页随团队数膨胀 | 一个用户属于很多团队时响应变大 | 已知规模上限，见设计文档 §6 的说明；到量级再改 |
| 撞上守卫测试 | `app.module.spec.ts` 的断言 | 改成正反两面都写清楚，别靠模块改名绕过去 |
| 多会话共用工作区 | 提交卷进别人的改动 | 只用 `git commit -- <文件列表>` |
