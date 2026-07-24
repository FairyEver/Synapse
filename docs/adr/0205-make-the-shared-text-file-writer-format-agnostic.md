# Make the shared Text File Writer format-agnostic

The shared Text File Writer accepts any absolute local target path, including arbitrary extensions and paths without an extension. It writes the complete input string using the requested `utf8` or `utf16le` encoding and does not use the path extension to accept, reject, parse, validate, repair, or rewrite the content. The compatibility `format` result remains the lower-case final extension and is an empty string when the path has none.

This supersedes the shared Writer extension allowlist and HTML-only UTF-8 rule from ADR 0040. `UNSUPPORTED_EXTENSION` remains a shared legacy error for narrower composed capabilities, but the Text File Writer itself never emits it. Text Extractor continues to accept only `.txt`, `.md`, and `.csv` output paths, while HTML Generator continues to accept only `.html` and `.htm`; those are product contracts enforced before they call the Writer.

The capability version advances from `app.text_file_writer.file.write@1.1.0` to `@1.2.0`. Newly exported Workflow nodes uniformly require 1.2.0 because a dynamic path can resolve to any filename, while clients implementing 1.2.0 remain compatible with packages requiring 1.0.0 or 1.1.0.
