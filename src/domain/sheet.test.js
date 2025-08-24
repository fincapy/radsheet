import { describe, it, expect, beforeEach } from 'vitest';
import {
	computeLocalIndexWithinChunk,
	GlobalStringTable,
	LeastRecentlyUsedCache,
	rleEncodeUint8,
	rleDecodeUint8,
	writeVarintUnsigned,
	readVarintUnsigned,
	concatUint8,
	float64ArrayToBytes,
	bytesToFloat64Array,
	createDenseChunk,
	createSparseChunk,
	ChunkCodec,
	ChunkStore,
	Sheet,
	CELL_TYPE_EMPTY,
	CELL_TYPE_STRING,
	CELL_TYPE_NUMBER,
	CELLS_PER_CHUNK,
} from './sheet.js';

describe('Sheet Utility Functions', () => {
	it('computeLocalIndexWithinChunk calculates the correct index', () => {
		// Top-left corner of a chunk
		expect(computeLocalIndexWithinChunk(0, 0)).toBe(0);
		expect(computeLocalIndexWithinChunk(64, 128)).toBe(0); // Also (0,0) in a different chunk

		// Some other values
		expect(computeLocalIndexWithinChunk(0, 1)).toBe(1);
		expect(computeLocalIndexWithinChunk(1, 0)).toBe(64); // 1 * 64 + 0
		expect(computeLocalIndexWithinChunk(10, 20)).toBe(10 * 64 + 20);

		// Bottom-right corner of a chunk
		expect(computeLocalIndexWithinChunk(63, 63)).toBe(4095);
		expect(computeLocalIndexWithinChunk(127, 191)).toBe(4095); // Also (63,63) in a different chunk
	});

	describe('Run-Length Encoding (RLE)', () => {
		it('handles an empty array', () => {
			const input = new Uint8Array([]);
			const encoded = rleEncodeUint8(input);
			expect(encoded).toEqual(new Uint8Array([]));
			const decoded = rleDecodeUint8(encoded, 0);
			expect(decoded).toEqual(input);
		});

		it('encodes and decodes an array with no repeating runs', () => {
			const input = new Uint8Array([1, 2, 3, 4, 5]);
			const encoded = rleEncodeUint8(input);
			// Expected: run of 1, value 1; run of 1, value 2; etc.
			expect(encoded).toEqual(new Uint8Array([1, 1, 1, 2, 1, 3, 1, 4, 1, 5]));
			const decoded = rleDecodeUint8(encoded, 5);
			expect(decoded).toEqual(input);
		});

		it('encodes and decodes an array with multiple runs', () => {
			const input = new Uint8Array([5, 5, 5, 5, 2, 2, 9, 9, 9]);
			const encoded = rleEncodeUint8(input);
			expect(encoded).toEqual(new Uint8Array([4, 5, 2, 2, 3, 9]));
			const decoded = rleDecodeUint8(encoded, 9);
			expect(decoded).toEqual(input);
		});

		it('handles runs longer than 255', () => {
			const input = new Uint8Array(300).fill(7);
			const encoded = rleEncodeUint8(input);
			// Should be split into a run of 255 and a run of 45
			expect(encoded).toEqual(new Uint8Array([255, 7, 45, 7]));
			const decoded = rleDecodeUint8(encoded, 300);
			expect(decoded).toEqual(input);
		});
	});

	describe('Varint Encoding', () => {
		it('encodes and decodes single-byte values', () => {
			const values = [0, 1, 10, 127];
			for (const value of values) {
				const encoded = [];
				writeVarintUnsigned(value, encoded);
				expect(encoded.length).toBe(1);
				const [decoded, newIndex] = readVarintUnsigned(encoded, 0);
				expect(decoded).toBe(value);
				expect(newIndex).toBe(1);
			}
		});

		it('encodes and decodes multi-byte values', () => {
			const values = [128, 255, 300, 16383, 16384];
			for (const value of values) {
				const encoded = [];
				writeVarintUnsigned(value, encoded);
				expect(encoded.length).toBeGreaterThan(1);
				const [decoded, newIndex] = readVarintUnsigned(encoded, 0);
				expect(decoded).toBe(value);
				expect(newIndex).toBe(encoded.length);
			}
		});
	});

	it('concatUint8 correctly concatenates arrays', () => {
		const chunk1 = new Uint8Array([1, 2]);
		const chunk2 = new Uint8Array([]);
		const chunk3 = new Uint8Array([3, 4, 5]);
		const result = concatUint8([chunk1, chunk2, chunk3]);
		expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	});

	it('float64ArrayToBytes and bytesToFloat64Array perform a round trip correctly', () => {
		const input = new Float64Array([0, 1.5, -3.14159, Number.MAX_VALUE]);
		const bytes = float64ArrayToBytes(input);
		expect(bytes.length).toBe(input.length * 8);
		const output = bytesToFloat64Array(bytes, 0, input.length);
		expect(output).toEqual(input);
	});
});

describe('GlobalStringTable', () => {
	let table;

	beforeEach(() => {
		table = new GlobalStringTable();
	});

	it('assigns a new ID for a new string', () => {
		expect(table.getIdForString('hello')).toBe(0);
		expect(table.getIdForString('world')).toBe(1);
	});

	it('returns an existing ID for a known string', () => {
		const id1 = table.getIdForString('hello');
		const id2 = table.getIdForString('hello');
		expect(id1).toBe(0);
		expect(id2).toBe(0);
		expect(table.stringById.length).toBe(1);
	});

	it('retrieves the correct string by ID', () => {
		table.getIdForString('hello');
		table.getIdForString('world');
		expect(table.getStringById(0)).toBe('hello');
		expect(table.getStringById(1)).toBe('world');
	});

	it('tracks unpersisted changes', () => {
		expect(table.hasUnpersistedChanges).toBe(false);
		table.getIdForString('new string');
		expect(table.hasUnpersistedChanges).toBe(true);
	});

	it('loads from a list and resets state', () => {
		const list = ['a', 'b', 'c'];
		table.loadFromList(list);
		expect(table.stringById).toEqual(list);
		expect(table.idByString.get('b')).toBe(1);
		expect(table.hasUnpersistedChanges).toBe(false);
		expect(table.getIdForString('d')).toBe(3);
		expect(table.hasUnpersistedChanges).toBe(true);
	});
});

describe('LeastRecentlyUsedCache', () => {
	let cache;

	beforeEach(() => {
		// A small capacity to make testing eviction easy
		cache = new LeastRecentlyUsedCache(3);
	});

	it('sets and gets values', () => {
		cache.set('a', 1);
		expect(cache.get('a')).toBe(1);
		expect(cache.has('a')).toBe(true);
	});

	it('returns undefined for a missing key', () => {
		expect(cache.get('missing')).toBe(undefined);
		expect(cache.has('missing')).toBe(false);
	});

	it('evicts the least recently used item when capacity is exceeded', () => {
		cache.set('a', 1); // LRU
		cache.set('b', 2);
		cache.set('c', 3); // MRU
		cache.set('d', 4); // Add one more, 'a' should be evicted

		expect(cache.has('a')).toBe(false);
		expect(cache.has('b')).toBe(true);
		expect(cache.has('c')).toBe(true);
		expect(cache.has('d')).toBe(true);
	});

	it('marks an item as most recently used on get', () => {
		cache.set('a', 1); // LRU
		cache.set('b', 2);
		cache.set('c', 3); // MRU

		cache.get('a'); // 'a' is now MRU, 'b' is LRU

		cache.set('d', 4); // This should evict 'b'

		expect(cache.has('b')).toBe(false);
		expect(cache.has('a')).toBe(true);
	});

	it('updates the value for an existing key and marks it as MRU', () => {
		cache.set('a', 1);
		cache.set('b', 2);
		cache.set('c', 3);

		cache.set('a', 100); // Update 'a', making it MRU
		cache.set('d', 4); // This should evict 'b'

		expect(cache.get('a')).toBe(100);
		expect(cache.has('b')).toBe(false);
	});
});

// describe('ChunkCodec', () => {
// 	let stringTable;

// 	beforeEach(() => {
// 		stringTable = new GlobalStringTable();
// 		stringTable.loadFromList(['hello', 'world']);
// 	});
// });

// Helper to create a fake, in-memory IndexedDB for testing ChunkStore
function createFakeIndexedDB() {
	let databases = new Map(); // dbName -> { stores: Map<storeName, Map<key, value>> }

	const simulateRequest = (result) => {
		const request = {};
		setTimeout(() => {
			request.result = result;
			if (request.onsuccess) {
				request.onsuccess({ target: request });
			}
		}, 0);
		return request;
	};

	const objectStore = (storeData) => ({
		get(key) {
			return simulateRequest(storeData.get(key));
		},
		put(value, key) {
			storeData.set(key, value);
			return simulateRequest(key);
		},
		delete(key) {
			storeData.delete(key);
			return simulateRequest(undefined);
		},
	});

	const transaction = (db, storeNames, mode) => {
		const tx = {
			objectStore(name) {
				return objectStore(db.stores.get(name));
			},
		};
		setTimeout(() => {
			if (tx.oncomplete) tx.oncomplete();
		}, 0);
		return tx;
	};

	const db = (dbName) => {
		if (!databases.has(dbName)) {
			databases.set(dbName, { stores: new Map() });
		}
		const dbData = databases.get(dbName);
		return {
			transaction(storeNames, mode) {
				return transaction(dbData, storeNames, mode);
			},
			createObjectStore(name) {
				if (!dbData.stores.has(name)) {
					dbData.stores.set(name, new Map());
				}
			},
			get objectStoreNames() {
				return {
					contains: (name) => dbData.stores.has(name),
				};
			},
		};
	};

	return {
		open(dbName, version) {
			const request = {};
			const dbInstance = db(dbName);

			setTimeout(() => {
				const currentStores = databases.get(dbName)?.stores?.keys() ?? [];
				// A real onupgradeneeded would be more complex, but this is enough for ChunkStore
				if ([...currentStores].length === 0 && request.onupgradeneeded) {
					request.result = dbInstance;
					request.onupgradeneeded({ target: request });
				}

				request.result = dbInstance;
				if (request.onsuccess) {
					request.onsuccess({ target: request });
				}
			}, 0);

			return request;
		},
		// Helper to reset for clean tests
		_clear() {
			databases = new Map();
		},
	};
}

describe('ChunkStore', () => {
	let fakeIdb;
	let chunkStore;
	const dbName = 'test-db';

	beforeEach(() => {
		fakeIdb = createFakeIndexedDB();
		// We pass the fake factory to the ChunkStore
		chunkStore = new ChunkStore(dbName, fakeIdb);
	});

	it('puts and gets a chunk', async () => {
		const key = 'chunk_1';
		const data = new Uint8Array([1, 2, 3]);

		await chunkStore.putCompressedChunkBytes(key, data);
		const result = await chunkStore.getCompressedChunkBytes(key);

		expect(result).toEqual(data);
	});

	it('returns null for a non-existent chunk', async () => {
		const result = await chunkStore.getCompressedChunkBytes('non-existent');
		expect(result).toBe(null);
	});

	it('deletes a chunk', async () => {
		const key = 'chunk_to_delete';
		const data = new Uint8Array([4, 5, 6]);

		await chunkStore.putCompressedChunkBytes(key, data);
		let result = await chunkStore.getCompressedChunkBytes(key);
		expect(result).not.toBe(null); // Ensure it's there first

		await chunkStore.deleteChunk(key);
		result = await chunkStore.getCompressedChunkBytes(key);
		expect(result).toBe(null);
	});

	it('puts and gets the string table', async () => {
		const stringList = ['hello', 'world', 'test'];
		await chunkStore.putStringTableList(stringList);
		const result = await chunkStore.getStringTableList();
		expect(result).toEqual(stringList);
	});

	it('returns null for a non-existent string table', async () => {
		const result = await chunkStore.getStringTableList();
		expect(result).toBe(null);
	});
});

describe('Sheet (In-Memory)', () => {
	let sheet;

	beforeEach(() => {
		// We're not using a store, so all operations are in-memory.
		sheet = new Sheet();
	});

	it('initializes with zero rows', () => {
		expect(sheet.numRows).toBe(0);
	});

	it('adds rows correctly', () => {
		sheet.addRows(10);
		expect(sheet.numRows).toBe(10);
		sheet.addRows(5);
		expect(sheet.numRows).toBe(15);
	});

	it('sets and gets a string value', () => {
		sheet.addRows(1);
		sheet.setValue(0, 0, 'hello world');
		expect(sheet.getValue(0, 0)).toBe('hello world');
		expect(sheet.hasValue(0, 0)).toBe(true);
	});

	it('sets and gets a numeric value', () => {
		sheet.addRows(100);
		sheet.setValue(80, 5, 12345);
		expect(sheet.getValue(80, 5)).toBe(12345);
		expect(sheet.hasValue(80, 5)).toBe(true);
	});

	it('returns null for empty cells', () => {
		sheet.addRows(10);
		sheet.setValue(4, 4, 'test')
		expect(sheet._hotChunks.map.size).toBe(1);
		expect(sheet.getValue(5, 5)).toBe(null);
		expect(sheet.getValue(100, 100)).toBe(null);
		expect(sheet.hasValue(5, 5)).toBe(false);
	});

	it('returns null for out of bounds cells', () => {
		sheet.addRows(10);
		expect(sheet._hotChunks.map.size).toBe(0);
		expect(sheet.getValue(5, 5)).toBe(null);
		expect(sheet.getValue(100, 100)).toBe(null);
		expect(sheet.hasValue(5, 5)).toBe(false);
	});

	it('deletes a value', () => {
		sheet.addRows(1);
		sheet.setValue(0, 0, 'to be deleted');
		expect(sheet.getValue(0, 0)).toBe('to be deleted');

		sheet.deleteValue(0, 0);
		expect(sheet.getValue(0, 0)).toBe(null);
		expect(sheet.hasValue(0, 0)).toBe(false);
	});

	it('handles values in different chunks', () => {
		sheet.addRows(200);
		sheet.setValue(10, 10, 'chunk 1');
		sheet.setValue(100, 100, 'chunk 2');

		expect(sheet.getValue(10, 10)).toBe('chunk 1');
		expect(sheet.getValue(100, 100)).toBe('chunk 2');

		// Make sure hot cache contains 2 chunks now
		expect(sheet._hotChunks.map.size).toBe(2);
	});

	it('overwrites an existing value', () => {
		sheet.addRows(1);
		sheet.setValue(0, 0, 'initial');
		sheet.setValue(0, 0, 'overwritten');
		expect(sheet.getValue(0, 0)).toBe('overwritten');
	});
});
