import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback, useEffect } from 'react';
import { useConfig } from './hooks/use-config';
import { useOutputBuffer } from './hooks/use-output-buffer';
import { useSSE } from './hooks/use-sse';
import { ConfigView } from './views/config-view';
import { RunView } from './views/run-view';
import * as api from './api';
export function App() {
    const { config, loading, error, save, setConfig } = useConfig();
    const [snapshot, setSnapshot] = useState(null);
    const outputBuffer = useOutputBuffer();
    useSSE({
        onSnapshot: useCallback((s) => setSnapshot(s), []),
        buffer: outputBuffer,
    });
    useEffect(() => {
        if (snapshot && !snapshot.currentBatch)
            return;
        if (snapshot?.currentBatch) {
            api.fetchWorkerOutput()
                .then(res => outputBuffer.load(res.workers))
                .catch(() => { });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- load on mount + batch change
    }, [snapshot?.currentBatch?.id]);
    const handleStart = useCallback(async () => {
        if (!config)
            return;
        try {
            const saved = await save(config);
            const s = await api.startScheduler(saved);
            setSnapshot(s);
            outputBuffer.reset();
        }
        catch (err) {
            console.error('Start failed:', err);
        }
    }, [config, save, outputBuffer]);
    const handleStop = useCallback(async () => {
        try {
            const s = await api.stopAfterCurrent();
            setSnapshot(s);
        }
        catch (err) {
            console.error('Stop failed:', err);
        }
    }, []);
    const isRunning = snapshot && !['idle', 'stopped', 'error'].includes(snapshot.status);
    if (loading) {
        return (_jsx("div", { className: "min-h-screen flex items-center justify-center text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }));
    }
    if (error || !config) {
        return (_jsx("div", { className: "min-h-screen flex items-center justify-center text-destructive", children: error ?? '无法加载配置' }));
    }
    return (_jsxs("div", { className: "min-h-screen p-6", children: [_jsxs("header", { className: "mb-6 flex items-center gap-3", children: [_jsx("h1", { className: "text-lg font-semibold tracking-tight", children: "auto" }), snapshot && (_jsx("span", { className: "text-xs text-muted-foreground", children: snapshot.status }))] }), isRunning && snapshot ? (_jsx(RunView, { snapshot: snapshot, outputLines: outputBuffer.lines, trimmed: outputBuffer.trimmed, onStop: handleStop })) : (_jsx(ConfigView, { config: config, onChange: setConfig, onStart: handleStart }))] }));
}
