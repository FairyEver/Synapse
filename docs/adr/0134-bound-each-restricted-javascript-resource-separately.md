# Bound each restricted JavaScript resource separately

Status: deprecated; replaced by accepted ADR-0204

Restricted JavaScript V1 separately bounds wall time, uninterrupted guest execution, source, input, result, guest heap and stack, logs, timers, fetch calls and concurrency, broker transactions, redirects, headers, and request and response bodies; users may configure only wall time from 1 to 300 seconds, with a 30-second default. Host-operation errors remain catchable where applicable, while wall, CPU-turn, heap, and stack termination is fatal; cancellation and timeout remain distinct, and a result becomes successful only at one atomic commit point.
