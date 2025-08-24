/**
 * @file Implements a repository for storing and retrieving spreadsheet chunks
 * and metadata from IndexedDB. This acts as the persistence layer for the sheet.
 */

/**
 * Manages all interactions with IndexedDB for storing, retrieving, and deleting
 * chunk data and the global string table.
 */
export class IndexedDBChunkRepository {
	/**
	 * @param {object} [options] Configuration for the repository.
	 * @param {string} [options.databaseName='SheetDB'] The name of the IndexedDB database.
	 * @param {string} [options.chunkStoreName='chunks'] The name of the object store for chunks.
	 * @param {string} [options.metaStoreName='meta'] The name of the object store for metadata.
	 * @param {IDBFactory} [idbFactory=indexedDB] The IndexedDB factory to use. Defaults to the global `indexedDB`.
	 */
	constructor(
		{ databaseName = 'SheetDB', chunkStoreName = 'chunks', metaStoreName = 'meta' } = {},
		idbFactory
	) {
		this.databaseName = databaseName;
		this.chunkStoreName = chunkStoreName;
		this.metaStoreName = metaStoreName;
		/** @private */
		this.database = null;
		/** @private */
		this._idbFactory = idbFactory || globalThis.indexedDB;
	}

	/**
	 * Opens the IndexedDB connection if it's not already open.
	 * This is called internally by other methods.
	 * @private
	 * @returns {Promise<void>}
	 */
	async _openIfNeeded() {
		if (this.database) return;
		this.database = await new Promise((resolve, reject) => {
			const request = this._idbFactory.open(this.databaseName, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(this.chunkStoreName)) {
					db.createObjectStore(this.chunkStoreName);
				}
				if (!db.objectStoreNames.contains(this.metaStoreName)) {
					db.createObjectStore(this.metaStoreName);
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	/**
	 * Retrieves the compressed binary data for a single chunk.
	 * @param {number} chunkKey The key of the chunk to retrieve.
	 * @returns {Promise<Uint8Array | null>} The compressed chunk data, or null if not found.
	 */
	async getCompressedChunkBytes(chunkKey) {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.chunkStoreName, 'readonly');
			const store = tx.objectStore(this.chunkStoreName);
			const req = store.get(chunkKey);
			req.onsuccess = () => {
				const val = req.result;
				if (!val) return resolve(null);
				// Handle different binary types that may be stored.
				if (val instanceof Uint8Array) return resolve(val);
				if (val instanceof ArrayBuffer) return resolve(new Uint8Array(val));
				resolve(new Uint8Array(val)); // best-effort for other array-like types
			};
			req.onerror = () => reject(req.error);
		});
	}

	/**
	 * Stores the compressed binary data for a single chunk.
	 * @param {number} chunkKey The key of the chunk to store.
	 * @param {Uint8Array} bytes The compressed chunk data.
	 * @returns {Promise<void>}
	 */
	async putCompressedChunkBytes(chunkKey, bytes) {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.chunkStoreName, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.objectStore(this.chunkStoreName).put(bytes, chunkKey);
		});
	}

	/**
	 * Deletes a chunk from the store.
	 * @param {number} chunkKey The key of the chunk to delete.
	 * @returns {Promise<void>}
	 */
	async deleteChunk(chunkKey) {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.chunkStoreName, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.objectStore(this.chunkStoreName).delete(chunkKey);
		});
	}

	/**
	 * Retrieves the global string table as a list of strings.
	 * @returns {Promise<string[] | null>} The list of strings, or null if not found.
	 */
	async getStringTableList() {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.metaStoreName, 'readonly');
			const req = tx.objectStore(this.metaStoreName).get('strings');
			req.onsuccess = () => resolve(req.result || null);
			req.onerror = () => reject(req.error);
		});
	}

	/**
	 * Stores the global string table.
	 * @param {string[]} list The list of strings to store.
	 * @returns {Promise<void>}
	 */
	async putStringTableList(list) {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.metaStoreName, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.objectStore(this.metaStoreName).put(Array.from(list), 'strings');
		});
	}
}
