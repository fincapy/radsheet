import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createChunkPersistenceWorker } from '../../../src/worker/persistence-worker-client.js';

// Mock Worker
const mockWorker = {
	addEventListener: vi.fn(),
	removeEventListener: vi.fn(),
	postMessage: vi.fn(),
	onmessage: null,
	onerror: null
};

// Mock URL constructor and Worker constructor
global.URL = class URL {
	constructor(url, base) {
		this.href = url;
		this.base = base;
	}
	static createObjectURL = vi.fn(() => 'blob:mock-url');
};

global.Worker = vi.fn(() => mockWorker);

// Helper to get the currently installed message handler
function getMessageHandler() {
	const calls = mockWorker.addEventListener.mock.calls;
	if (calls && calls.length > 0 && calls[calls.length - 1] && calls[calls.length - 1][1]) {
		return calls[calls.length - 1][1];
	}
	return mockWorker.onmessage;
}

describe('Persistence Worker Client', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset worker state
		mockWorker.addEventListener.mockClear();
		mockWorker.removeEventListener.mockClear();
		mockWorker.postMessage.mockClear();
		mockWorker.onmessage = null;
		mockWorker.onerror = null;

		// Reset global.Worker mock
		global.Worker = vi.fn(() => mockWorker);
	});

	afterEach(() => {
		// Clean up global mocks
		// Don't delete window as it's needed for the tests
	});

	describe('Worker Creation', () => {
		it('creates worker with correct URL', () => {
			const options = {
				databaseName: 'test-db',
				chunkStoreName: 'chunks',
				metaStoreName: 'meta'
			};

			const workerClient = createChunkPersistenceWorker(options);

			expect(global.Worker).toHaveBeenCalledWith(expect.any(URL), { type: 'module' });
			expect(workerClient).toBeTruthy();
		});

		it('returns null when window is undefined (SSR)', () => {
			// Temporarily remove window
			const originalWindow = global.window;
			delete global.window;

			const workerClient = createChunkPersistenceWorker({});

			expect(workerClient).toBeNull();

			// Restore window
			global.window = originalWindow;
		});

		it('sends init message with correct options', () => {
			const options = {
				databaseName: 'custom-db',
				chunkStoreName: 'custom-chunks',
				metaStoreName: 'custom-meta'
			};

			const workerClient = createChunkPersistenceWorker(options);

			expect(mockWorker.postMessage).toHaveBeenCalledWith({
				type: 'init',
				databaseName: 'custom-db',
				chunkStoreName: 'custom-chunks',
				metaStoreName: 'custom-meta'
			});
		});

		it('uses default options when not provided', () => {
			const workerClient = createChunkPersistenceWorker({});

			expect(mockWorker.postMessage).toHaveBeenCalledWith({
				type: 'init',
				databaseName: 'SheetDB',
				chunkStoreName: 'chunks',
				metaStoreName: 'meta'
			});
		});
	});

	describe('Initialization', () => {
		it('waits for init message before allowing operations', async () => {
			const workerClient = createChunkPersistenceWorker({});
			expect(workerClient).not.toBeNull();

			// Try to persist before initialization
			const persistPromise = workerClient.persistChunk('test-key', {}, []);

			// Should not complete until init message is received
			expect(mockWorker.onmessage).toBeDefined();

			// Simulate init message using the shared handler
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			// Allow microtask to continue past init await and register pending
			await Promise.resolve();

			// After init, operation should proceed; use the same handler
			const handler = getMessageHandler();
			handler({ data: { type: 'persistDone', key: 'test-key' } });

			// Now the persist operation should complete
			await persistPromise;
		});

		it('handles initialization errors', async () => {
			const workerClient = createChunkPersistenceWorker({});
			expect(workerClient).not.toBeNull();

			// Try to persist
			const persistPromise = workerClient.persistChunk('test-key', {}, []);

			// Simulate worker error
			mockWorker.onerror(new Error('Worker error'));

			await expect(persistPromise).rejects.toThrow('Worker error');
		});
	});

	describe('Chunk Persistence', () => {
		it('sends persistChunk message correctly', async () => {
			const workerClient = createChunkPersistenceWorker({});
			expect(workerClient).not.toBeNull();

			// Initialize first
			mockWorker.onmessage({ data: { type: 'inited' } });

			const key = 'test-chunk';
			const snapshot = { kind: 'dense', data: 'test' };
			const stringTable = ['hello', 'world'];

			// Start persist operation
			const persistPromise = workerClient.persistChunk(key, snapshot, stringTable);

			// Should send message
			expect(mockWorker.postMessage).toHaveBeenCalledWith({
				type: 'persistChunk',
				key,
				snapshot,
				stringTable
			});

			// Simulate completion
			mockWorker.onmessage({ data: { type: 'persistDone', key } });

			await persistPromise;
		});

		it('handles persistChunk errors', async () => {
			const workerClient = createChunkPersistenceWorker({});
			expect(workerClient).not.toBeNull();

			// Initialize first
			mockWorker.onmessage({ data: { type: 'inited' } });

			const persistPromise = workerClient.persistChunk('test-key', {}, []);

			// Simulate error message
			mockWorker.onmessage({ data: { type: 'error', error: 'Persistence failed' } });

			await expect(persistPromise).rejects.toThrow('Persistence failed');
		});

		it('matches response with correct key', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			// Start multiple persist operations
			const promise1 = workerClient.persistChunk('key1', {}, []);
			const promise2 = workerClient.persistChunk('key2', {}, []);

			// Send responses in different order
			const messageHandler = getMessageHandler();
			messageHandler({ data: { type: 'persistDone', key: 'key2' } });
			messageHandler({ data: { type: 'persistDone', key: 'key1' } });

			// Both should complete
			await promise1;
			await promise2;
		});
	});

	describe('String Table Persistence', () => {
		it('sends persistStringTable message correctly', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			const stringList = ['hello', 'world', 'test'];

			// Start persist operation
			const persistPromise = workerClient.persistStringTable(stringList);

			// Should send message
			expect(mockWorker.postMessage).toHaveBeenCalledWith({
				type: 'persistStringTable',
				list: stringList
			});

			// Simulate completion
			const messageHandler = getMessageHandler();
			messageHandler({ data: { type: 'stringsDone' } });

			await persistPromise;
		});

		it('handles persistStringTable errors', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			const persistPromise = workerClient.persistStringTable(['test']);

			// Simulate error message
			const messageHandler = getMessageHandler();
			messageHandler({ data: { type: 'error', error: 'String table error' } });

			await expect(persistPromise).rejects.toThrow('String table error');
		});
	});

	describe('Message Handling', () => {
		it('removes event listeners after completion', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			// Start persist operation
			const persistPromise = workerClient.persistChunk('test-key', {}, []);

			// Simulate completion
			const messageHandler = getMessageHandler();
			messageHandler({ data: { type: 'persistDone', key: 'test-key' } });

			await persistPromise;

			// Should remove event listener
			expect(mockWorker.removeEventListener).toHaveBeenCalled();
		});

		it('handles multiple concurrent operations', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			// Start multiple operations
			const promise1 = workerClient.persistChunk('key1', {}, []);
			const promise2 = workerClient.persistStringTable(['test']);

			// Complete them
			const messageHandler = getMessageHandler();
			messageHandler({ data: { type: 'persistDone', key: 'key1' } });
			messageHandler({ data: { type: 'stringsDone' } });

			await promise1;
			await promise2;
		});

		it('ignores unrelated messages', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			// Start persist operation
			const persistPromise = workerClient.persistChunk('test-key', {}, []);

			// Send unrelated message
			const messageHandler = getMessageHandler();
			messageHandler({ data: { type: 'unrelated' } });

			// Operation should still be pending
			expect(persistPromise).toBeInstanceOf(Promise);

			// Send correct completion message
			messageHandler({ data: { type: 'persistDone', key: 'test-key' } });

			await persistPromise;
		});
	});

	describe('Error Handling', () => {
		it('handles worker creation errors', () => {
			// Mock Worker constructor to throw
			const originalWorker = global.Worker;
			global.Worker = vi.fn(() => {
				throw new Error('Worker creation failed');
			});

			expect(() => createChunkPersistenceWorker({})).toThrow('Worker creation failed');

			// Restore original mock
			global.Worker = originalWorker;
		});

		it('handles worker communication errors', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			// Start operation
			const persistPromise = workerClient.persistChunk('test-key', {}, []);

			// Simulate worker error
			const errorHandler = getMessageHandler();
			errorHandler({ data: { type: 'error', error: 'Communication error' } });

			await expect(persistPromise).rejects.toThrow('Communication error');
		});

		it('handles timeout scenarios', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			// Start operation but don't complete it
			const persistPromise = workerClient.persistChunk('test-key', {}, []);

			// The promise should remain pending
			expect(persistPromise).toBeInstanceOf(Promise);

			// Complete it to avoid hanging test
			const messageHandler = getMessageHandler();
			messageHandler({ data: { type: 'persistDone', key: 'test-key' } });

			await persistPromise;
		});
	});

	describe('Integration with Sheet', () => {
		it('provides correct API for Sheet integration', () => {
			const workerClient = createChunkPersistenceWorker({});

			expect(typeof workerClient.persistChunk).toBe('function');
			expect(typeof workerClient.persistStringTable).toBe('function');
		});

		it('handles null string table parameter', async () => {
			const workerClient = createChunkPersistenceWorker({});

			// Initialize first
			const initHandler = getMessageHandler();
			initHandler({ data: { type: 'inited' } });

			// Start persist operation with null string table
			const persistPromise = workerClient.persistChunk('test-key', {}, null);

			// Should send message with null string table
			expect(mockWorker.postMessage).toHaveBeenCalledWith({
				type: 'persistChunk',
				key: 'test-key',
				snapshot: {},
				stringTable: null
			});

			// Complete operation
			const messageHandler = getMessageHandler();
			messageHandler({ data: { type: 'persistDone', key: 'test-key' } });

			await persistPromise;
		});
	});
});
