import { useCallback, useRef, useState } from 'react';
const MAX_LINES_PER_WORKER = 2000;
export function useOutputBuffer() {
    const linesRef = useRef(new Map());
    const trimmedRef = useRef(new Map());
    const [, setTick] = useState(0);
    const flush = useCallback(() => setTick(t => t + 1), []);
    const append = useCallback((line) => {
        let bucket = linesRef.current.get(line.workerId);
        if (!bucket) {
            bucket = [];
            linesRef.current.set(line.workerId, bucket);
        }
        bucket.push(line);
        if (bucket.length > MAX_LINES_PER_WORKER) {
            const excess = bucket.length - MAX_LINES_PER_WORKER;
            bucket.splice(0, excess);
            trimmedRef.current.set(line.workerId, (trimmedRef.current.get(line.workerId) ?? 0) + excess);
        }
        flush();
    }, [flush]);
    const reset = useCallback(() => {
        linesRef.current = new Map();
        trimmedRef.current = new Map();
        flush();
    }, [flush]);
    const load = useCallback((workers) => {
        const next = new Map();
        for (const [id, lines] of Object.entries(workers)) {
            next.set(Number(id), lines);
        }
        linesRef.current = next;
        trimmedRef.current = new Map();
        flush();
    }, [flush]);
    return {
        lines: linesRef.current,
        trimmed: trimmedRef.current,
        append,
        reset,
        load,
    };
}
