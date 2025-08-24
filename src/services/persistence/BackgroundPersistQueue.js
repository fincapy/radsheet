/**
 * @file This file contains the BackgroundPersistQueue class, which manages
 * asynchronous persistence of chunks with a configurable concurrency limit.
 * It ensures that the main thread remains responsive by offloading I/O-bound
 * tasks and processing them in the background.
 */

/**
 * @typedef {import('./PersistenceService').PersistenceService} PersistenceService
 * @typedef {import('../../domain/chunk/ChunkTypes').GenericChunk} GenericChunk
 */

export class BackgroundPersistQueue {
	/**
	 * @param {object} dependencies
	 * @param {PersistenceService} dependencies.persistenceService - The service responsible for the actual data persistence.
	 * @param {object} [options]
	 * @param {number} [options.concurrency=2] - The maximum number of persistence tasks to run in parallel.
	 */
	constructor({ persistenceService }, { concurrency = 2 } = {}) {
		/** @private */
		this._persistenceService = persistenceService;
		/** @private */
		this._persistConcurrency = concurrency;

		/**
		 * A map of chunk keys to chunk data that are queued for persistence.
		 * Storing the full chunk ensures that the most recent version is persisted.
		 * @private
		 * @type {Map<number, GenericChunk>}
		 */
		this._persistQueue = new Map();
		/** @private */
		this._processingPersistQueue = false;
		/** @private */
		this._persistInFlight = 0;
		/**
		 * A resolver function for a promise that resolves when the queue is fully drained.
		 * @private
		 * @type {(() => void) | null}
		 */
		this._resolveDrain = null;
	}

	/**
	 * Enqueues a chunk for persistence. If the chunk is already in the queue,
	 * its data is updated to the latest version.
	 * @param {number} chunkKey - The key of the chunk to persist.
	 * @param {GenericChunk} chunk - The chunk data.
	 */
	enqueueChunk(chunkKey, chunk) {
		this._persistQueue.set(chunkKey, chunk);
		this._processQueue().catch(console.error);
	}

	/**
	 * Returns a promise that resolves when all currently queued and in-flight
	 * persistence tasks are complete.
	 * @param {object} [options]
	 * @param {boolean} [options.includeStringTable=false] - Whether to also force a persistence of the string table.
	 * @returns {Promise<void>}
	 */
	drain({ includeStringTable = false } = {}) {
		const drainPromise = new Promise((resolve) => (this._resolveDrain = resolve));
		this._processQueue(includeStringTable).catch(console.error);
		return drainPromise;
	}

	/**
	 * The core processing loop for the persistence queue. It runs as long as
	 * there are items to process or in-flight operations.
	 * @private
	 * @param {boolean} [persistStrings=false] - A flag to force persistence of the string table.
	 */
	async _processQueue(persistStrings = false) {
		if (this._processingPersistQueue) return;
		this._processingPersistQueue = true;

		try {
			// Continue processing as long as there's work to do.
			while (this._persistQueue.size > 0 || this._persistInFlight > 0 || persistStrings) {
				const canLaunchMore = this._persistInFlight < this._persistConcurrency;

				if (canLaunchMore && this._persistQueue.size > 0) {
					const keysToProcess = Array.from(this._persistQueue.keys()).slice(
						0,
						this._persistConcurrency - this._persistInFlight
					);

					for (const key of keysToProcess) {
						const chunk = this._persistQueue.get(key);
						this._persistQueue.delete(key);
						this._persistInFlight++;

						// Launch the persistence task without awaiting it here, to allow for concurrency.
						this._persistenceService
							.persistChunk(key, chunk)
							.catch(console.error)
							.finally(() => {
								this._persistInFlight--;
								// Immediately try to process more from the queue.
								this._processQueue().catch(console.error);
							});
					}
				}

				if (persistStrings) {
					await this._persistenceService.persistStringTable();
					persistStrings = false; // Ensure it only runs once per drain call.
				}

				// If we can't launch more tasks, or the queue is empty, yield to the event loop.
				// This prevents a busy-wait loop and keeps the main thread responsive.
				await new Promise((r) => setTimeout(r, 0));
			}
		} finally {
			this._processingPersistQueue = false;
			if (this._resolveDrain) {
				this._resolveDrain();
				this._resolveDrain = null;
			}
		}
	}
}
