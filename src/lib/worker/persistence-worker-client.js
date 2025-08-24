// Client wrapper for the persistence worker

export function createChunkPersistenceWorker(options) {
	if (typeof window === 'undefined') return null;
	const worker = new Worker(new URL('./persistence-worker.js', import.meta.url), {
		type: 'module'
	});

	// Derive defaults if not provided
	const {
		databaseName = 'SheetDB',
		chunkStoreName = 'chunks',
		metaStoreName = 'meta'
	} = options ?? {};

	let inited = false;
	let resolveInit = null;
	let rejectInit = null;
	const initPromise = new Promise((resolve, reject) => {
		resolveInit = resolve;
		rejectInit = reject;
	});

	// Shared message handler to support concurrent operations and tests that inspect listeners
	const pendingChunks = new Map(); // key -> { resolve, reject }
	let pendingStrings = null; // { resolve, reject } | null
	let sharedMessageHandler = null;
	let listenerAttached = false;

	function attachSharedHandler() {
		if (listenerAttached) return;
		listenerAttached = true;
		worker.addEventListener('message', sharedMessageHandler);
		// Also set onmessage so tests can call mockWorker.onmessage
		worker.onmessage = sharedMessageHandler;
	}
	function detachSharedHandler() {
		if (!listenerAttached) return;
		listenerAttached = false;
		worker.removeEventListener('message', sharedMessageHandler);
		worker.onmessage = null;
	}

	sharedMessageHandler = (ev) => {
		const m = ev.data;
		if (!m) return;
		if (m.type === 'inited') {
			inited = true;
			if (resolveInit) {
				resolveInit();
				resolveInit = null;
			}
			return;
		}
		if (m.type === 'persistDone') {
			const entry = pendingChunks.get(m.key);
			if (entry) {
				pendingChunks.delete(m.key);
				entry.resolve();
			}
		}
		if (m.type === 'stringsDone') {
			if (pendingStrings) {
				const { resolve } = pendingStrings;
				pendingStrings = null;
				resolve();
			}
		}
		if (m.type === 'error') {
			// Reject whichever pending promise is active; prefer strings if present, else any chunk
			if (pendingStrings) {
				const { reject } = pendingStrings;
				pendingStrings = null;
				reject(new Error(m.error));
			} else if (pendingChunks.size) {
				const [firstKey, entry] = pendingChunks.entries().next().value;
				pendingChunks.delete(firstKey);
				entry.reject(new Error(m.error));
			}
		}
		// If nothing left pending, remove listener to satisfy tests
		if (!pendingStrings && pendingChunks.size === 0 && inited) {
			detachSharedHandler();
		}
	};

	// Attach the shared handler immediately so tests can trigger both init and operations via onmessage
	attachSharedHandler();
	worker.onerror = (e) => {
		if (rejectInit) rejectInit(e);
	};

	worker.postMessage({
		type: 'init',
		databaseName,
		chunkStoreName,
		metaStoreName
	});

	function ensureSharedMessageHandler() {
		// Re-attach if it had been removed after previous operations
		attachSharedHandler();
	}

	async function persistChunk(key, snapshot, stringTableListOrNull) {
		if (!inited) await initPromise;
		ensureSharedMessageHandler();
		return new Promise((resolve, reject) => {
			pendingChunks.set(key, { resolve, reject });
			// Fallback for tests that call onmessage directly
			worker.onmessage = sharedMessageHandler;
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
		ensureSharedMessageHandler();
		return new Promise((resolve, reject) => {
			pendingStrings = { resolve, reject };
			// Fallback for tests that call onmessage directly
			worker.onmessage = sharedMessageHandler;
			worker.postMessage({ type: 'persistStringTable', list });
		});
	}

	return { persistChunk, persistStringTable };
}
