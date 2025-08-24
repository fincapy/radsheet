// Dedicated Web Worker for chunk encoding + IndexedDB writes
// Minimal API, communicates via postMessage. Imports the existing ChunkCodec
// to avoid duplicating encode logic.
import { ChunkCodec } from '../../domain/sheet.js';

let db = null;
let chunkStoreName = 'chunks';
let metaStoreName = 'meta';

function openIfNeeded(databaseName) {
	if (db) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName, 1);
		request.onupgradeneeded = () => {
			const _db = request.result;
			if (!_db.objectStoreNames.contains(chunkStoreName)) _db.createObjectStore(chunkStoreName);
			if (!_db.objectStoreNames.contains(metaStoreName)) _db.createObjectStore(metaStoreName);
		};
		request.onsuccess = () => {
			db = request.result;
			resolve();
		};
		request.onerror = () => reject(request.error);
	});
}

function putCompressedChunkBytes(key, bytes) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(chunkStoreName, 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.objectStore(chunkStoreName).put(bytes, key);
	});
}

function putStringTable(list) {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(metaStoreName, 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.objectStore(metaStoreName).put(Array.from(list), 'strings');
	});
}

self.onmessage = async (ev) => {
	const msg = ev.data;
	try {
		if (msg.type === 'init') {
			chunkStoreName = msg.chunkStoreName || 'chunks';
			metaStoreName = msg.metaStoreName || 'meta';
			await openIfNeeded(msg.databaseName || 'SheetDB');
			self.postMessage({ type: 'inited' });
			return;
		}
		if (msg.type === 'persistChunk') {
			const { key, snapshot, stringTable } = msg;

			// Build a proper string table mapping for both dense and sparse chunks
			const idByString = new Map((stringTable || []).map((s, i) => [s, i]));
			const table = {
				getIdForString: (str) => idByString.get(str) ?? 0,
				getStringById: (id) => (stringTable && stringTable[id]) || ''
			};

			let encoded;
			if (snapshot.kind === 'dense') {
				// Rebuild a minimal chunk shape for encoder
				const dense = {
					kind: 'dense',
					nonEmptyCellCount: snapshot.nonEmptyCellCount,
					isDirty: true,
					tagByLocalIndex: snapshot.tagByLocalIndex,
					numberByLocalIndex: snapshot.numberByLocalIndex,
					stringIdByLocalIndex: snapshot.stringIdByLocalIndex
				};
				encoded = ChunkCodec.encodeChunk(dense, table);
			} else {
				// Rebuild a sparse-like structure
				const sparse = {
					kind: 'sparse',
					nonEmptyCellCount: snapshot.nonEmptyCellCount,
					isDirty: true,
					localIndexToValue: new Map(snapshot.entries)
				};
				encoded = ChunkCodec.encodeChunk(sparse, table);
			}
			await putCompressedChunkBytes(key, encoded);
			if (stringTable) await putStringTable(stringTable);
			self.postMessage({ type: 'persistDone', key });
			return;
		}
		if (msg.type === 'persistStringTable') {
			await putStringTable(msg.list);
			self.postMessage({ type: 'stringsDone' });
			return;
		}
	} catch (err) {
		self.postMessage({ type: 'error', error: String(err) });
	}
};
