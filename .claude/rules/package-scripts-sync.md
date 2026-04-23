---
name: package-scripts-sync
paths:
  - package.json
  - desktop/package.json
---

# 根 package.json 与 desktop 子包 package.json 的 scripts 同步

本仓库是 pnpm monorepo，根 `package.json` 不放业务脚本，只做转发。

## 映射规则

根 `package.json` 里的**每一条** script 必须对应 `desktop/package.json` 里的一条同名 script：

- 子包里叫 `<name>` → 根里叫 `desktop:<name>`
- 根脚本实现统一写成：`pnpm --filter @synapse/desktop run <name>`

示例：

| `desktop/package.json` | `package.json` |
| --- | --- |
| `dev` | `desktop:dev` |
| `build:renderer` | `desktop:build:renderer` |
| `package:mac` | `desktop:package:mac` |

## 每次改脚本都要同步

在 `desktop/package.json` 动 `scripts` 时，**同一次提交**必须同步改根 `package.json`：

- **新增** 子包 script → 根上加对应 `desktop:<name>` 转发
- **删除** 子包 script → 根上删对应 `desktop:<name>` 转发
- **改名** 子包 script → 根上同步改名，`--filter` 目标也要改

反向检查：根 `package.json` 不应出现在 `desktop/package.json` 中不存在的 `desktop:*` 转发。

## 排序

根 `package.json` 的 scripts 顺序与 `desktop/package.json` 一致，方便 diff 审阅。

## 删除未被引用的 script

在 `desktop/package.json` 增删 script 前，先用 grep 确认没人用：

- `.github/workflows/release.yml`
- `desktop/scripts/*.mjs`
- `desktop/README.md`
- `AGENTS.md` / `CLAUDE.md`

没人引用的 script 不要因为"以后可能用得到"而留着。

## 相关下游

改脚本名 / 删脚本时，**同一次提交**内同步检查并更新：

- `.github/workflows/release.yml` — CI 调的是根 `desktop:*`，`run:` 和 matrix 的 `package_script` 都要跟
- `desktop/README.md` — 开发、版本/发布、本地冒烟三段的命令示例
- `AGENTS.md` — 顶部结构说明里的示例命令
- `CLAUDE.md` — 若引用了根脚本
