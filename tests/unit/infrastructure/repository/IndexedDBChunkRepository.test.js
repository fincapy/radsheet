import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDBChunkRepository } from '../../../../src/infrastructure/repository/IndexedDBChunkRepository.js';

// Helper to create a fake, in-memory IndexedDB for testing
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
		}
	});

	const transaction = (db, storeNames, mode) => {
		const tx = {
			objectStore(name) {
				return objectStore(db.stores.get(name));
			}
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
					contains: (name) => dbData.stores.has(name)
				};
			}
		};
	};

	return {
		open(dbName, version) {
			const request = {};
			const dbInstance = db(dbName);

			setTimeout(() => {
				const currentStores = databases.get(dbName)?.stores?.keys() ?? [];
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
		_clear() {
			databases = new Map();
		}
	};
}

describe('IndexedDBChunkRepository', () => {
	let fakeIdb;
	let chunkRepository;

	beforeEach(() => {
		fakeIdb = createFakeIndexedDB();
		chunkRepository = new IndexedDBChunkRepository({ databaseName: 'test-db' }, fakeIdb);
	});

	it('puts and gets a chunk', async () => {
		const key = 123;
		const data = new Uint8Array([1, 2, 3]);

		await chunkRepository.putCompressedChunkBytes(key, data);
		const result = await chunkRepository.getCompressedChunkBytes(key);

		expect(result).toEqual(data);
	});

	it('returns null for a non-existent chunk', async () => {
		const result = await chunkRepository.getCompressedChunkBytes(404);
		expect(result).toBe(null);
	});

	it('deletes a chunk', async () => {
		const key = 999;
		const data = new Uint8Array([4, 5, 6]);

		await chunkRepository.putCompressedChunkBytes(key, data);
		let result = await chunkRepository.getCompressedChunkBytes(key);
		expect(result).not.toBe(null);

		await chunkRepository.deleteChunk(key);
		result = await chunkRepository.getCompressedChunkBytes(key);
		expect(result).toBe(null);
	});

	it('puts and gets the string table', async () => {
		const stringList = ['hello', 'world', 'test'];
		await chunkRepository.putStringTableList(stringList);
		const result = await chunkRepository.getStringTableList();
		expect(result).toEqual(stringList);
	});

	it('returns null for a non-existent string table', async () => {
		const result = await chunkRepository.getStringTableList();
		expect(result).toBe(null);
	});
});
