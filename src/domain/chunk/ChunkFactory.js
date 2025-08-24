import { CELLS_PER_CHUNK } from '../constants/ChunkSizing.js';

/**
 * @file Contains factory functions for creating new chunk objects.
 * This centralizes the instantiation logic for different chunk types.
 */

/**
 * @typedef {import('./ChunkTypes').SparseChunk} SparseChunk
 * @typedef {import('./ChunkTypes').DenseChunk} DenseChunk
 */

/**
 * Creates a new, empty sparse chunk object.
 * Sparse chunks store data in a Map, making them memory-efficient for mostly empty chunks.
 * @returns {SparseChunk} A new sparse chunk.
 */
export function createSparseChunk() {
	return {
		kind: 'sparse',
		nonEmptyCellCount: 0,
		localIndexToValue: new Map()
	};
}

/**
 * Creates a new, empty dense chunk object.
 * Dense chunks use a struct-of-arrays (SoA) layout with typed arrays,
 * which is faster and more memory-efficient for largely filled chunks.
 * @returns {DenseChunk} A new dense chunk.
 */
export function createDenseChunk() {
	return {
		kind: 'dense',
		nonEmptyCellCount: 0,
		tagByLocalIndex: new Uint8Array(CELLS_PER_CHUNK),
		numberByLocalIndex: new Float64Array(CELLS_PER_CHUNK), // also stores booleans as 0/1
		stringIdByLocalIndex: new Uint32Array(CELLS_PER_CHUNK)
	};
}
