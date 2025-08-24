/**
 * @file Defines the communication protocol for messages passed between the main
 * thread and the persistence web worker. This ensures a consistent and explicit
 * contract for their interactions.
 */

/**
 * An enumeration of the message types used in the worker protocol.
 * Using constants helps prevent typos and makes the code more self-documenting.
 * @enum {string}
 */
export const MessageType = {
	// Main thread to worker
	Init: 'init',
	PersistChunk: 'persistChunk',
	PersistStringTable: 'persistStringTable',

	// Worker to main thread
	Inited: 'inited',
	PersistDone: 'persistDone',
	StringsDone: 'stringsDone',
	Error: 'error'
};

/**
 * @typedef {import('../../domain/chunk/ChunkSnapshot').ChunkSnapshot} ChunkSnapshot
 */

/**
 * @typedef {object} InitMessage
 * @property {MessageType.Init} type
 * @property {string} databaseName
 * @property {string} chunkStoreName
 * @property {string} metaStoreName
 */

/**
 * @typedef {object} PersistChunkMessage
 * @property {MessageType.PersistChunk} type
 * @property {number} key The key of the chunk to persist.
 * @property {ChunkSnapshot} snapshot The serializable snapshot of the chunk's data.
 * @property {string[] | null} stringTable The global string table, sent if it has changed.
 */

/**
 * @typedef {object} PersistStringTableMessage
 * @property {MessageType.PersistStringTable} type
 * @property {string[]} list The complete list of strings in the global table.
 */

/**
 * @typedef {object} InitedMessage
 * @property {MessageType.Inited} type
 */

/**
 * @typedef {object} PersistDoneMessage
 * @property {MessageType.PersistDone} type
 * @property {number} key The key of the chunk that was successfully persisted.
 */

/**
 * @typedef {object} StringsDoneMessage
 * @property {MessageType.StringsDone} type
 */

/**
 * @typedef {object} ErrorMessage
 * @property {MessageType.Error} type
 * @property {string} error The error message.
 * @property {number} [key] The key of the chunk that failed to persist, if applicable.
 */

/**
 * @typedef {InitMessage | PersistChunkMessage | PersistStringTableMessage} MainThreadMessage
 * A union type for all possible messages sent from the main thread to the worker.
 */

/**
 * @typedef {InitedMessage | PersistDoneMessage | StringsDoneMessage | ErrorMessage} WorkerMessage
 * A union type for all possible messages sent from the worker to the main thread.
 */
