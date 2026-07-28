# Skill Authoring

Use this guide when creating a new Agent Skill or modifying an existing Skill in the current or local directory. Inspect and edit the actual files, complete proportionate verification, and return the implemented result rather than only suggestions or examples.

## Execution Principles

1. Read the current project's `AGENTS.md`, applicable rule files, existing Skills, templates, scripts, and tests before editing. Reuse established conventions and shared capabilities.
2. Extract the Skill's responsibility, trigger scenarios, inputs, outputs, constraints, and success criteria from the current context. Ask the user only when missing information would materially change the result and cannot be discovered from the project.
3. Make surgical changes. Modify only files required for the current Skill task; avoid unrelated refactors and directories or dependencies without a concrete purpose.
4. Do not invent APIs, file paths, configuration values, or tool capabilities. State the limitation when an external fact cannot be verified.
5. When modifying an existing Skill, preserve its name, entry points, and compatible behavior unless the user explicitly requests a change.

## Directory Structure

Use lowercase letters, numbers, and hyphens for the Skill directory name, and keep it identical to the `name` in `SKILL.md`. Create only resource directories the Skill actually needs.

```text
my-skill/
├── SKILL.md
├── .env.example     # Create only when external configuration is required
├── scripts/         # Repeatable, deterministic programs
├── references/      # Detailed material read only when needed
└── assets/          # Templates, images, or other output resources
```

Do not add a README, quick reference, installation guide, or changelog inside the Skill. Put instructions needed for execution in `SKILL.md`, and put detailed on-demand material in `references/`.

## SKILL.md

- Limit YAML frontmatter to `name` and `description`.
- Make `description` explain both what the Skill does and which user phrases, files, links, or task contexts should trigger it. Keep every trigger rule in `description`.
- Write concise, direct, imperative instructions covering the workflow, tool choices, important constraints, failure handling, and output requirements.
- Use progressive disclosure: keep the common workflow in `SKILL.md`; move details needed only in specific situations to `references/`, and state exactly when to read them.
- Keep `SKILL.md` focused. When it approaches 500 lines, split detailed material into references instead of keeping unrelated background in the active context.

## File Responsibilities

- Put stable, frequently repeated, or deterministic programs in `scripts/`. Repair and reuse existing scripts instead of reimplementing the same logic.
- Put specifications, API material, and long-form guidance needed only for particular tasks in `references/`. Give large reference files a clear table of contents.
- Put templates, images, fonts, and other resources copied or modified in generated output in `assets/`; do not store operating instructions there.
- Add tests or evaluation files only when they verify Skill behavior, and follow the current project's existing test structure.

## External Configuration and Sensitive Information

Create or update a root `.env.example` only when the Skill genuinely requires external configuration.

- Use standard Dotenv `KEY=value` syntax. Keys must match `[A-Za-z_][A-Za-z0-9_]*` and remain stable and clear.
- Leave required values empty; non-sensitive settings may have defaults. Add only comments needed to explain each setting or group.
- Never put real tokens, passwords, API keys, private keys, or production connection details in `.env.example`, `SKILL.md`, scripts, logs, test fixtures, or generated files.
- Treat local `.env` as unpublished state and ensure Git ignores it. Do not instruct the Agent to read, display, or copy `.env`.
- Make configuration consumers locate the Skill root relative to the script file, never from the command's working directory.
- Prefer the built-in `process.loadEnvFile()` on Node.js 20.12 or later; otherwise reuse native runtime support or an existing project dependency. Do not add a dependency without a demonstrated need.
- When required configuration is missing, report only the missing key names and the repair action. Do not print complete environment variables or place sensitive values in process arguments, logs, error details, or caches.
- Inspect the real arguments passed to `spawn`, `exec`, `curl`, and similar calls. Redacting logs afterward does not remove secrets already exposed through process arguments.
- Do not let dry runs, format checks, or payload previews read unnecessary secrets or construct arguments containing secret values.

Node.js example:

```js
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const skillRoot = path.resolve(scriptDirectory, "..")
process.loadEnvFile(path.join(skillRoot, ".env"))

const token = process.env.API_TOKEN
if (!token) throw new Error("Missing required configuration: API_TOKEN")
```

## Creating a New Skill

1. Determine one focused responsibility, trigger scenarios, expected outputs, required tools, and success criteria from the user's request.
2. Check the current project for similar Skills, templates, scripts, or shared capabilities to avoid duplicating them.
3. Create the smallest useful `SKILL.md`. Add `scripts/`, `references/`, `assets/`, or `.env.example` only when the task requires them.
4. Add a minimal test or two to three realistic scenarios for objectively verifiable behavior. For subjective output, complete at least one representative review.
5. Verify the frontmatter, directory name, referenced paths, script entry points, and output format against project conventions.

## Modifying an Existing Skill

1. Read the complete existing `SKILL.md` and the relevant scripts, references, assets, configuration files, and tests. Confirm the current triggers, entry points, data flow, and compatibility boundary.
2. Keep the Skill directory name and `name` unchanged. Do not replace entry points, remove supported scenarios, or expand the responsibility unless the task requires it.
3. Update the trigger description, workflow, and required resources together. Keep instructions, references, scripts, and tests consistent.
4. Remove duplicate rules and references made obsolete by the change, but do not overwrite user data or perform destructive cleanup without authorization.
5. When migrating body substitutions or hard-coded configuration to ENV:
   - Find the programs that consume the configuration and every source of sensitive values.
   - Declare only required keys, necessary comments, and non-sensitive defaults in `.env.example`.
   - Load the Skill-root `.env` from the runtime entry point.
   - Remove real secrets and sensitive installation-time placeholders from instructions and code.
   - Leave unknown values empty instead of inventing them.
6. Run existing tests and add the smallest coverage for the change. For configuration loading, also run once outside the Skill working directory, verify safe failure when required keys are missing, and confirm dry-run behavior does not depend on `.env` or expose secrets in child-process arguments.

## Completion Criteria

- The required files are actually created or modified and the behavior matches the request.
- The Skill name, trigger description, body instructions, and resource references agree.
- No unrelated files, dependencies, duplicate documents, or sensitive information were added.
- Proportionate tests or checks have run, and discovered problems have been resolved.
- The final response summarizes every actual file change, including unpublished files such as a local `.env`. Describe only file purposes, behavior changes, declared configuration key names, and verification results; never reveal configuration values or repeat sensitive information.
