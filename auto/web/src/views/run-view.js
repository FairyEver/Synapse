import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Square, Clock, AlertCircle } from 'lucide-react';
import { WorkerGrid } from '../components/worker-grid';
const statusLabels = {
    idle: '空闲',
    running: '运行中',
    waiting: '等待下一批',
    stopping: '停止中…',
    stopped: '已停止',
    error: '错误',
};
function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    if (m === 0)
        return `${s}s`;
    return `${m}m ${s % 60}s`;
}
export function RunView({ snapshot, outputLines, trimmed, onStop }) {
    const batch = snapshot.currentBatch;
    const canStop = snapshot.status === 'running' || snapshot.status === 'waiting';
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-sm font-medium", children: statusLabels[snapshot.status] ?? snapshot.status }), batch && (_jsxs("span", { className: "text-xs text-muted-foreground flex items-center gap-1", children: [_jsx(Clock, { className: "h-3 w-3" }), formatDuration(batch.durationMs)] }))] }), canStop && (_jsxs("button", { type: "button", onClick: onStop, className: "flex items-center gap-1.5 bg-destructive text-white rounded-md py-1.5 px-3 text-sm font-medium hover:opacity-90 transition-opacity", children: [_jsx(Square, { className: "h-3.5 w-3.5" }), "\u5F53\u524D\u6279\u6B21\u540E\u505C\u6B62"] }))] }), snapshot.error && (_jsxs("div", { className: "flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-md p-3", children: [_jsx(AlertCircle, { className: "h-4 w-4 shrink-0" }), snapshot.error] })), batch && (_jsx(WorkerGrid, { workers: batch.workers, outputLines: outputLines, trimmed: trimmed })), snapshot.lastBatch && !batch && (_jsxs("div", { className: "text-sm text-muted-foreground", children: ["\u4E0A\u6B21\u6279\u6B21: ", snapshot.lastBatch.status, " \u2014 ", formatDuration(snapshot.lastBatch.durationMs)] }))] }));
}
