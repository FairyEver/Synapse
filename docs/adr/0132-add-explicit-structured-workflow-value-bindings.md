# Add explicit structured Workflow value bindings

Workflow keeps legacy `node_output` bindings as string-only and adds `node_value` bindings that identify a manifest-declared public output by node, output name, and an unambiguous array of string or non-negative integer path segments. The engine carries public structured values separately from primary text outputs, resolves them without coercion or JSON round-trips, and fails before the consumer runs when the declared source value cannot be resolved.
