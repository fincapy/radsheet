import {
	CHUNK_NUM_ROWS,
	CHUNK_NUM_COLS,
	CHUNK_COL_SHIFT_BITS,
	MAX_CHUNK_COLUMNS_FOR_KEY_PACKING
} from '../constants/ChunkSizing.js';

/**
 * @file Contains utility functions for mapping between global cell coordinates,
 * chunk coordinates, and local cell indices within a chunk. These functions
 * are performance-critical and use bitwise operations for speed.
 */

/**
 * Packs a 2D chunk coordinate (chunkRow, chunkCol) into a single numeric key.
 * This key is used for storing and retrieving chunks in caches and persistent storage.
 * @param {number} chunkRowIndex The row index of the chunk.
 * @param {number} chunkColIndex The column index of the chunk.
 * @returns {number} A unique numeric key for the chunk.
 */
export function makeChunkKey(chunkRowIndex, chunkColIndex) {
	return chunkRowIndex * MAX_CHUNK_COLUMNS_FOR_KEY_PACKING + chunkColIndex;
}

/**
 * Computes a cell's local index within its chunk (from 0 to CELLS_PER_CHUNK - 1).
 * This uses fast bitwise operations instead of slower division and modulo.
 * @param {number} globalRowIndex The cell's global row index in the sheet.
 * @param {number} globalColIndex The cell's global column index in the sheet.
 * @returns {number} The cell's local index within its chunk.
 */
export function computeLocalIndexWithinChunk(globalRowIndex, globalColIndex) {
	const localRow = globalRowIndex & (CHUNK_NUM_ROWS - 1); // fast version of globalRowIndex % CHUNK_NUM_ROWS
	const localCol = globalColIndex & (CHUNK_NUM_COLS - 1); // fast version of globalColIndex % CHUNK_NUM_COLS
	return (localRow << CHUNK_COL_SHIFT_BITS) | localCol; // fast version of localRow * CHUNK_NUM_COLS + localCol
}
