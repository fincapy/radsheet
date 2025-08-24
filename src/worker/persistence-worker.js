/**
 * @file This web worker handles the CPU-intensive and I/O-bound tasks of
 * chunk serialization and persistence to IndexedDB. Offloading these tasks
 * from the main thread ensures the UI remains responsive.
 */

import { ChunkCodec } from '../domain/codec/ChunkCodec.js';
import { IndexedDBChunkRepository } from './repository/IndexedDBChunkRepository.js';
import { MessageType } from './worker/protocol.js';

/**
 * A minimal implementation of the GlobalStringTable used by the ChunkCodec
 * inside the worker. It's populated on-the-fly from the string list sent
 * with each message.
 * @class
 */
class WorkerGlobalStringTable {
	constructor(stringList = []) {
		this.stringById = stringList;
		this.idByString = new Map(stringList.map((s, i) => [s, i]));
	}
	getIdForString(str) {
		return this.idByString.get(str);
	}
	getStringById(id) {
		return this.stringById[id];
	}
}

/**
 * The repository instance used by this worker. It's initialized once the
 * worker receives the 'init' message.
 * @type {IndexedDBChunkRepository | null}
 */
let chunkRepository = null;

/**
 * Reconstructs a chunk object from its serializable snapshot.
 * The reconstructed chunk is in a format that the ChunkCodec can encode.
 * @param {import('../domain/chunk/ChunkSnapshot').ChunkSnapshot} snapshot
 * @returns {import('../domain/chunk/ChunkTypes').GenericChunk}
 */
function chunkFromSnapshot(snapshot) {
	if (snapshot.kind === 'dense') {
		return {
			kind: 'dense',
			nonEmptyCellCount: snapshot.nonEmptyCellCount,
			isDirty: true,
			tagByLocalIndex: snapshot.tagByLocalIndex,
			numberByLocalIndex: snapshot.numberByLocalIndex,
			stringIdByLocalIndex: snapshot.stringIdByLocalIndex
		};
	} else {
		return {
			kind: 'sparse',
			nonEmptyCellCount: snapshot.nonEmptyCellCount,
			isDirty: true,
			localIndexToValue: new Map(snapshot.entries)
		};
	}
}

/**
 * Main message handler for the worker.
 * @param {MessageEvent<import('./worker/protocol').MainThreadMessage>} ev The message event.
 */
self.onmessage = async (ev) => {
	const msg = ev.data;
	try {
		switch (msg.type) {
			case MessageType.Init:
				chunkRepository = new IndexedDBChunkRepository({
					databaseName: msg.databaseName,
					chunkStoreName: msg.chunkStoreName,
					metaStoreName: msg.metaStoreName
				});
				// The act of creating the repository doesn't open the DB,
				// but the first operation on it will. We can consider this "inited".
				self.postMessage({ type: MessageType.Inited });
				break;

			case MessageType.PersistChunk: {
				if (!chunkRepository) throw new Error('Worker not initialized.');

				const { key, snapshot, stringTable } = msg;
				const workerStringTable = new WorkerGlobalStringTable(stringTable || []);
				const chunk = chunkFromSnapshot(snapshot);
				const encodedBytes = ChunkCodec.encodeChunk(chunk, workerStringTable);

				await chunkRepository.putCompressedChunkBytes(key, encodedBytes);
				self.postMessage({ type: MessageType.PersistDone, key });
				break;
			}

			case MessageType.PersistStringTable: {
				if (!chunkRepository) throw new Error('Worker not initialized.');

				await chunkRepository.putStringTableList(msg.list);
				self.postMessage({ type: MessageType.StringsDone });
				break;
			}
		}
	} catch (err) {
		const errorMsg = {
			type: MessageType.Error,
			error: err instanceof Error ? err.message : String(err)
		};
		if (msg.type === MessageType.PersistChunk) {
			errorMsg.key = msg.key;
		}
		self.postMessage(errorMsg);
	}
};
