import { useEffect, useRef } from 'react';
export function useSSE({ onSnapshot, buffer }) {
    const onSnapshotRef = useRef(onSnapshot);
    onSnapshotRef.current = onSnapshot;
    const bufferRef = useRef(buffer);
    bufferRef.current = buffer;
    useEffect(() => {
        let es = null;
        let retryTimer = null;
        function connect() {
            es = new EventSource('/events');
            es.addEventListener('snapshot', (e) => {
                try {
                    const snapshot = JSON.parse(e.data);
                    onSnapshotRef.current(snapshot);
                }
                catch { /* ignore malformed */ }
            });
            es.addEventListener('output', (e) => {
                try {
                    const line = JSON.parse(e.data);
                    bufferRef.current.append(line);
                }
                catch { /* ignore malformed */ }
            });
            es.onerror = () => {
                es?.close();
                retryTimer = setTimeout(connect, 3000);
            };
        }
        connect();
        return () => {
            es?.close();
            if (retryTimer)
                clearTimeout(retryTimer);
        };
    }, []);
}
