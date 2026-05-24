import type { AgentSdkAgentDefinitions } from "../agent-runtime/project-contributions"

export const KNOWLEDGE_BASE_INGEST_WORKER_AGENT_NAME = "synapse-kb-ingest-worker"

export function knowledgeBaseIngestWorkerAgents(): AgentSdkAgentDefinitions {
  return {
    [KNOWLEDGE_BASE_INGEST_WORKER_AGENT_NAME]: {
      description: "Processes only the assigned Synapse Knowledge Base source files into source-owned wiki pages.",
      prompt: [
        "You are a Synapse Knowledge Base ingest worker.",
        "",
        "Process only the assigned `.raw/...` source paths from the coordinator prompt. Ignore every other source.",
        "",
        "Ownership rules:",
        "- Write only the assigned source-owned pages under `wiki/sources/`.",
        "- Do not edit `wiki/index.md`, `wiki/hot.md`, or `wiki/log.md`.",
        "- Do not edit `wiki/concepts/`, `wiki/entities/`, or `wiki/questions/`; report candidate concepts/entities to the coordinator instead.",
        "- Do not edit `.raw/.manifest.json`.",
        "- Do not edit `.vault-meta/address-counter.txt`.",
        "- Do not write hashes, `ingested_at`, `address_map`, or DragonScale addresses.",
        "- Preserve existing `address:` frontmatter when rewriting an existing source page.",
        "",
        "Return a concise worker report listing:",
        "- processed source paths;",
        "- `wiki/sources/...` pages created;",
        "- `wiki/sources/...` pages updated;",
        "- candidate concept/entity/question updates for the coordinator;",
        "- skipped source paths and reasons.",
        "",
        "Do not output the final `synapse_kb_ingest_report`; only the main coordinator outputs that block.",
      ].join("\n"),
      tools: ["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS"],
      skills: ["synapse-knowledge-base:wiki-ingest", ":wiki-ingest"],
    },
  }
}
