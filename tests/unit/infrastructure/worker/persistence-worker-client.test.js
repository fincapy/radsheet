import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChunkPersistenceWorker } from '../../../../src/infrastructure/worker/persistence-worker-client.js';

// Mock Worker
const mockWorker = {
	addEventListener: vi.fn(),
	removeEventListener: vi.fn(),
	postMessage: vi.fn(),
	terminate: vi.fn()
};

global.Worker = vi.fn(() => mockWorker);

describe('Persistence Worker Client', () => {
	let messageHandler = null;

	beforeEach(() => {
		vi.clearAllMocks();
		mockWorker.addEventListener.mockImplementation((event, handler) => {
			if (event === 'message') {
				messageHandler = handler;
			}
		});
	});

	it('creates a worker and sends an init message', () => {
		createChunkPersistenceWorker({ databaseName: 'test-db' });
		expect(global.Worker).toHaveBeenCalled();
		expect(mockWorker.postMessage).toHaveBeenCalledWith({
			type: 'init',
			databaseName: 'test-db',
			chunkStoreName: 'chunks',
			metaStoreName: 'meta'
		});
	});

	it('resolves persistChunk promise when worker sends persistDone', async () => {
		const client = createChunkPersistenceWorker({});

		// Send init completion message
		messageHandler({ data: { type: 'inited' } });

		// Wait for next tick to allow init promise to resolve
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Clear the mock call count after init
		mockWorker.postMessage.mockClear();

		const persistPromise = client.persistChunk('key1', {}, null);

		// Wait for the persist message to be sent
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Should have sent persist message
		expect(mockWorker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'persistChunk', key: 'key1' })
		);

		// Send completion message
		messageHandler({ data: { type: 'persistDone', key: 'key1' } });

		await expect(persistPromise).resolves.toBeUndefined();
	});

	it('rejects persistChunk promise on worker error', async () => {
		const client = createChunkPersistenceWorker({});

		// Send init completion message
		messageHandler({ data: { type: 'inited' } });

		// Wait for next tick to allow init promise to resolve
		await new Promise((resolve) => setTimeout(resolve, 0));

		const persistPromise = client.persistChunk('key1', {}, null);
		messageHandler({ data: { type: 'error', error: 'Test Error', key: 'key1' } });

		await expect(persistPromise).rejects.toThrow('Test Error');
	});

	it('resolves persistStringTable promise when worker sends stringsDone', async () => {
		const client = createChunkPersistenceWorker({});

		// Send init completion message
		messageHandler({ data: { type: 'inited' } });

		// Wait for next tick to allow init promise to resolve
		await new Promise((resolve) => setTimeout(resolve, 0));

		// Clear the mock call count after init
		mockWorker.postMessage.mockClear();

		const persistPromise = client.persistStringTable(['a', 'b']);

		// Wait for the persist message to be sent
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockWorker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'persistStringTable' })
		);

		messageHandler({ data: { type: 'stringsDone' } });
		await expect(persistPromise).resolves.toBeUndefined();
	});

	it('rejects persistStringTable promise on worker error', async () => {
		const client = createChunkPersistenceWorker({});

		// Send init completion message
		messageHandler({ data: { type: 'inited' } });

		// Wait for next tick to allow init promise to resolve
		await new Promise((resolve) => setTimeout(resolve, 0));

		const persistPromise = client.persistStringTable(['a', 'b']);
		messageHandler({ data: { type: 'error', error: 'String Table Error' } });

		await expect(persistPromise).rejects.toThrow('String Table Error');
	});

	it('handles multiple concurrent chunk requests', async () => {
		const client = createChunkPersistenceWorker({});

		// Send init completion message
		messageHandler({ data: { type: 'inited' } });

		// Wait for next tick to allow init promise to resolve
		await new Promise((resolve) => setTimeout(resolve, 0));

		const promise1 = client.persistChunk('key1', {}, null);
		const promise2 = client.persistChunk('key2', {}, null);

		messageHandler({ data: { type: 'persistDone', key: 'key2' } });
		messageHandler({ data: { type: 'persistDone', key: 'key1' } });

		await expect(promise1).resolves.toBeUndefined();
		await expect(promise2).resolves.toBeUndefined();
	});
});
