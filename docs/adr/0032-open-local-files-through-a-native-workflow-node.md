---
status: superseded by ADR-0034
---

# Open local files through a native workflow node

Synapse will provide a built-in `open_file` workflow node instead of relying on platform-specific shell scripts. The node accepts one interpolated path that must be an existing absolute non-symbolic-link regular file, then asks the operating system to open it with its associated default application through Electron `shell.openPath()`; relative paths, directories, URLs, application selection, file-type restrictions, and multiple files are outside the first version. An accepted operating-system request is success rather than proof that the external application started, focused, or loaded the file, and the submitted absolute path is returned as both the primary output and structured `path` output.

All local trigger sources, including manual runs, nested workflows, reruns, and Automation, perform the real side effect. The node checks and audits `fs.read.outside-userdata` and `shell.exec` before opening, checks cancellation immediately before submission, and cannot undo an already submitted request. macOS and Windows are the formally validated platforms; Linux uses the same platform-neutral Electron API but is not claimed as formally verified until its packaging and platform tests exist.

The node is shareable as required capability `workflow.node.open_file@1.0.0`, declares high risk `shell.execute`, and never embeds the target file or downgrades to a script node. Literal paths remain external file dependencies that recipients must map, while runtime-variable-derived paths keep their dependency ownership with the corresponding parameter or upstream source.
