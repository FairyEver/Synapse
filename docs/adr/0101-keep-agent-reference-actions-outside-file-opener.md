# Keep Agent reference actions outside File Opener

Agent local-reference actions remain separate from the public File Opener capability because they resolve project-relative references, support directories and folder location, and apply action-specific link and permission rules. File Opener continues to accept only absolute regular non-symbolic-link files across its App, MCP, Workflow, and deep-link surfaces; the two domains may share low-level validation, permission, audit, and redaction helpers without widening either contract.
