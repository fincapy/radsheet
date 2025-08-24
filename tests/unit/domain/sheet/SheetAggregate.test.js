import { describe, it, expect, beforeEach } from 'vitest';
import { SheetAggregate as Sheet } from '../../../../src/domain/sheet/SheetAggregate.js';
import { IndexedDBChunkRepository } from '../../../../src/infrastructure/repository/IndexedDBChunkRepository.js';
import { CELLS_PER_CHUNK } from '../../../../src/domain/constants/ChunkSizing.js';
import {
	PROMOTE_TO_DENSE_FILL_RATIO,
	DEMOTE_TO_SPARSE_FILL_RATIO
} from '../../../../src/domain/constants/PromotionPolicy.js';

// Using the same fake IndexedDB from the repository test
function createFakeIndexedDB() {
	let databases = new Map();
	const simulateRequest = (result) => {
		const request = {};
		setTimeout(() => {
			request.result = result;
			if (request.onsuccess) request.onsuccess({ target: request });
		}, 0);
		return request;
	};
	const objectStore = (storeData) => ({
		get: (key) => simulateRequest(storeData.get(key)),
		put: (value, key) => {
			storeData.set(key, value);
			return simulateRequest(key);
		},
		delete: (key) => {
			storeData.delete(key);
			return simulateRequest(undefined);
		}
	});
	const transaction = (db, storeNames, mode) => {
		const tx = { objectStore: (name) => objectStore(db.stores.get(name)) };
		setTimeout(() => {
			if (tx.oncomplete) tx.oncomplete();
		}, 0);
		return tx;
	};
	const db = (dbName) => {
		if (!databases.has(dbName)) databases.set(dbName, { stores: new Map() });
		const dbData = databases.get(dbName);
		return {
			transaction: (storeNames, mode) => transaction(dbData, storeNames, mode),
			createObjectStore: (name) => {
				if (!dbData.stores.has(name)) dbData.stores.set(name, new Map());
			},
			get objectStoreNames() {
				return { contains: (name) => dbData.stores.has(name) };
			}
		};
	};
	return {
		open: (dbName, version) => {
			const request = {};
			const dbInstance = db(dbName);
			setTimeout(() => {
				if ((databases.get(dbName)?.stores?.size ?? 0) === 0 && request.onupgradeneeded) {
					request.result = dbInstance;
					request.onupgradeneeded({ target: request });
				}
				request.result = dbInstance;
				if (request.onsuccess) request.onsuccess({ target: request });
			}, 10); // Added a small delay to better simulate async behavior
			return request;
		}
	};
}

describe('SheetAggregate (Comprehensive)', () => {
	let sheet;

	beforeEach(() => {
		sheet = new Sheet();
	});

	describe('Core Get/Set/Has/Delete', () => {
		it('sets and gets a numeric value', () => {
			sheet.setValue(10, 20, 123.45);
			expect(sheet.getValue(10, 20)).toBe(123.45);
			expect(sheet.hasValue(10, 20)).toBe(true);
		});

		it('sets and gets a string value', () => {
			sheet.setValue(0, 0, 'hello world');
			expect(sheet.getValue(0, 0)).toBe('hello world');
			expect(sheet.hasValue(0, 0)).toBe(true);
		});

		it('deletes a value', () => {
			sheet.setValue(5, 5, 'to be deleted');
			expect(sheet.hasValue(5, 5)).toBe(true);
			sheet.deleteValue(5, 5);
			expect(sheet.getValue(5, 5)).toBe(null);
			expect(sheet.hasValue(5, 5)).toBe(false);
		});

		it('returns null for empty cells', () => {
			expect(sheet.getValue(100, 100)).toBe(null);
			expect(sheet.hasValue(100, 100)).toBe(false);
		});
	});

	describe('Boolean Values', () => {
		it('sets and gets boolean values', () => {
			sheet.setValue(0, 0, true);
			sheet.setValue(0, 1, false);

			expect(sheet.getValue(0, 0)).toBe(true);
			expect(sheet.getValue(0, 1)).toBe(false);
			expect(sheet.hasValue(0, 0)).toBe(true);
			expect(sheet.hasValue(0, 1)).toBe(true);
		});

		it('handles boolean values in dense chunks', () => {
			const cellsToFill = Math.ceil(CELLS_PER_CHUNK * PROMOTE_TO_DENSE_FILL_RATIO);
			for (let i = 0; i < cellsToFill; i++) {
				sheet.setValue(0, i, `string${i}`);
			}
			sheet.setValue(0, cellsToFill, true);
			expect(sheet.getValue(0, cellsToFill)).toBe(true);
		});
	});

	describe('Chunk Promotion and Demotion', () => {
		it('promotes sparse chunk to dense when fill ratio is reached', () => {
			const cellsToFill = Math.ceil(CELLS_PER_CHUNK * PROMOTE_TO_DENSE_FILL_RATIO);
			for (let i = 0; i < cellsToFill; i++) {
				const row = Math.floor(i / 64);
				const col = i % 64;
				sheet.setValue(row, col, `string${i}`);
			}
			const chunk = sheet._getHotChunkSynchronously(0, 0, false);
			expect(chunk.kind).toBe('dense');
		});

		it('demotes dense chunk to sparse when fill ratio drops', () => {
			const cellsToFillToPromote = Math.ceil(CELLS_PER_CHUNK * PROMOTE_TO_DENSE_FILL_RATIO);
			for (let i = 0; i < cellsToFillToPromote; i++) {
				sheet.setValue(Math.floor(i / 64), i % 64, `string${i}`);
			}
			let chunk = sheet._getHotChunkSynchronously(0, 0, false);
			expect(chunk.kind).toBe('dense');

			const cellsToDelete =
				chunk.nonEmptyCellCount - Math.floor(CELLS_PER_CHUNK * DEMOTE_TO_SPARSE_FILL_RATIO);
			for (let i = 0; i < cellsToDelete; i++) {
				sheet.deleteValue(Math.floor(i / 64), i % 64);
			}

			chunk = sheet._getHotChunkSynchronously(0, 0, false);
			expect(chunk.kind).toBe('sparse');
		});
	});

	describe('setBlock Method', () => {
		it('sets a 2D block of values', () => {
			const values2D = [
				['A1', 'B1', 'C1'],
				['A2', 'B2', 'C2']
			];
			const writeCount = sheet.setBlock(1, 2, values2D);
			expect(writeCount).toBe(6);
			expect(sheet.getValue(1, 2)).toBe('A1');
			expect(sheet.getValue(2, 4)).toBe('C2');
		});

		it('handles empty values in setBlock', () => {
			sheet.setValue(1, 3, 'should be deleted');
			const values2D = [['A1', '', null, undefined]];
			const writeCount = sheet.setBlock(1, 2, values2D);
			expect(writeCount).toBe(1);
			expect(sheet.getValue(1, 2)).toBe('A1');
			expect(sheet.hasValue(1, 3)).toBe(false);
			expect(sheet.hasValue(1, 4)).toBe(false);
		});
	});

	describe('Iterators', () => {
		beforeEach(() => {
			sheet.setValue(5, 5, 'center');
			sheet.setValue(5, 6, 'right');
			sheet.setValue(6, 5, 'bottom');
			sheet.setValue(6, 6, 'corner');
			sheet.setValue(4, 4, 'outside');
			sheet.setValue(100, 100, 'far away');
		});

		it('entries() iterates all non-empty cells in hot cache', () => {
			const entries = Array.from(sheet.entries());
			expect(entries).toHaveLength(6);
			expect(entries).toContainEqual({ row: 5, col: 5, value: 'center' });
			expect(entries).toContainEqual({ row: 100, col: 100, value: 'far away' });
		});

		it('entriesInRect() iterates cells in a rectangular area', () => {
			const entries = Array.from(sheet.entriesInRect(5, 5, 6, 6));
			expect(entries).toHaveLength(4);
			expect(entries).not.toContainEqual({ row: 4, col: 4, value: 'outside' });
		});
	});

	describe('Sheet with Store Integration', () => {
		let fakeIdb;
		let chunkRepository;

		beforeEach(async () => {
			fakeIdb = createFakeIndexedDB();
			chunkRepository = new IndexedDBChunkRepository({ databaseName: 'test-db' }, fakeIdb);
			await sheet.useStore(chunkRepository);
		});

		it('attaches store and loads persisted strings', async () => {
			await chunkRepository.putStringTableList(['persisted1', 'persisted2']);
			const newSheet = new Sheet();
			await newSheet.useStore(chunkRepository);
			expect(newSheet.globalStringTable.stringById).toContain('persisted1');
		});

		it('loads range from store', async () => {
			const sheet = new Sheet();
			const fakeIdb = createFakeIndexedDB();
			const store = new IndexedDBChunkRepository(
				{
					databaseName: 'TestDB'
				},
				fakeIdb
			);
			await sheet.useStore(store);

			const stringTable = sheet.getStringTable();
			const codec = sheet.getCodec();

			// Create and persist a chunk
			const chunk = sheet._createSparseChunk();
			chunk.cells.set(10 * 64 + 10, {
				kind: 'string',
				value: stringTable.getOrAdd('test2')
			});
			const encoded = codec.encode(chunk, stringTable);
			await store.persistChunk('0,0', encoded);

			// Now try to load it
			expect(sheet.hasValue(10, 10)).toBe(false); // Not in hot cache yet
			await sheet.loadRange(0, 0, 20, 20);
			// Wait for the next tick of the event loop
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(sheet.getValue(10, 10)).toBe('test2');
		});

		it('flushes dirty chunks to store', async () => {
			sheet.setValue(0, 0, 'dirty value');
			await sheet.flush();

			const persistedBytes = await chunkRepository.getCompressedChunkBytes(
				sheet._lastAccessedChunkKey
			);
			expect(persistedBytes).not.toBe(null);
		});
	});
});
