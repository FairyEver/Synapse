---
name: package-scripts-sync
paths:
  - package.json
  - desktop/package.json
  - website/package.json
---

# 根 package.json 与各子包 package.json 的 scripts 同步

本仓库是 pnpm monorepo，根 `package.json` 不放业务脚本，只承担两件事：

1. **子包脚本转发**：把各子包里的脚本以 `<subpackage>:<name>` 的形式暴露到根。
2. **workspace 级 umbrella 命令**：跨多个子包的聚合命令（当前只有 `dev`）。

这两类脚本**都是合法的**，不要相互误伤。特别是：umbrella 命令不对应任何单一子包的同名脚本，**反向检查时不要把它当作孤儿转发脚本删掉**。

## 一、子包脚本转发

根 `package.json` 里的每一条 `<subpackage>:*` script 必须对应对应子包 `package.json` 里的一条同名 script：

- 子包 `@synapse/<subpackage>` 里叫 `<name>` → 根里叫 `<subpackage>:<name>`
- 根脚本实现统一写成：`pnpm --filter @synapse/<subpackage> run <name>`

当前纳管的子包：

- `@synapse/desktop` → 根前缀 `desktop:`
- `@synapse/website` → 根前缀 `website:`

示例：

| 子包 script | 根 script |
| --- | --- |
| `desktop/package.json` 的 `dev` | `desktop:dev` |
| `desktop/package.json` 的 `build:renderer` | `desktop:build:renderer` |
| `desktop/package.json` 的 `package:mac` | `desktop:package:mac` |
| `website/package.json` 的 `dev` | `website:dev` |
| `website/package.json` 的 `build` | `website:build` |
| `website/package.json` 的 `preview` | `website:preview` |

## 二、workspace 级 umbrella 命令

部分根脚本是跨子包的聚合命令，**不对应任何单一子包的 script，但仍然合法**。它们不属于"第一节"的转发规则，也不在"反向检查"的删除范围内。

当前 umbrella 命令清单（新增 / 删除时更新这张表）：

| 根 script | 实现 | 说明 |
| --- | --- | --- |
| `dev` | `pnpm -r --parallel run dev` | 并行启动所有 workspace 子包的 `dev` 脚本；新增带 `dev` 脚本的子包会自动被带上，不需要再改根 script |
| `kill` | 内联 shell（grep + kill -9） | 一键杀死所有 Synapse dev 相关进程（Vite、Electron、VitePress、concurrently 整条链） |

新增 umbrella 命令的条件：

- 语义上是"跨子包聚合"，而不是"某个子包的转发"；
- 实现优先用 pnpm 原生能力（`-r`、`--filter`、`--parallel`），避免引入 `concurrently` 等新依赖；
- 在这张表里登记，并在相关文档（`AGENTS.md` / 顶层 `README.md`）加一两行用法说明。

## 三、每次改脚本都要同步

在任意子包 `package.json` 动 `scripts` 时，**同一次提交**必须同步改根 `package.json`：

- **新增** 子包 script → 根上加对应 `<subpackage>:<name>` 转发
- **删除** 子包 script → 根上删对应 `<subpackage>:<name>` 转发
- **改名** 子包 script → 根上同步改名，`--filter` 目标也要改

反向检查（**只针对转发脚本**）：根 `package.json` 不应出现在对应子包 `package.json` 中不存在的 `<subpackage>:*` 转发。**umbrella 命令不在此检查范围内**，见本规则第二节。

## 四、排序

根 `package.json` 的 scripts 分块排列：

1. **第一块**：umbrella 命令（从 `dev` 开始，后续新增的聚合命令紧跟其后）。
2. **第二块及后续**：按子包分组的 `<subpackage>:*` 转发脚本，各组内顺序与子包 `package.json` 的 `scripts` 一致，方便 diff 审阅。

## 五、删除未被引用的 script

在任意子包 `package.json` 增删 script 前，先用 grep 确认没人用：

- `.github/workflows/release.yml`
- 子包自身 `scripts/*.mjs`（如 `desktop/scripts/`）
- 子包自身 `README.md`（如 `desktop/README.md`、`website/README.md`）
- 顶层 `README.md`
- `AGENTS.md` / `CLAUDE.md`
- 其他子包的源码与脚本

没人引用的 script 不要因为"以后可能用得到"而留着。

## 六、相关下游

改脚本名 / 删脚本时，**同一次提交**内同步检查并更新：

- `.github/workflows/release.yml` — CI 调的是根 `<subpackage>:*`，`run:` 和 matrix 的 `package_script` 都要跟
- 对应子包 `README.md`（`desktop/README.md`、`website/README.md`）
- 顶层 `README.md` — 常用脚本小节
- `AGENTS.md` — 顶部结构说明里的示例命令
- `CLAUDE.md` — 若引用了根脚本
