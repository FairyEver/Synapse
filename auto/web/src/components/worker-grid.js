import { jsx as _jsx } from "react/jsx-runtime";
import { WorkerPanel } from './worker-panel';
export function WorkerGrid({ workers, outputLines, trimmed }) {
    if (workers.length === 0)
        return null;
    return (_jsx("div", { className: "space-y-2", children: workers.map(worker => (_jsx(WorkerPanel, { worker: worker, lines: outputLines.get(worker.id) ?? [], trimmedCount: trimmed.get(worker.id) ?? 0, defaultOpen: workers.length <= 3 }, worker.id))) }));
}
