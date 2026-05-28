# Graph Report - desktop/scripts  (2026-05-28)

## Corpus Check
- Corpus is ~7,723 words - fits in a single context window. You may not need a graph.

## Summary
- 159 nodes · 237 edges · 14 communities (13 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_import-legacy-database.mjs|import-legacy-database.mjs]]
- [[_COMMUNITY_migrate-display-name-to-user-directory.ts|migrate-display-name-to-user-directory.ts]]
- [[_COMMUNITY_generate-ipc.mjs|generate-ipc.mjs]]
- [[_COMMUNITY_generate-definitions-registry.mjs|generate-definitions-registry.mjs]]
- [[_COMMUNITY_migrate-to-history-structure.ts|migrate-to-history-structure.ts]]
- [[_COMMUNITY_check-hard-constraints.mjs|check-hard-constraints.mjs]]
- [[_COMMUNITY_verify-packaged-asar.mjs|verify-packaged-asar.mjs]]
- [[_COMMUNITY_build-icons.mjs|build-icons.mjs]]
- [[_COMMUNITY_dev-electron-app.mjs|dev-electron-app.mjs]]
- [[_COMMUNITY_bump-version-commit-push.mjs|bump-version-commit-push.mjs]]
- [[_COMMUNITY_dev.mjs|dev.mjs]]
- [[_COMMUNITY_check-ipc-codegen.mjs|check-ipc-codegen.mjs]]
- [[_COMMUNITY_migrate-legacy-database-macos.sh|migrate-legacy-database-macos.sh]]
- [[_COMMUNITY_dev-renderer.mjs|dev-renderer.mjs]]

## God Nodes (most connected - your core abstractions)
1. `main()` - 13 edges
2. `collectPlan()` - 11 edges
3. `migrateContentDirectory()` - 8 edges
4. `main()` - 7 edges
5. `collectCandidates()` - 6 edges
6. `main()` - 6 edges
7. `q()` - 6 edges
8. `loadModuleDescriptor()` - 6 edges
9. `pathExists()` - 5 edges
10. `writeConvertedDatabase()` - 5 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities (14 total, 1 thin omitted)

### Community 0 - "import-legacy-database.mjs"
Cohesion: 0.12
Nodes (32): affinityToKind(), assertLegacySource(), CHOICE_KINDS, cleanupTemp(), collectPlan(), columnDefinition(), copyRows(), createSystemSchema() (+24 more)

### Community 1 - "migrate-display-name-to-user-directory.ts"
Cohesion: 0.18
Nodes (19): collectCandidates(), CONTENT_ROOTS, isFileNotFoundError(), isGitRepository(), LegacyMetaRecord, LegacySnapshotRecord, main(), normalizeDisplayName() (+11 more)

### Community 2 - "generate-ipc.mjs"
Cohesion: 0.20
Nodes (18): __dirname, EXTRA_CHANNEL_SOURCES, extractChannels(), findExportedVariable(), findImportSource(), findIpcModuleObject(), findObjectProperty(), generate() (+10 more)

### Community 3 - "generate-definitions-registry.mjs"
Cohesion: 0.20
Nodes (14): agentDefinitionsRoot, definitionsRoot, editorDefinitionsRoot, listAgentDefinitionDirectories(), listAgentRuntimeDefinitionDirectories(), listEditorDefinitionDirectories(), main(), mainGeneratedDir (+6 more)

### Community 4 - "migrate-to-history-structure.ts"
Cohesion: 0.28
Nodes (12): BLOBS_DIRECTORY_PATH, collectLegacyFiles(), ContentType, ensureJsonFile(), formatCompactTimestamp(), LegacyMetaRecord, main(), migrateContentDirectory() (+4 more)

### Community 5 - "check-hard-constraints.mjs"
Cohesion: 0.18
Nodes (6): checks, desktopRoot, __dirname, lines, offenders, relFile

### Community 6 - "verify-packaged-asar.mjs"
Cohesion: 0.25
Nodes (7): appPaths, findNode(), readAsarHeader(), readPackedFile(), targetPath, verifyApp(), walkAsarNode()

### Community 7 - "build-icons.mjs"
Cohesion: 0.29
Nodes (6): inputPath, outputBasePath, outputDir, result, rootDir, scriptDir

### Community 8 - "dev-electron-app.mjs"
Cohesion: 0.33
Nodes (3): electronBuildDir, electronEntryFiles, nodemon

### Community 9 - "bump-version-commit-push.mjs"
Cohesion: 0.47
Nodes (5): bumpPackageVersion(), main(), packageRoot, run(), scriptDir

### Community 10 - "dev.mjs"
Cohesion: 0.50
Nodes (4): child, isPortAvailable(), resolvePort(), startPort

### Community 11 - "check-ipc-codegen.mjs"
Cohesion: 0.50
Nodes (4): desktopRoot, __dirname, execFile, run()

### Community 12 - "migrate-legacy-database-macos.sh"
Cohesion: 0.83
Nodes (3): run_with_node(), run_with_synapse_app(), migrate-legacy-database-macos.sh script

## Knowledge Gaps
- **47 isolated node(s):** `__dirname`, `desktopRoot`, `scriptDir`, `packageRoot`, `definitionsRoot` (+42 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `__dirname`, `desktopRoot`, `scriptDir` to the rest of the system?**
  _47 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `import-legacy-database.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.11586452762923351 - nodes in this community are weakly interconnected._