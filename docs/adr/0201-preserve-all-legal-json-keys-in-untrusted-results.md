# Preserve all legal JSON keys in untrusted results

JSON processing returns repaired text only after final JSON parsing validates it, without executing the input, but it does not claim that the represented value is trusted, sanitized, or Schema-compliant. Synapse preserves every legal key and value, including `__proto__`, `constructor`, and `prototype`, because silently deleting data would corrupt legitimate payloads without making arbitrary downstream use safe; internal code must treat the result as untrusted data and never merge it into configuration objects or execute its contents.
