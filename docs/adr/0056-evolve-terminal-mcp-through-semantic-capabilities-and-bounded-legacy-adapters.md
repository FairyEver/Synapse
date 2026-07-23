# Use one semantic Terminal MCP contract during development

New Terminal capabilities follow `app.terminal.<subdomain>.<action>`, with MCP tool names produced by the established underscore mapping. Each tool has one primary permission meaning. State get, observation, output read, rendered-view get, control acquire/renew/release, semantic input, raw input, normal stop, force stop, and deletion preview/commit remain separate capabilities; `mode`, `force`, `includeOutput`, or similar switches must not cross permission families.

The review covers the entire Terminal surface, including create, list, get, rename, resize, group, and command operations. Each capability must adopt the confirmed pagination, sensitive-detail layering, launch and command revisions, authorization, idempotency, and result contracts. Adding new tools while leaving an old path that bypasses these rules is not acceptable.

Terminal MCP is still an unpublished development surface, so it exposes only the current canonical tools. Removed coarse tools are not registered as compatibility aliases, requests do not negotiate v1/v2 through `contractVersion`, and capability discovery does not publish compatibility windows.

The MCP registry, dispatcher, schemas, tests, and built-in Synapse Skill must change together. Persistent-data schema versions and optimistic-concurrency revisions remain independent internal mechanisms; removing public MCP version negotiation does not weaken either one.

Once Terminal MCP is deliberately published as a compatibility surface, versioning policy must be designed from the released baseline instead of preserving development-only names preemptively.
