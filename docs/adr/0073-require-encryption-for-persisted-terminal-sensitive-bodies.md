# Require encryption for persisted Terminal sensitive bodies

Persisted raw output, emulator checkpoints and derived scrollback, stored command bodies, environment values, and other sensitive values that must be recoverable use Synapse's shared encryption capability. OS safeStorage protects the data key, and a verified chunked authenticated-encryption construction protects bodies. Every block has an independent nonce and authentication tag, with AAD binding `blockId`, `sessionId`, body type, and `schemaVersion`. A digest is an integrity index and never substitutes for authenticated encryption.

When secure encryption is unavailable, terminals and current in-memory output remain usable, but no sensitive body becomes restart-persistent. Saving commands or sensitive launch configuration fails explicitly, diagnostics expose `persistenceProtection=unavailable`, and there is no plaintext fallback.

Missing or corrupt keys or ciphertext preserve structural metadata and mark affected bodies and derived capabilities degraded; the service does not delete references and pretend the content never existed. Legacy plaintext migration first encrypts and verifies the complete target, then cuts over atomically. If encryption is unavailable, it neither switches nor deletes the source.

Ordinary plaintext backups exclude command bodies. Sensitive Terminal bodies may enter only a future protected dedicated backup or export. Implementation acceptance verifies safeStorage availability, data-key recovery and rotation, corruption handling, and failure degradation on macOS, Windows, Linux, and packaged builds.
