import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Square, Clock, AlertCircle, ArrowLeft, CheckCircle, XCircle } from 'lucide-react';
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
const batchStatusIcon = {
    success: { icon: CheckCircle, className: 'text-green-500' },
    partial: { icon: AlertCircle, className: 'text-orange-500' },
    error: { icon: XCircle, className: 'text-destructive' },
};
export function RunView({ snapshot, outputLines, trimmed, onStop, onBack }) {
    const batch = snapshot.currentBatch;
    const displayBatch = batch ?? snapshot.lastBatch;
    const canStop = snapshot.status === 'running' || snapshot.status === 'waiting';
    const isFinished = !canStop && !batch;
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center gap-3", children: [isFinished && (_jsxs("button", { type: "button", onClick: onBack, className: "flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors", children: [_jsx(ArrowLeft, { className: "h-3.5 w-3.5" }), "\u8FD4\u56DE\u914D\u7F6E"] })), _jsx("span", { className: "text-sm font-medium", children: statusLabels[snapshot.status] ?? snapshot.status }), displayBatch && (_jsxs("span", { className: "text-xs text-muted-foreground flex items-center gap-1", children: [_jsx(Clock, { className: "h-3 w-3" }), formatDuration(displayBatch.durationMs)] }))] }), canStop && (_jsxs("button", { type: "button", onClick: onStop, className: "flex items-center gap-1.5 bg-destructive text-white rounded-md py-1.5 px-3 text-sm font-medium hover:opacity-90 transition-opacity", children: [_jsx(Square, { className: "h-3.5 w-3.5" }), "\u5F53\u524D\u6279\u6B21\u540E\u505C\u6B62"] })), isFinished && !canStop && (_jsx("button", { type: "button", onClick: onBack, className: "flex items-center gap-1.5 border border-border rounded-md py-1.5 px-3 text-sm font-medium hover:bg-muted transition-colors", children: "\u8FD4\u56DE\u914D\u7F6E" }))] }), isFinished && displayBatch && (_jsx(BatchSummary, { batch: displayBatch })), snapshot.error && (_jsxs("div", { className: "flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-md p-3", children: [_jsx(AlertCircle, { className: "h-4 w-4 shrink-0" }), snapshot.error] })), displayBatch && (_jsx(WorkerGrid, { workers: displayBatch.workers, outputLines: outputLines, trimmed: trimmed }))] }));
}
function BatchSummary({ batch }) {
    const cfg = batchStatusIcon[batch.status] ?? batchStatusIcon.error;
    const Icon = cfg.icon;
    const successCount = batch.workers.filter(w => w.status === 'success').length;
    const errorCount = batch.workers.filter(w => w.status === 'error' || w.status === 'timeout').length;
    return (_jsxs("div", { className: "flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3", children: [_jsx(Icon, { className: `h-5 w-5 ${cfg.className}` }), _jsxs("div", { className: "text-sm", children: [_jsx("span", { className: "font-medium", children: batch.status === 'success' ? '全部成功' : batch.status === 'partial' ? '部分成功' : '执行失败' }), _jsxs("span", { className: "text-muted-foreground ml-2", children: [successCount, "/", batch.workers.length, " \u6210\u529F", errorCount > 0 ? ` · ${errorCount} 失败` : '', ' · ', formatDuration(batch.durationMs)] })] })] }));
}
