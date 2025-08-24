// Client wrapper for the persistence worker

export function createChunkPersistenceWorker(options) {
	if (typeof window === 'undefined') return null;
	const worker = new Worker(new URL('./persistence-worker.js', import.meta.url), {
		type: 'module'
	});

	let inited = false;
	const initPromise = new Promise((resolve, reject) => {
		worker.onmessage = (ev) => {
			if (ev.data?.type === 'inited') {
				inited = true;
				resolve();
			}
		};
		worker.onerror = (e) => reject(e);
	});

	worker.postMessage({ type: 'init', ...options });

	async function persistChunk(key, snapshot, stringTableListOrNull) {
		if (!inited) await initPromise;
		return new Promise((resolve, reject) => {
			const onMessage = (ev) => {
				const m = ev.data;
				if (m?.type === 'persistDone' && m.key === key) {
					worker.removeEventListener('message', onMessage);
					resolve();
				}
				if (m?.type === 'error') {
					worker.removeEventListener('message', onMessage);
					reject(new Error(m.error));
				}
			};
			worker.addEventListener('message', onMessage);
			worker.postMessage({
				type: 'persistChunk',
				key,
				snapshot,
				stringTable: stringTableListOrNull
			});
		});
	}

	async function persistStringTable(list) {
		if (!inited) await initPromise;
		return new Promise((resolve, reject) => {
			const onMessage = (ev) => {
				const m = ev.data;
				if (m?.type === 'stringsDone') {
					worker.removeEventListener('message', onMessage);
					resolve();
				}
				if (m?.type === 'error') {
					worker.removeEventListener('message', onMessage);
					reject(new Error(m.error));
				}
			};
			worker.addEventListener('message', onMessage);
			worker.postMessage({ type: 'persistStringTable', list });
		});
	}

	return { persistChunk, persistStringTable };
}
