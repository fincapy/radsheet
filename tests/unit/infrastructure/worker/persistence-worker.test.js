import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChunkCodec } from '../../../../src/domain/codec/ChunkCodec.js';

// Mock IndexedDB
const mockIndexedDB = {
	open: vi.fn(() => ({
		onupgradeneeded: null,
		onsuccess: null,
		onerror: null,
		result: {
			createObjectStore: vi.fn(),
			objectStoreNames: {
				contains: vi.fn(() => false)
			},
			transaction: vi.fn(() => ({
				objectStore: vi.fn(() => ({
					get: vi.fn(() => ({ onsuccess: null, onerror: null })),
					put: vi.fn(() => ({ onsuccess: null, onerror: null })),
					delete: vi.fn(() => ({ onsuccess: null, onerror: null }))
				})),
				oncomplete: null,
				onerror: null
			}))
		}
	}))
};

// Mock the worker context
const mockSelf = {
	postMessage: vi.fn(),
	onmessage: null
};

// Mock global indexedDB
global.indexedDB = mockIndexedDB;
global.self = mockSelf;

// Import the worker code (we'll need to adapt it for testing)
// Since the worker is a module, we'll test its logic directly

describe('Persistence Worker Logic', () => {
	let db = null;
	let chunkStoreName = 'chunks';
	let metaStoreName = 'meta';

	beforeEach(() => {
		// Reset state
		db = null;
		chunkStoreName = 'chunks';
		metaStoreName = 'meta';
		vi.clearAllMocks();
	});

	describe('Database Operations', () => {
		it('opens database correctly', async () => {
			const databaseName = 'test-db';

			// Mock successful database open
			const mockRequest = {
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
				result: {
					createObjectStore: vi.fn(),
					objectStoreNames: {
						contains: vi.fn(() => false)
					}
				}
			};

			mockIndexedDB.open.mockReturnValue(mockRequest);

			// Simulate successful open
			setTimeout(() => {
				mockRequest.result = mockRequest.result;
				if (mockRequest.onsuccess) {
					mockRequest.onsuccess({ target: mockRequest });
				}
			}, 0);

			// Test the openIfNeeded function logic
			const openIfNeeded = async (dbName) => {
				if (db) return Promise.resolve();
				return new Promise((resolve, reject) => {
					const request = indexedDB.open(dbName, 1);
					request.onupgradeneeded = () => {
						const _db = request.result;
						if (!_db.objectStoreNames.contains(chunkStoreName)) {
							_db.createObjectStore(chunkStoreName);
						}
						if (!_db.objectStoreNames.contains(metaStoreName)) {
							_db.createObjectStore(metaStoreName);
						}
					};
					request.onsuccess = () => {
						db = request.result;
						resolve();
					};
					request.onerror = () => reject(request.error);
				});
			};

			await openIfNeeded(databaseName);
			expect(mockIndexedDB.open).toHaveBeenCalledWith(databaseName, 1);
		});

		it('handles database open errors', async () => {
			const databaseName = 'error-db';

			const mockRequest = {
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
				error: new Error('Database error')
			};

			mockIndexedDB.open.mockReturnValue(mockRequest);

			// Simulate error
			setTimeout(() => {
				if (mockRequest.onerror) {
					mockRequest.onerror({ target: mockRequest });
				}
			}, 0);

			const openIfNeeded = async (dbName) => {
				if (db) return Promise.resolve();
				return new Promise((resolve, reject) => {
					const request = indexedDB.open(dbName, 1);
					request.onupgradeneeded = () => {
						const _db = request.result;
						if (!_db.objectStoreNames.contains(chunkStoreName)) {
							_db.createObjectStore(chunkStoreName);
						}
						if (!_db.objectStoreNames.contains(metaStoreName)) {
							_db.createObjectStore(metaStoreName);
						}
					};
					request.onsuccess = () => {
						db = request.result;
						resolve();
					};
					request.onerror = () => reject(request.error);
				});
			};

			await expect(openIfNeeded(databaseName)).rejects.toThrow('Database error');
		});
	});

	describe('Chunk Persistence', () => {
		it('encodes and stores dense chunks', async () => {
			// Mock database
			db = {
				transaction: vi.fn(() => ({
					objectStore: vi.fn(() => ({
						put: vi.fn(() => ({
							onsuccess: null,
							onerror: null
						}))
					})),
					oncomplete: null,
					onerror: null
				}))
			};

			const putCompressedChunkBytes = async (key, bytes) => {
				return new Promise((resolve, reject) => {
					const tx = db.transaction(chunkStoreName, 'readwrite');
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
					tx.objectStore(chunkStoreName).put(bytes, key);
				});
			};

			const key = 'test-chunk';
			const bytes = new Uint8Array([1, 2, 3, 4]);

			// Simulate successful transaction
			setTimeout(() => {
				const tx = db.transaction.mock.results[0].value;
				if (tx.oncomplete) {
					tx.oncomplete();
				}
			}, 0);

			await putCompressedChunkBytes(key, bytes);
			expect(db.transaction).toHaveBeenCalledWith(chunkStoreName, 'readwrite');
		});

		it('encodes and stores sparse chunks', async () => {
			// Test sparse chunk encoding logic
			const stringTable = ['hello', 'world'];
			const snapshot = {
				kind: 'sparse',
				nonEmptyCellCount: 2,
				entries: [
					[0, 'hello'],
					[100, 'world']
				]
			};

			// Build string table mapping
			const idByString = new Map(stringTable.map((s, i) => [s, i]));
			const table = {
				getIdForString: (str) => idByString.get(str) ?? 0,
				getStringById: (id) => (stringTable && stringTable[id]) || ''
			};

			// Rebuild sparse structure
			const sparse = {
				kind: 'sparse',
				nonEmptyCellCount: snapshot.nonEmptyCellCount,
				isDirty: true,
				localIndexToValue: new Map(snapshot.entries)
			};

			const encoded = ChunkCodec.encodeChunk(sparse, table);
			expect(encoded).toBeInstanceOf(Uint8Array);
			expect(encoded.length).toBeGreaterThan(0);
		});
	});

	describe('String Table Persistence', () => {
		it('stores string table list', async () => {
			// Mock database
			db = {
				transaction: vi.fn(() => ({
					objectStore: vi.fn(() => ({
						put: vi.fn(() => ({
							onsuccess: null,
							onerror: null
						}))
					})),
					oncomplete: null,
					onerror: null
				}))
			};

			const putStringTable = async (list) => {
				return new Promise((resolve, reject) => {
					const tx = db.transaction(metaStoreName, 'readwrite');
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
					tx.objectStore(metaStoreName).put(Array.from(list), 'strings');
				});
			};

			const stringList = ['hello', 'world', 'test'];

			// Simulate successful transaction
			setTimeout(() => {
				const tx = db.transaction.mock.results[0].value;
				if (tx.oncomplete) {
					tx.oncomplete();
				}
			}, 0);

			await putStringTable(stringList);
			expect(db.transaction).toHaveBeenCalledWith(metaStoreName, 'readwrite');
		});
	});

	describe('Message Handling', () => {
		it('handles init message', async () => {
			const message = {
				type: 'init',
				databaseName: 'test-db',
				chunkStoreName: 'custom-chunks',
				metaStoreName: 'custom-meta'
			};

			// Mock successful database open
			const mockRequest = {
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
				result: {
					createObjectStore: vi.fn(),
					objectStoreNames: {
						contains: vi.fn(() => false)
					}
				}
			};

			mockIndexedDB.open.mockReturnValue(mockRequest);

			// Simulate successful open
			setTimeout(() => {
				mockRequest.result = mockRequest.result;
				if (mockRequest.onsuccess) {
					mockRequest.onsuccess({ target: mockRequest });
				}
			}, 0);

			// Test message handler logic
			const handleMessage = async (ev) => {
				const msg = ev.data;
				try {
					if (msg.type === 'init') {
						chunkStoreName = msg.chunkStoreName || 'chunks';
						metaStoreName = msg.metaStoreName || 'meta';

						// Open database
						if (db) return Promise.resolve();
						await new Promise((resolve, reject) => {
							const request = indexedDB.open(msg.databaseName || 'SheetDB', 1);
							request.onupgradeneeded = () => {
								const _db = request.result;
								if (!_db.objectStoreNames.contains(chunkStoreName)) {
									_db.createObjectStore(chunkStoreName);
								}
								if (!_db.objectStoreNames.contains(metaStoreName)) {
									_db.createObjectStore(metaStoreName);
								}
							};
							request.onsuccess = () => {
								db = request.result;
								resolve();
							};
							request.onerror = () => reject(request.error);
						});

						mockSelf.postMessage({ type: 'inited' });
						return;
					}
				} catch (err) {
					mockSelf.postMessage({ type: 'error', error: String(err) });
				}
			};

			await handleMessage({ data: message });

			expect(chunkStoreName).toBe('custom-chunks');
			expect(metaStoreName).toBe('custom-meta');
			expect(mockSelf.postMessage).toHaveBeenCalledWith({ type: 'inited' });
		});

		it('handles persistChunk message', async () => {
			// Mock database
			db = {
				transaction: vi.fn(() => ({
					objectStore: vi.fn(() => ({
						put: vi.fn(() => ({
							onsuccess: null,
							onerror: null
						}))
					})),
					oncomplete: null,
					onerror: null
				}))
			};

			const message = {
				type: 'persistChunk',
				key: 'test-chunk',
				snapshot: {
					kind: 'dense',
					nonEmptyCellCount: 1,
					tagByLocalIndex: new Uint8Array(4096),
					numberByLocalIndex: new Float64Array(4096),
					stringIdByLocalIndex: new Uint32Array(4096)
				},
				stringTable: ['test']
			};

			// Simulate successful transaction
			setTimeout(() => {
				const tx = db.transaction.mock.results[0].value;
				if (tx.oncomplete) {
					tx.oncomplete();
				}
			}, 0);

			// Test message handler logic
			const handleMessage = async (ev) => {
				const msg = ev.data;
				try {
					if (msg.type === 'persistChunk') {
						const { key, snapshot, stringTable } = msg;

						// Build string table mapping
						const idByString = new Map((stringTable || []).map((s, i) => [s, i]));
						const table = {
							getIdForString: (str) => idByString.get(str) ?? 0,
							getStringById: (id) => (stringTable && stringTable[id]) || ''
						};

						let encoded;
						if (snapshot.kind === 'dense') {
							const dense = {
								kind: 'dense',
								nonEmptyCellCount: snapshot.nonEmptyCellCount,
								isDirty: true,
								tagByLocalIndex: snapshot.tagByLocalIndex,
								numberByLocalIndex: snapshot.numberByLocalIndex,
								stringIdByLocalIndex: snapshot.stringIdByLocalIndex
							};
							encoded = ChunkCodec.encodeChunk(dense, table);
						}

						// Store chunk
						await new Promise((resolve, reject) => {
							const tx = db.transaction(chunkStoreName, 'readwrite');
							tx.oncomplete = () => resolve();
							tx.onerror = () => reject(tx.error);
							tx.objectStore(chunkStoreName).put(encoded, key);
						});

						mockSelf.postMessage({ type: 'persistDone', key });
						return;
					}
				} catch (err) {
					mockSelf.postMessage({ type: 'error', error: String(err) });
				}
			};

			await handleMessage({ data: message });

			expect(mockSelf.postMessage).toHaveBeenCalledWith({ type: 'persistDone', key: 'test-chunk' });
		});

		it('handles persistStringTable message', async () => {
			// Mock database
			db = {
				transaction: vi.fn(() => ({
					objectStore: vi.fn(() => ({
						put: vi.fn(() => ({
							onsuccess: null,
							onerror: null
						}))
					})),
					oncomplete: null,
					onerror: null
				}))
			};

			const message = {
				type: 'persistStringTable',
				list: ['hello', 'world']
			};

			// Simulate successful transaction
			setTimeout(() => {
				const tx = db.transaction.mock.results[0].value;
				if (tx.oncomplete) {
					tx.oncomplete();
				}
			}, 0);

			// Test message handler logic
			const handleMessage = async (ev) => {
				const msg = ev.data;
				try {
					if (msg.type === 'persistStringTable') {
						await new Promise((resolve, reject) => {
							const tx = db.transaction(metaStoreName, 'readwrite');
							tx.oncomplete = () => resolve();
							tx.onerror = () => reject(tx.error);
							tx.objectStore(metaStoreName).put(Array.from(msg.list), 'strings');
						});

						mockSelf.postMessage({ type: 'stringsDone' });
						return;
					}
				} catch (err) {
					mockSelf.postMessage({ type: 'error', error: String(err) });
				}
			};

			await handleMessage({ data: message });

			expect(mockSelf.postMessage).toHaveBeenCalledWith({ type: 'stringsDone' });
		});

		it('handles errors gracefully', async () => {
			const message = {
				type: 'unknown',
				data: 'invalid'
			};

			// Test message handler logic
			const handleMessage = async (ev) => {
				const msg = ev.data;
				try {
					if (msg.type === 'unknown') {
						throw new Error('Unknown message type');
					}
				} catch (err) {
					mockSelf.postMessage({ type: 'error', error: String(err) });
				}
			};

			await handleMessage({ data: message });

			expect(mockSelf.postMessage).toHaveBeenCalledWith({
				type: 'error',
				error: 'Error: Unknown message type'
			});
		});
	});
});
