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
    const [showConfig, setShowConfig] = useState(true);
    const outputBuffer = useOutputBuffer();
    useSSE({
        onSnapshot: useCallback((s) => {
            setSnapshot(s);
            if (!['idle', 'stopped', 'error'].includes(s.status)) {
                setShowConfig(false);
            }
        }, []),
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
    const handleSave = useCallback(async () => {
        if (!config)
            return;
        await save(config);
    }, [config, save]);
    const handleStart = useCallback(async () => {
        if (!config)
            return;
        try {
            const saved = await save(config);
            const s = await api.startScheduler(saved);
            setSnapshot(s);
            setShowConfig(false);
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
    const hasResults = snapshot && (snapshot.currentBatch || snapshot.lastBatch);
    const showRunView = !showConfig && (isRunning || hasResults);
    if (loading) {
        return (_jsx("div", { className: "min-h-screen flex items-center justify-center text-muted-foreground", children: "\u52A0\u8F7D\u4E2D\u2026" }));
    }
    if (error || !config) {
        return (_jsx("div", { className: "min-h-screen flex items-center justify-center text-destructive", children: error ?? '无法加载配置' }));
    }
    return (_jsxs("div", { className: "min-h-screen flex flex-col", children: [_jsxs("header", { className: "sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-6 py-3 flex items-center gap-3", children: [_jsx("h1", { className: "text-sm font-bold tracking-tight uppercase text-foreground/80", children: "auto" }), _jsx("div", { className: "h-3 w-px bg-border" }), _jsx("span", { className: "text-xs text-muted-foreground", children: snapshot ? snapshot.status : 'idle' })] }), _jsx("main", { className: "flex-1 px-6 py-6", children: showRunView && snapshot ? (_jsx(RunView, { snapshot: snapshot, outputLines: outputBuffer.lines, trimmed: outputBuffer.trimmed, onStop: handleStop, onBack: () => setShowConfig(true) })) : (_jsx(ConfigView, { config: config, onChange: setConfig, onSave: handleSave, onStart: handleStart })) })] }));
}
