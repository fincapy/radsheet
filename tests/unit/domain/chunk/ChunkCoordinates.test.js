import { describe, it, expect } from 'vitest';
import { computeLocalIndexWithinChunk } from '../../../../src/domain/chunk/ChunkCoordinates.js';

describe('ChunkCoordinates', () => {
	it('computeLocalIndexWithinChunk calculates the correct index', () => {
		// Top-left corner of a chunk
		expect(computeLocalIndexWithinChunk(0, 0)).toBe(0);
		expect(computeLocalIndexWithinChunk(64, 128)).toBe(0); // Also (0,0) in a different chunk

		// Some other values
		expect(computeLocalIndexWithinChunk(0, 1)).toBe(1);
		expect(computeLocalIndexWithinChunk(1, 0)).toBe(64); // 1 * 64 + 0
		expect(computeLocalIndexWithinChunk(10, 20)).toBe(10 * 64 + 20);

		// Bottom-right corner of a chunk
		expect(computeLocalIndexWithinChunk(63, 63)).toBe(4095);
		expect(computeLocalIndexWithinChunk(127, 191)).toBe(4095); // Also (63,63) in a different chunk
	});
});
