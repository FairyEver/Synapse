# Model terminal attention as an evidence-based tri-state

Terminal control exposes an attention state independent of the terminal process lifecycle: `waiting`, `not_waiting`, or `unknown`. Both affirmative states require explainable evidence, while missing or inconclusive evidence resolves to `unknown`; silence alone proves neither state. The observation includes a reason, confidence, detection time, corresponding output sequence, and an interaction classification that can distinguish a ready shell, Agent question, approval or confirmation, password request, and other prompts.

This contract helps an external Agent decide whether to read, wait, or provide input without claiming that Synapse can identify every arbitrary terminal program perfectly. Process lifecycle remains authoritative for whether a session can still accept input, while attention remains an evidence-backed observation that may legitimately be unknown.
