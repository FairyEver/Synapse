import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useRef, useEffect, useCallback, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../lib/utils';
const LINE_HEIGHT = 20;
export function Terminal({ lines, trimmedCount, className }) {
    const parentRef = useRef(null);
    const [autoScroll, setAutoScroll] = useState(true);
    const virtualizer = useVirtualizer({
        count: lines.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => LINE_HEIGHT,
        overscan: 20,
    });
    const handleScroll = useCallback(() => {
        const el = parentRef.current;
        if (!el)
            return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < LINE_HEIGHT * 2;
        setAutoScroll(atBottom);
    }, []);
    useEffect(() => {
        if (autoScroll && lines.length > 0) {
            virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
        }
    }, [lines.length, autoScroll, virtualizer]);
    return (_jsxs("div", { className: cn('relative', className), children: [trimmedCount > 0 && (_jsxs("div", { className: "bg-muted text-muted-foreground text-xs px-3 py-1 text-center", children: [trimmedCount, " \u884C\u5DF2\u622A\u65AD"] })), _jsx("div", { ref: parentRef, onScroll: handleScroll, className: "h-full overflow-auto bg-terminal-bg text-terminal-fg font-mono text-xs leading-5", children: _jsx("div", { style: {
                        height: virtualizer.getTotalSize(),
                        width: '100%',
                        position: 'relative',
                    }, children: virtualizer.getVirtualItems().map(virtualRow => {
                        const line = lines[virtualRow.index];
                        return (_jsx("div", { className: cn('absolute left-0 w-full px-3 whitespace-pre-wrap break-all', line.stream === 'stderr' && 'text-terminal-stderr'), style: {
                                top: virtualRow.start,
                                height: virtualRow.size,
                            }, children: line.text }, virtualRow.index));
                    }) }) }), !autoScroll && (_jsx("button", { type: "button", onClick: () => {
                    setAutoScroll(true);
                    virtualizer.scrollToIndex(lines.length - 1, { align: 'end' });
                }, className: "absolute bottom-2 right-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded-md opacity-80 hover:opacity-100", children: "\u2193 \u6700\u65B0" }))] }));
}
