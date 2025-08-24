/**
 * @file This service orchestrates the process of persisting and loading sheet data.
 * It coordinates between the domain's pure logic (like codecs) and the
 * infrastructure's storage mechanisms (like the IndexedDB repository).
 */

/**
 * @typedef {import('../../domain/codec/ChunkCodec').ChunkCodec} ChunkCodec
 * @typedef {import('../../infrastructure/repository/IndexedDBChunkRepository').IndexedDBChunkRepository} IndexedDBChunkRepository
 * @typedef {import('../../domain/strings/GlobalStringTable').GlobalStringTable} GlobalStringTable
 * @typedef {import('../../domain/chunk/ChunkTypes').GenericChunk} GenericChunk
 */

export class PersistenceService {
	/**
	 * @param {object} dependencies
	 * @param {IndexedDBChunkRepository} dependencies.chunkRepository - The repository for storing and retrieving raw chunk data.
	 * @param {ChunkCodec} dependencies.chunkCodec - The codec for encoding and decoding chunks.
	 * @param {GlobalStringTable} dependencies.globalStringTable - The global string table.
	 */
	constructor({ chunkRepository, chunkCodec, globalStringTable }) {
		/** @private */
		this._chunkRepository = chunkRepository;
		/** @private */
		this._chunkCodec = chunkCodec;
		/** @private */
		this._globalStringTable = globalStringTable;
	}

	/**
	 * Encodes a chunk and saves it to the repository.
	 * @param {number} chunkKey - The key of the chunk to persist.
	 * @param {GenericChunk} chunk - The chunk data to persist.
	 * @returns {Promise<void>}
	 */
	async persistChunk(chunkKey, chunk) {
		const compressedBytes = this._chunkCodec.encodeChunk(chunk, this._globalStringTable);
		await this._chunkRepository.putCompressedChunkBytes(chunkKey, compressedBytes);
		chunk.isDirty = false;
	}

	/**
	 * Persists the global string table to the repository if it has unpersisted changes.
	 * @returns {Promise<void>}
	 */
	async persistStringTable() {
		if (this._globalStringTable.hasUnpersistedChanges) {
			await this._chunkRepository.putStringTableList(this._globalStringTable.stringById);
			this._globalStringTable.hasUnpersistedChanges = false;
		}
	}

	/**
	 * Loads a set of chunks from the repository by their keys.
	 * @param {number[]} chunkKeys - The keys of the chunks to load.
	 * @returns {Promise<Map<number, GenericChunk>>} A map from chunk key to the decoded chunk.
	 */
	async loadChunks(chunkKeys) {
		const loadedChunks = new Map();
		const promises = chunkKeys.map(async (key) => {
			const bytes = await this._chunkRepository.getCompressedChunkBytes(key);
			if (bytes) {
				const decodedChunk = this._chunkCodec.decodeChunk(bytes, this._globalStringTable);
				loadedChunks.set(key, decodedChunk);
			}
		});
		await Promise.all(promises);
		return loadedChunks;
	}

	/**
	 * Loads the string table from the repository and populates the in-memory `GlobalStringTable`.
	 * @returns {Promise<void>}
	 */
	async loadStringTable() {
		const persistedStrings = await this._chunkRepository.getStringTableList();
		if (persistedStrings) {
			this._globalStringTable.loadFromList(persistedStrings);
		}
	}
}
