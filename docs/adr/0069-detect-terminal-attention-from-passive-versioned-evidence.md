# Detect Terminal attention from passive versioned evidence

The initial Terminal attention detector is passive, versioned, and conservative. Strong evidence comes only from verifiable structured markers or protocols actually emitted by the terminal program. Medium evidence combines foreground-process identity, a versioned application adapter, rendered state, and prompt structure; a single regular expression cannot decide attention. Silence, an isolated prompt character, process name, output activity, or CPU state are diagnostic weak signals and never independently produce `waiting` or `not_waiting`.

An attention result returns detector identity and version, attention kind, stable reason code, confidence, detection time, and dependency watermarks including `throughOutputSeq` and `sizeRevision`, without echoing matched text. Persisted evidence contains only necessary category, detector version, and watermarks, never output bodies or password-prompt content. Detection logs and audit follow the same rule.

Accepting any input immediately invalidates old waiting evidence to `unknown`; it does not infer `not_waiting`. New output, resize, degraded rendering, or mode change invalidates dependent evidence until the detector confirms it at the new watermark. Attention is `unknown` outside `running`; lifecycle separately expresses terminal state.

Detector upgrades trigger reevaluation and retain the version fact. Cross-version fixtures and false-positive and false-negative tests cover Claude Code, Codex, shells, password and approval prompts, and long-running services. The initial product accepts substantial `unknown` rather than making unsupported claims.

The initial detector does not modify user shell configuration or silently inject startup integration. Any future Shell integration is explicitly user-enabled and requires a separate design and permission decision.
