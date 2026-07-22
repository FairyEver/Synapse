# Refuse concurrent text file overwrites

The Text File Writer stages encoded content beside the target and commits it only while the target still matches the state observed for the operation. Even with explicit overwrite permission, a detected concurrent modification or replacement aborts the commit, preserves the external version, reports a retryable target-changed error, and removes the operation's temporary file; this is a best-effort cross-platform safeguard rather than a claim that filesystem races can be eliminated completely.
