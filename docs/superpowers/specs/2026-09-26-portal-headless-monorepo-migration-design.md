# Portal Headless SDK 迁入 pnpm monorepo 设计

日期：2026-09-26  
状态：待实施

## 目标

把独立仓库 `portal-headless` 整体迁入 Synapse monorepo，成为根目录下的 workspace 子包 `@synapse/portal-headless`，用标准 `workspace:*` 依赖替换现有的 `file:vendor/*.tgz` 供应方式，使 SDK 与 SY 在同一次提交、同一条命令链里一起构建与验证。

迁移动机是开发效率：当前改一行 SDK 代码必须走「导出干净提交 → build → npm pack → 复制归档 → 更新 manifest → 更新 lockfile」六步，两个仓库还要分别管理。

## 非目标

- 不改变 SDK 的业务行为。迁移后 SDK 全量测试必须与迁移前逐项一致。
- 不重构 SDK 内部结构、不重命名模块、不整理代码风格。
- 不调整 `tools/generate/` 依赖的外部参考仓库（Portal 前端 `CodeReview_Projects_Js`、Java 后端 `CodeReview_Mall_Platform_Java`）及其 `PORTAL_REPO` / `JAVA_REPO` 环境变量机制。
- 不把 SDK 加进 Electron 安装包。`SDK 不进入 Electron 安装包` 这条既有约束保持不变。
- 不解决 SDK 上游已有的 19 项测试失败（`test/sample-device.test.ts` 缺 `tools/sample/endpoints.json`）。该状态原样带入，不在本次范围内修复。

## 决策记录

| # | 决策 | 理由 |
|---|---|---|
| 1 | 整仓搬迁（含 test / baseline / smoke / tools / docs / generated） | baseline 逐字段回归是 SDK 的核心质量保证，拆散后改 SDK 将失去验证手段 |
| 2 | 包名改为 `@synapse/portal-headless` | 与 shared / server / desktop / dashboard 命名一致 |
| 3 | 删除 `server/vendor/`，`check:portal-sdk` 收窄为构建产物门禁 | 源码进来后 tgz 作为「另一仓库交付产物」的存在理由消失 |
| 4 | `generated/` 全量原样搬（+94.5 MB） | 保留 drift 门禁与文档产物完整性，使迁移的变量最少 |
| 5 | 工具链对齐到 SY 现有版本 | 仓库只装一套编译器与测试框架 |
| 6 | 不保留 SDK 的 git 历史 | 用户确认：迁入后即属于本仓库，历史不再需要 |

### 决策 5 的可行性已实测

对齐前担心 TS 7.0.2 → 6.0.2 会造成大面积编译失败。实测结论：

- 用 SY 的 typescript 6.0.2 编译 SDK 的 `tsconfig.build.json`（534 个源文件）：**零错误**。
- SDK 的 312 个测试文件对 vitest 的 API 使用面仅为 `describe` / `it` / `expect` / `vi` / `beforeAll` / `beforeEach` / `afterAll` / `afterEach` 八个核心导出，`vitest.config.ts` 只有 `include` 与 `environment` 两行。这是 vitest 全版本稳定的 API 面，5.0.1 → 4.1.5 的降级风险极低。

## 现状实测

| 项目 | 数值 |
|---|---|
| SDK 跟踪文件 / 体积 | 1361 / 125.3 MB（`generated/` 占 94.5 MB = 75%） |
| SY 跟踪文件 / 体积 | 5914 / 96.2 MB |
| 迁移后预计 | 7275 / 221.5 MB |
| SDK 测试基线 | 312 文件全部通过；4331 passed / 31 skipped / 21 todo；33.55 s |
| 硬编码绝对路径 | 235 个文件；其中 234 个指向外部参考仓库（有 env 兜底），1 个指向 SDK 自身 |

`generated/` 明细：`api-docs.html` 50 MB、`openapi.json` 37 MB、`scope-audit.json` 5.5 MB、`coverage.html` 620 KB、`page-catalog.json` 520 KB、`coverage.md` 420 KB、`portal-scope.json` 216 KB、`module-type-rules.json` 17 KB。运行时与 `check:portal-sdk` 只依赖后四项中的 `page-catalog.json` 与 `module-type-rules.json`，其余为文档与覆盖产物。

## 目标结构

```text
Synapse/
├── portal-headless/            ← 新增，与 shared/ server/ desktop/ 平级
│   ├── src/ test/ tools/ baseline/ smoke/ docs/ generated/
│   ├── CLAUDE.md  AGENTS.md -> CLAUDE.md
│   ├── package.json            ← name: @synapse/portal-headless
│   ├── tsconfig.json  tsconfig.build.json  vitest.config.ts  redocly.yaml
│   └── README.md
├── server/
│   ├── vendor/                 ← 整个删除
│   └── scripts/check-portal-sdk.mjs   ← 收窄
├── deploy.sh                   ← 白名单加一行
└── pnpm-workspace.yaml         ← packages 加一行
```

## 实施设计

### 1. 搬入

从 SDK 仓库复制到 `portal-headless/`，排除：`.git`、`node_modules`、`dist`、`.githooks`。

- `dist/` 不搬：由 `pnpm --filter @synapse/portal-headless run build` 生成，与 SY 其它包一致。
- `.githooks/` 不搬：SY 没有 git hooks 体系（无 `.githooks`、无 `.husky`），单独带入会制造一套只对子目录生效、且与根仓库无关的钩子。对应删除 `package.json` 的 `hooks:install` 脚本。
- 两边的 `.gitignore` 合并：SDK 的 `node_modules/`、`dist/`、`*.log`、`.DS_Store`、`.env*` 与 SY 现有规则重叠，逐条核对后只补 SY 缺失的项；`tools/sample/endpoints.json` 与 `tools/sample/results/` 两条 SDK 专有规则必须保留。
- SDK 的 `CLAUDE.md` 与 `AGENTS.md -> CLAUDE.md` 软链接原样搬入，作为子目录规则保留。其「Git 纪律」章节（禁止 `git add -A`、显式列路径）与根 `CLAUDE.md` 的自动提交要求不冲突，可共存。

### 2. 包名与入口元数据

`package.json` 的 `name` 由 `portal-headless` 改为 `@synapse/portal-headless`，`pnpm-workspace.yaml` 的 `packages` 增加 `- portal-headless`。

**必须补上入口字段。** SDK 源仓库的 `package.json` 只有 `name` / `version` / `private` / `type` / `engines`，**没有 `main` / `types` / `exports`**——这三个字段是打包脚本在生成发布归档时注入的（已对照现有 tarball 核实）。源码直接进 monorepo 后不存在打包步骤，不补则 server 的动态 import 无法解析：

```json
"main": "./dist/index.js",
"types": "./dist/index.d.ts",
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }
```

`version` 保持 `0.0.1`，`private` 保持 `true`（不发布到 registry）。归档里由打包脚本注入的 `files` 与 `synapseSdkSource` 字段不再需要。

server 侧需改名的引用共 5 处：

- `server/src/extend/portal-headless/portal-headless.service.ts` — `import type { Catalog }` 与 `typeof import(...)` 两处
- `server/src/extend/portal-headless/portal-headless.module.ts` — `PORTAL_SDK_LOADER` 的 `useValue: () => import(...)`
- `server/src/extend/portal-headless/portal-headless.spec.ts` — `await import(...)`
- `server/scripts/check-portal-sdk.mjs` — `import.meta.resolve(...)`

**必须避开的陷阱**：`src/session/types.ts` 中的 `scope: 'portal-headless/session'` 是**运行时会话标识符，不是包引用**，且 `test/session.test.ts` 对其有断言。改名时必须保持该字符串不变，否则会破坏会话语义与测试。

### 3. 工具链对齐

`portal-headless/package.json` 的 devDependencies 改为与 shared / server / desktop 一致：

| 依赖 | 迁移前 | 迁移后 |
|---|---|---|
| typescript | `^7.0.2` | `6.0.2` |
| vitest | `^5.0.1` | `^4.1.5` |
| @types/node | `^26.6.2` | `25.6.0` |

保留 `@redocly/cli`（`docs:lint` / `docs:html` 依赖）与 `axios` / `qs`（运行时依赖）。`tsconfig.json` 的 `module` / `moduleResolution`（ESNext / bundler）保持不变——它与 server 的 NodeNext 各自独立，互不影响。

### 4. server 侧

- `server/package.json` 的依赖由 `"portal-headless": "file:vendor/...tgz"` 改为 `"@synapse/portal-headless": "workspace:*"`。
- 删除 `server/vendor/` 整个目录（tgz + manifest + README）。
- `check-portal-sdk.mjs` 收窄：删除归档 sha256 校验与 manifest 读取（含 `synapseSdkSource.commit` 比对），保留三项仍成立且与来源无关的检查——包可加载、`generated` 运行时资源在位、三个只读契约（`meeting-room-usage` / `perf-year-agreement-list` / `base-dict-get` 必须满足 `!write` 且 `ai.effect === 'read'` 且有 `invoke` 绑定）。
- `server/vendor/README.md` 中被删掉但仍有价值的两条信息迁入 `docs/integrations/portal-headless-extension.md`：上游冻结提交的 19 项已知失败、以及「不得用合成测试代替真实授权验收」的升级纪律。

### 5. Docker

`server/Dockerfile` 三处修改：

- **deps 阶段**：`COPY server/vendor/ server/vendor/` 改为 `COPY portal-headless/package.json portal-headless/package.json`。`pnpm install --frozen-lockfile --filter @synapse/server...` 的 `...` 已含依赖项，无需额外 `--filter`。
- **build 阶段**：增加 `COPY portal-headless/ portal-headless/` 与 `COPY --from=deps /app/portal-headless/node_modules ./portal-headless/node_modules`；在 `check:portal-sdk` 之前增加 `RUN pnpm --filter @synapse/portal-headless run build`（server 的动态 import 指向包产物，必须先构建）。
- **production 阶段**：增加 `COPY --from=build /app/portal-headless ./portal-headless`。这一条是必需的：workspace 依赖是**符号链接**（`server/node_modules/@synapse/portal-headless` → `../../portal-headless`），不像 tgz 那样实体落盘；不复制该目录，软链在生产镜像里会断。参照 `shared` 的现有处理方式。

### 6. 部署脚本

`deploy.sh` 的 include 白名单是逐条列举的，必须增加 `--include='/portal-headless/***'`。Docker 构建在服务器上执行，缺这一行则源码不上传、`docker build` 在 `pnpm install` 阶段失败（本地全绿、只在部署暴露）。

### 7. 构建编排

沿用 SY 现有模式——各包脚本以 `pnpm --filter @synapse/shared run build &&` 开头。在 server 与 desktop 的相关脚本中，把 portal-headless 的构建插到最前：

```text
pnpm --filter @synapse/portal-headless run build && pnpm --filter @synapse/shared run build && ...
```

涉及 server 的 `build` / `dev` / `dev:api` / `test` / `typecheck` 与根 `package.json` 的 `dev:server`。

**desktop 的脚本不改。** desktop 不依赖 SDK，无需为它调整构建顺序，改它只会扩大 diff 面而不解决任何问题。「SDK 不进入 Electron 安装包」这条约束由「desktop 不声明该依赖」本身保证，不需要额外机制。

### 8. CI

现状：`.github/workflows/ci.yml` 有 3 个 job（`script-runtime-contract` / `desktop-macos` / `desktop-windows`），触发方式为 `workflow_dispatch` 手动。第 97 行已有 `node --test desktop/tests/portal-headless-client.test.mjs`，但没有任何 job 运行 SDK 的 312 个测试或 server 测试。

建议增加一个 job 运行 `pnpm --filter @synapse/portal-headless run test`。SDK 测试 33 秒可跑完，且它已是运行时依赖的代码，不进 CI 就没有回归保护。此项作为待确认项，不在本设计内自行决定。

### 9. 文档与规则

- `docs/integrations/portal-headless-extension.md` 的「SDK 如何进入后端」章节（第 21–33 行）需整体重写。这是**唯一确认描述了供应方式**（vendor / tarball / 软链 / Docker 复制顺序）的位置。
- 其余引用 `portal-headless` 名字的文档——`portal-headless-test-delivery.md`、`portal-headless-test.md`、`portal-headless-gui-acceptance.md`、`portal-headless-test-web-prompt.md`、`docs/agents/capability-registry.md`、`module-boundaries.md`、`workflow-and-capabilities.md`、`docs/reference/capability-naming-matrix.md`——只需核查是否含供应方式表述；仅提及能力名或连接器名的不改，避免无谓diff。
- `RELEASE_NOTES_PENDING.md` 记录本次供应链与打包方式变更（属「打包或发版风险」）。

### 10. 硬编码路径

`test/finance-setting-opening-supplier.test.ts` 第 126 行硬编码了 SDK 自身仓库的绝对路径：

```ts
JSON.parse(read('/Users/liyang/Documents/code/github/portal-headless', 'generated/page-catalog.json'))
```

改为基于 `import.meta.url` 相对定位。其余 234 个文件里指向外部参考仓库的路径全部保留原样——它们都有 `process.env.PORTAL_REPO ?? '/Users/...'` 形式的兜底，属于既有的可配置设计。

## 被推翻的既有约束

`docs/integrations/portal-headless-extension.md` 中以下表述在迁移后与代码矛盾，必须改写而非保留：

| 位置 | 原表述 | 迁移后的事实 |
|---|---|---|
| :23 | 「SDK 源码仍在独立仓库维护，SY 不复制一套业务源码」 | 源码即为本仓库一部分 |
| :29 | 「通过 `file:vendor/...tgz` 固定依赖，依赖实际安装到 node_modules，**不是跨仓库软链接**」 | 改为 `workspace:*`，依赖**必然是符号链接** |
| :31 | 「Docker deps 阶段先复制 vendor 再 frozen install……部署脚本 `/server/***` 白名单包含归档」 | 改为复制包目录并先构建 |

「线上运行的 SDK 必须精确来自某个已知提交」这一意图仍然成立，且由 monorepo 的原子提交承担——SDK 变更与其 SY 侧适配变更落在同一次提交里。需要在改写后的文档中显式说明这一替代关系，而不是简单删除。

## 验证策略

迁移后必须全部满足，其中第一项要求与基线**逐数字一致**：

```bash
pnpm --filter @synapse/portal-headless run test
# 期望：312 passed (312)；4331 passed | 31 skipped | 21 todo

pnpm --filter @synapse/portal-headless run build
pnpm --filter @synapse/server run check:portal-sdk
pnpm --filter @synapse/server run typecheck
pnpm --filter @synapse/server run test src/extend/portal-headless/portal-headless.spec.ts
docker build -f server/Dockerfile .
```

Docker 构建必须在本地实跑一次，它同时覆盖 deps / build / production 三阶段的 COPY 与软链解析。

## 风险

| 风险 | 缓解 |
|---|---|
| workspace 软链在生产镜像中断开 | production 阶段显式复制包目录；以 Docker 实跑验证 |
| 部署遗漏新目录白名单 | 部署前核对 `deploy.sh` include 列表 |
| 版本降级引入隐性行为变化 | 已有零错误编译实测；以 4331 项测试基线逐数字比对 |
| 仓库体积翻倍（96 → 221 MB） | 已由决策 4 接受。若后续不可接受，可另行收窄 `generated/` |
| 迁移过程中误改运行时会话标识 | 已在 §2 标注 `scope: 'portal-headless/session'` 为禁区 |

## 回滚

迁移在单个分支内完成。`server/vendor/` 的删除与其它改动落在同一批提交里，未推送前整条分支可直接丢弃；已推送后可从该提交的父提交取回 vendor 目录，恢复原有供应方式。

**源 SDK 仓库在迁移验证通过前不删除。** 它不在本仓库 git 的管辖范围内，一旦删除则源码与历史都无法从 SY 仓库恢复，它是唯一的兜底。
