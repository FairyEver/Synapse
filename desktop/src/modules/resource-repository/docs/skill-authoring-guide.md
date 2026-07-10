# Skill 开发规范

## 目录结构

Skill 文件夹名称使用小写字母、数字和短横线，并与 `SKILL.md` 中的 `name` 一致。把辅助资源尽量放在 `SKILL.md` 的下一层，只创建实际需要的目录。

```text
my-skill/
├── SKILL.md
├── .env.example     # 仅在需要外部配置时创建
├── scripts/         # 可重复执行的脚本
├── references/      # 按需读取的参考资料
└── assets/          # 输出时使用的模板或素材
```

不要在 Skill 内额外创建 README、快速参考、安装指南或变更日志。使用 `SKILL.md` 描述 Agent 执行任务所需的规则，详细资料按需放入 `references/`。

## 文件职责

- `SKILL.md` 是必需入口。YAML frontmatter 只写 `name` 和 `description`，在 `description` 中同时说明 Skill 的能力和触发场景。正文使用简洁、直接的指令。
- `scripts/` 存放需要稳定执行或经常重复编写的程序。
- `references/` 存放只在特定场景下读取的详细资料，并由 `SKILL.md` 明确说明何时读取。
- `assets/` 存放生成结果时复制或修改的模板、图片等资源，不存放操作说明。
- `.env.example` 只声明外部配置，不包含真实值；本地运行使用的 `.env` 不属于 Skill 发布内容。

## Dotenv 格式

在 Skill 根目录使用标准 `.env.example`，键名应稳定、清晰。必填值留空，非敏感配置可以提供默认值。

```dotenv
# 认证配置
# 服务访问令牌，安装时填写
API_TOKEN=

# 区域配置
# 服务区域，可使用非敏感默认值
REGION=cn-example
```

不要在 `.env.example`、`SKILL.md`、脚本、日志或测试夹具中写入真实 token、密码、私钥及生产连接信息。`.env` 必须加入 Git 忽略规则。

## 运行时读取

消费配置的程序必须根据脚本自身位置定位 Skill 根目录，不能依赖启动命令的当前工作目录。Node.js 20.12 及以上优先使用内置的 `process.loadEnvFile()`：

```js
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const skillRoot = path.resolve(scriptDirectory, "..")
process.loadEnvFile(path.join(skillRoot, ".env"))

const token = process.env.API_TOKEN
if (!token) throw new Error("缺少必需配置：API_TOKEN")
```

其他运行时优先复用已有的 Dotenv 能力。没有明确必要时不要新增依赖。缺少必需配置时只报告键名和修复动作，不要输出其他环境变量。

## 安装与队列更新

安装 Skill 时，Synapse 根据根目录的 `.env.example` 创建本地 `.env`，并使用安装确认弹窗中的值写入已声明键。重新安装或更新时，会保留未声明的用户自有键和已有声明键的现有值；新声明或缺失的键使用安装确认弹窗中的值，并按 `.env.example` 的顺序追加。

密钥值改变后，用户可以从密钥管理中实时扫描已安装 Skill 的 `.env`。选中的项目按队列逐项更新，每项执行前重新校验；单项冲突或失败不会把其他项目当作已更新。Synapse 不依赖安装历史，因此作者不得把配置值写进 `SKILL.md` 后再期待后期扫描正文。

## 项目目录与 Git

项目级安装会把 `.env` 放进项目中的 Skill 目录。项目作者必须确认 `.env` 已被仓库忽略，提交前检查暂存文件，避免把密钥加入 Git。`.env.example` 可以提交，但只能包含键名、必要注释和非敏感默认值。

## 迁移已有 Skill

1. 找出正文变量替换、硬编码配置及真正消费这些值的程序。
2. 在 Skill 根目录创建 `.env.example`，只声明需要配置的键。
3. 修改运行入口，让它根据自身位置加载根目录 `.env`。
4. 删除正文中的敏感值和安装时写入正文的敏感占位符。
5. 确认 `.env` 被 Git 忽略，并从非 Skill 工作目录验证配置加载。
6. 验证缺少必需键时安全失败，且日志不会泄露配置内容。

## 创建新 Skill

先确定单一职责、触发场景和最小入口，再创建 `SKILL.md` 及必要资源。只有外部配置确实存在时才添加 `.env.example`。保持键名稳定，运行时从根目录 `.env` 读取，并测试不同工作目录和缺少必需配置的场景。

:::synapse-prompt id="upgrade-skill" title="修改现有 Skill"
请检查当前目录中的已有 Skill，并将它迁移到 Synapse Skill ENV 配置规范。直接修改文件并完成必要验证，不要只给建议。

要求：

1. 先阅读 SKILL.md、脚本、配置文件和现有测试，确认 Skill 的入口、运行时和当前配置来源。只修改完成迁移所需的文件，不做无关重构。
2. 查找 SKILL.md 或其他文件中的 `${{ NAME }}` 变量、硬编码 token、密码、API Key、地址及其他需要安装时配置的值。不要在回复、日志或最终总结中复述任何真实敏感值。
3. 在 Skill 根目录创建或完善 `.env.example`。使用标准 Dotenv `KEY=value` 格式；只写键名、必要注释和非敏感默认值，不写真实 token、密码、私钥或生产连接信息。
4. 让真正消费配置的脚本或程序从 Skill 根目录的 `.env` 读取值。路径必须根据脚本自身位置计算，不能依赖当前工作目录。
5. Node.js 20.12 及以上优先使用 `process.loadEnvFile()`；其他运行时优先复用项目已有的 Dotenv 能力。除非现有运行时没有可用方案，否则不要新增依赖。
6. 从 SKILL.md 和代码中移除真实敏感值，以及需要安装时写入正文的敏感占位符。SKILL.md 只说明如何调用脚本，不要求 Agent 读取、展示或复制 `.env`。
7. 如果当前源码中已经存在真实配置值，为保持本地运行可将它们迁移到本地 `.env`，但必须确保 `.env` 被 Git 忽略。不要创建包含真实值的 `.env.example`，不要把 `.env` 纳入提交或发布内容。
8. 如果无法确定某个配置值，不要编造。保留对应 `.env.example` 键为空，并让运行时在缺少必需键时返回包含键名的明确错误，但不得输出其他配置值。
9. 不要打印完整环境变量，不要把敏感值写入命令参数回显、日志、错误详情、缓存或生成文件。
10. 保持原有功能和入口兼容。运行现有测试；没有测试时执行最小可行验证，确认配置加载路径不依赖当前工作目录。
11. 完成后只总结修改的文件、声明的配置键名和验证结果，不展示任何配置值。
:::

:::synapse-prompt id="create-skill" title="创建新 Skill"
请在当前目录创建一个符合 Synapse Skill ENV 配置规范的新 Skill。直接创建完整文件并完成必要验证，不要只输出示例。

要求：

1. 先根据当前需求确定 Skill 的职责、触发场景、运行入口和最小文件结构。保持职责单一，不添加与需求无关的功能。
2. 创建规范的 SKILL.md 和必要的 scripts、references 或 assets。SKILL.md 应说明何时使用、如何调用以及必要限制，不写真实 token、密码、API Key、私钥或生产连接信息。
3. 只有 Skill 确实需要外部配置时才在根目录创建 `.env.example`。使用标准 Dotenv `KEY=value` 格式；键名应稳定、清晰，只包含必要注释和非敏感默认值。
4. 不要创建带真实值的可提交 `.env`。如果为了本地验证必须创建 `.env`，先确保它被 Git 忽略，并且不要在回复或最终总结中展示其内容。
5. 让消费配置的脚本从 Skill 根目录 `.env` 读取值。路径必须根据脚本自身位置计算，不能依赖当前工作目录。
6. Node.js 20.12 及以上优先使用 `process.loadEnvFile()`；其他运行时优先使用已有原生能力或项目现有依赖。没有明确必要时不要新增依赖。
7. 对必需配置进行启动前校验。缺失时可以报告键名和修复动作，但不得输出其他配置值。
8. 不要要求 Agent 读取、展示或复制 `.env`；不要打印完整环境变量；不要把敏感值写入命令参数回显、日志、错误详情、缓存或生成文件。
9. 添加适合该 Skill 的最小测试或验证，至少确认从非 Skill 工作目录启动时仍能正确定位 `.env`，并确认缺少必需键时安全失败。
10. 完成后总结目录结构、需要用户配置的键名和验证结果，不展示任何配置值。
:::
