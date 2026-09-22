# Portal Headless SDK 交付

此目录归档由固定 SDK 源码提交构建，版本与 SHA-256 见 `portal-headless.manifest.json`。SY 安装归档作为依赖，不复制 SDK 源码。当前包来自 `0dae0247f34ee503d6086c58a5f6243f3665fb3d`，使用 Node 22 构建；源工作区未提交内容未纳入。

## 升级步骤

在临时目录导出目标提交；不要从正在开发的工作区直接打包。以下变量由维护者指定，不接受浮动分支作为 `sdk_commit`：

```sh
sdk_repo=/path/to/portal-headless
sdk_commit=<完整提交哈希>
sdk_stage=$(mktemp -d)
git -C "$sdk_repo" archive "$sdk_commit" | tar -x -C "$sdk_stage"
cd "$sdk_stage"
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

在此临时目录构建完成后，保存原 `package.json` 的 `name`、`description`、`engines`、`dependencies`，将版本设为 `0.0.1-synapse.<短提交哈希>`，发布元数据设为：

```json
{
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {".": {"types": "./dist/index.d.ts", "import": "./dist/index.js"}},
  "files": ["dist/**/*.js", "dist/**/*.d.ts", "generated/page-catalog.json", "generated/module-type-rules.json"],
  "synapseSdkSource": {"commit": "<完整提交哈希>"}
}
```

移除开发脚本与 devDependencies，然后运行 `npm pack --ignore-scripts`。核对 `tar -tzf <归档>`：仅包含运行 JS、类型、两个 generated 资源、包元数据及 npm 自动包含的 README/LICENSE；不应包含源码、测试、smoke、baseline、凭据或 node_modules。

复制归档到本目录，更新 manifest 的 file/version/sourceCommit/sha256、`server/package.json` 和 pnpm lock。按 manifest 校验归档 SHA-256，运行：

```sh
pnpm --filter @synapse/server check:portal-sdk
pnpm --filter @synapse/server test src/extend/portal-headless/portal-headless.spec.ts
pnpm --filter @synapse/server typecheck
pnpm --filter @synapse/server build
docker build -f server/Dockerfile -t synapse-portal-headless-check:local .
```

`check:portal-sdk` 不发业务请求，只验证归档、安装后的三个只读契约和运行资源。升级仍需测试账号联调；不得用合成测试代替真实授权验收。

## 当前上游测试已知问题

冻结提交的 SDK 全量测试为 2387 通过、19 失败、51 跳过。19 个失败都在 `test/sample-device.test.ts`，缺少该提交未跟踪的 `tools/sample/endpoints.json`；未从脏工作区补取数据。SDK 构建、SY 实际使用的打包入口、只读发现和执行契约另有专项验证。这不表示上游全量测试已通过。
