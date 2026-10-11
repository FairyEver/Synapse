import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temp = mkdtempSync(resolve(tmpdir(), 'synapse-todo-core-'))
try {
  const sources = ['Features/Todos/TodoModels.swift', 'Features/Todos/TodoDraft.swift',
    'Features/Todos/TodoTime.swift', 'Features/Todos/TodoStore.swift', 'Features/Todos/TodoNavigation.swift',
    'Core/Protocol/WireTimestamp.swift', 'Core/Networking/TodoNetworkPolicy.swift'].map(path => resolve(mobile, 'SynapseMobile', path))
  const binary = resolve(temp, 'todo-core-check')
  const build = spawnSync('swiftc', ['-parse-as-library', ...sources, resolve(mobile, 'scripts/todo-core-check.swift'), '-o', binary], { stdio: 'inherit' })
  if (build.status !== 0) process.exitCode = build.status ?? 1
  else process.exitCode = spawnSync(binary, [], { stdio: 'inherit' }).status ?? 1
} finally { rmSync(temp, { recursive: true, force: true }) }
