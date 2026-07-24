# Use one plain-text body for problem feedback

V1 problem feedback accepts one `content` plain-text business input rather than separate title, category, version, device, session, or template fields. The built-in Synapse Skill organizes the visible text so that it explains the scenario, actual behavior, and reason the user or Agent considers it a problem, while omitting inapplicable sections and never inventing facts; the MCP capability and server preserve the text as an opaque value and do not parse its headings or enrich it with hidden business context.
