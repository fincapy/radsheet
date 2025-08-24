/**
 * @file This file provides a client-side wrapper for the persistence web worker.
 * It abstracts the postMessage communication into a clean, async/await-based API,
 * making it easy for the main thread to offload persistence tasks.
 */

import { MessageType } from './protocol.js';

/**
 * Creates and initializes a client for the chunk persistence worker.
 *
 * @param {object} [options]
 * @param {string} [options.databaseName='SheetDB']
 * @param {string} [options.chunkStoreName='chunks']
 * @param {string} [options.metaStoreName='meta']
 * @returns {{persistChunk: Function, persistStringTable: Function} | null} A worker client object or null if in an environment without `window`.
 */
export function createChunkPersistenceWorker(options) {
	if (typeof Worker === 'undefined') return null;

	const worker = new Worker(new URL('./persistence-worker.js', import.meta.url), {
		type: 'module'
	});

	const {
		databaseName = 'SheetDB',
		chunkStoreName = 'chunks',
		metaStoreName = 'meta'
	} = options ?? {};

	/** A map of pending chunk persistence promises. */
	const pendingChunks = new Map();
	/** A promise for pending string table persistence. */
	let pendingStrings = null;

	const initPromise = new Promise((resolve, reject) => {
		/**
		 * Handles all messages from the worker.
		 * @param {MessageEvent<import('./protocol').WorkerMessage>} ev
		 */
		const messageHandler = (ev) => {
			const msg = ev.data;
			if (!msg) return;

			switch (msg.type) {
				case MessageType.Inited:
					resolve();
					break;
				case MessageType.PersistDone: {
					const promise = pendingChunks.get(msg.key);
					if (promise) {
						promise.resolve();
						pendingChunks.delete(msg.key);
					}
					break;
				}
				case MessageType.StringsDone:
					if (pendingStrings) {
						pendingStrings.resolve();
						pendingStrings = null;
					}
					break;
				case MessageType.Error: {
					const promise = msg.key ? pendingChunks.get(msg.key) : pendingStrings;
					if (promise) {
						promise.reject(new Error(msg.error));
						if (msg.key) {
							pendingChunks.delete(msg.key);
						} else {
							pendingStrings = null;
						}
					} else {
						// This could be an init error
						reject(new Error(msg.error));
					}
					break;
				}
			}
		};

		worker.addEventListener('message', messageHandler);
		worker.onerror = (e) => reject(e);
	});

	worker.postMessage({
		type: MessageType.Init,
		databaseName,
		chunkStoreName,
		metaStoreName
	});

	/**
	 * @param {number} key
	 * @param {import('../../domain/chunk/ChunkSnapshot').ChunkSnapshot} snapshot
	 * @param {string[] | null} stringTableListOrNull
	 * @returns {Promise<void>}
	 */
	async function persistChunk(key, snapshot, stringTableListOrNull) {
		await initPromise;
		return new Promise((resolve, reject) => {
			pendingChunks.set(key, { resolve, reject });
			worker.postMessage({
				type: MessageType.PersistChunk,
				key,
				snapshot,
				stringTable: stringTableListOrNull
			});
		});
	}

	/**
	 * @param {string[]} list
	 * @returns {Promise<void>}
	 */
	async function persistStringTable(list) {
		await initPromise;
		return new Promise((resolve, reject) => {
			pendingStrings = { resolve, reject };
			worker.postMessage({ type: MessageType.PersistStringTable, list });
		});
	}

	return { persistChunk, persistStringTable };
}
