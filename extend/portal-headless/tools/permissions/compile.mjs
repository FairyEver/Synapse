#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { compilePermissionPolicy } from '../../dist/permissions/policy.js'
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => value.startsWith('--') ? (pairs.push([value.slice(2), values[index + 1] ?? '']), pairs) : pairs, []))
if (args.capabilities) throw new Error('--capabilities is no longer accepted; the SDK executable bindings are authoritative')
if (!args.root || !args.candidates || !args.reviews || !args.revision || !args.out) throw new Error('--root, --candidates, --reviews, --revision and --out are required')
const readNdjson = file => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
const policy = compilePermissionPolicy({ candidates: readNdjson(args.candidates), reviews: readNdjson(args.reviews), sourceRoot: args.root, sourceRevision: args.revision, ...(args['context-evaluators'] ? { availableContextEvaluators: args['context-evaluators'].split(',') } : {}) })
mkdirSync(dirname(args.out), { recursive: true })
writeFileSync(args.out, JSON.stringify(policy, null, 2) + '\n')
