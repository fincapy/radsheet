/**
 * @file This file contains the core Sheet class, which is the heart of
 * the spreadsheet's domain logic. It manages the in-memory representation of
 * the sheet's data, handling all cell operations and coordinating with
 * persistence services.
 */

/**
 * @typedef {string|number|boolean|null} CellValue
 */

/**
 * @typedef {Object} SparseChunk
 * @property {'sparse'} kind
 * @property {Map<number, CellValue>} localIndexToValue
 * @property {number} nonEmptyCellCount
 */

/**
 * @typedef {Object} DenseChunk
 * @property {'dense'} kind
 * @property {Uint8Array} tagByLocalIndex
 * @property {Float64Array} numberByLocalIndex
 * @property {Uint32Array} stringIdByLocalIndex
 * @property {number} nonEmptyCellCount
 */

/**
 * @typedef {SparseChunk|DenseChunk} Chunk
 */

import { GlobalStringTable } from '../strings/GlobalStringTable.js';
import {
	CHUNK_ROW_SHIFT_BITS,
	CHUNK_COL_SHIFT_BITS,
	CELLS_PER_CHUNK
} from '../constants/ChunkSizing.js';
import {
	PROMOTE_TO_DENSE_FILL_RATIO,
	DEMOTE_TO_SPARSE_FILL_RATIO
} from '../constants/PromotionPolicy.js';
import {
	CELL_TAG_EMPTY,
	CELL_TAG_NUMBER,
	CELL_TAG_STRING,
	CELL_TAG_BOOLEAN
} from '../chunk/ChunkTypes.js';
import { createSparseChunk, createDenseChunk } from '../chunk/ChunkFactory.js';
import { makeChunkKey, computeLocalIndexWithinChunk } from '../chunk/ChunkCoordinates.js';

/**
 * The Sheet class is the central entity for all spreadsheet operations.
 * It is the vanilla javascript memory and logic engine that powers all operations
 * for the component.
 */
export class Sheet {
	constructor() {
		/** @type {number} */
		this.numRows = 1000;
		/** @type {GlobalStringTable} */
		this.globalStringTable = new GlobalStringTable();
		/** @type {Map<string, Chunk>} */
		this._chunks = new Map();
		/** @type {string} */
		this._lastAccessedChunkKey = '';
	}

	/**
	 * Adds additional rows to the sheet
	 * @param {number} [additionalRows=1000] - Number of rows to add
	 */
	addRows(additionalRows = 1000) {
		this.numRows += additionalRows;
	}

	/**
	 * Gets the value at the specified cell coordinates
	 * @param {number} globalRowIndex - The row index (0-based)
	 * @param {number} globalColIndex - The column index (0-based)
	 * @returns {CellValue} The cell value, or null if empty
	 */
	getValue(globalRowIndex, globalColIndex) {
		const chunk = this._getChunk(globalRowIndex, globalColIndex, /*createIfMissing=*/ false);
		if (!chunk) return null;
		const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);

		if (chunk.kind === 'sparse') {
			return chunk.localIndexToValue.get(localIndex) ?? null;
		} else {
			const tag = chunk.tagByLocalIndex[localIndex];
			if (tag === CELL_TAG_EMPTY) return null;
			if (tag === CELL_TAG_NUMBER) return chunk.numberByLocalIndex[localIndex];
			if (tag === CELL_TAG_BOOLEAN) return chunk.numberByLocalIndex[localIndex] === 1;
			return this.globalStringTable.getStringById(chunk.stringIdByLocalIndex[localIndex]);
		}
	}

	/**
	 * Checks if a cell has a value (not empty)
	 * @param {number} globalRowIndex - The row index (0-based)
	 * @param {number} globalColIndex - The column index (0-based)
	 * @returns {boolean} True if the cell has a value, false otherwise
	 */
	hasValue(globalRowIndex, globalColIndex) {
		const chunk = this._getChunk(globalRowIndex, globalColIndex, false);
		if (!chunk) return false;
		const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);
		return chunk.kind === 'sparse'
			? chunk.localIndexToValue.has(localIndex)
			: chunk.tagByLocalIndex[localIndex] !== CELL_TAG_EMPTY;
	}

	/**
	 * Sets a value at the specified cell coordinates
	 * @param {number} globalRowIndex - The row index (0-based)
	 * @param {number} globalColIndex - The column index (0-based)
	 * @param {CellValue} value - The value to set (string, number, boolean, or null)
	 */
	setValue(globalRowIndex, globalColIndex, value) {
		if (value === '' || value == null) {
			this.deleteValue(globalRowIndex, globalColIndex);
			return;
		}

		let chunk = this._getChunk(globalRowIndex, globalColIndex, /*createIfMissing=*/ true);
		const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);

		if (chunk.kind === 'sparse') {
			if (!chunk.localIndexToValue.has(localIndex)) chunk.nonEmptyCellCount++;
			chunk.localIndexToValue.set(localIndex, value);

			if (chunk.nonEmptyCellCount / CELLS_PER_CHUNK >= PROMOTE_TO_DENSE_FILL_RATIO) {
				const dense = createDenseChunk();
				dense.nonEmptyCellCount = chunk.nonEmptyCellCount;

				for (const [i, cellValue] of chunk.localIndexToValue) {
					this._assignValueToDenseChunk(dense, i, cellValue);
				}
				this._chunks.set(this._lastAccessedChunkKey, dense);
			}
		} else {
			if (chunk.tagByLocalIndex[localIndex] === CELL_TAG_EMPTY) {
				chunk.nonEmptyCellCount++;
			}
			this._assignValueToDenseChunk(chunk, localIndex, value);
		}
	}

	/**
	 * Deletes the value at the specified cell coordinates
	 * @param {number} globalRowIndex - The row index (0-based)
	 * @param {number} globalColIndex - The column index (0-based)
	 */
	deleteValue(globalRowIndex, globalColIndex) {
		const chunk = this._getChunk(globalRowIndex, globalColIndex, /*createIfMissing=*/ false);
		if (!chunk) return;

		const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);

		if (chunk.kind === 'sparse') {
			if (chunk.localIndexToValue.delete(localIndex)) {
				chunk.nonEmptyCellCount--;
				if (chunk.nonEmptyCellCount === 0) {
					const chunkKey = this._getChunkKey(globalRowIndex, globalColIndex);
					this._chunks.delete(chunkKey);
				}
			}
		} else {
			if (chunk.tagByLocalIndex[localIndex] !== CELL_TAG_EMPTY) {
				chunk.tagByLocalIndex[localIndex] = CELL_TAG_EMPTY;
				chunk.numberByLocalIndex[localIndex] = 0;
				chunk.stringIdByLocalIndex[localIndex] = 0;
				chunk.nonEmptyCellCount--;

				if (
					chunk.nonEmptyCellCount > 0 &&
					chunk.nonEmptyCellCount / CELLS_PER_CHUNK <= DEMOTE_TO_SPARSE_FILL_RATIO
				) {
					const sparse = createSparseChunk();
					sparse.nonEmptyCellCount = chunk.nonEmptyCellCount;

					for (let i = 0; i < CELLS_PER_CHUNK; i++) {
						const tag = chunk.tagByLocalIndex[i];
						if (tag === CELL_TAG_EMPTY) continue;
						const value = this._getValueFromDenseChunk(chunk, i);
						sparse.localIndexToValue.set(i, value);
					}
					this._chunks.set(this._lastAccessedChunkKey, sparse);
				}

				if (chunk.nonEmptyCellCount === 0) {
					this._chunks.delete(this._lastAccessedChunkKey);
				}
			}
		}
	}

	/**
	 * Sets multiple values in a block of cells
	 * @param {number} topRow - The starting row index (0-based)
	 * @param {number} leftCol - The starting column index (0-based)
	 * @param {CellValue[][]} values2D - 2D array of values to set
	 * @returns {number} The number of cells that were written to
	 */
	setBlock(topRow, leftCol, values2D) {
		let writeCount = 0;
		for (let r = 0; r < values2D.length; r++) {
			const globalRowIndex = topRow + r;
			const rowValues = values2D[r];
			for (let c = 0; c < rowValues.length; c++) {
				const globalColIndex = leftCol + c;
				const cellValue = rowValues[c];

				if (cellValue === '' || cellValue == null) {
					this.deleteValue(globalRowIndex, globalColIndex);
					continue;
				}

				this.setValue(globalRowIndex, globalColIndex, cellValue);
				writeCount++;
			}
		}
		return writeCount;
	}

	/**
	 * Estimates the memory usage of data currently in the hot cache
	 * @returns {number} Estimated bytes used by cached chunks and strings
	 */
	estimatedBytesInHotCache() {
		let total = 0;
		for (const chunk of this._chunks.values()) {
			if (chunk.kind === 'sparse') {
				total += chunk.nonEmptyCellCount * 24; // Rough estimate for a map entry
			} else {
				total +=
					chunk.tagByLocalIndex.byteLength +
					chunk.numberByLocalIndex.byteLength +
					chunk.stringIdByLocalIndex.byteLength;
			}
		}
		for (const s of this.globalStringTable.stringById) {
			total += 2 * s.length; // Rough estimate for string bytes
		}
		return total;
	}

	/**
	 * Gets the chunk key for the given global coordinates
	 * @private
	 * @param {number} globalRowIndex - The global row index
	 * @param {number} globalColIndex - The global column index
	 * @returns {string} The chunk key
	 */
	_getChunkKey(globalRowIndex, globalColIndex) {
		const chunkRowIndex = globalRowIndex >> CHUNK_ROW_SHIFT_BITS;
		const chunkColIndex = globalColIndex >> CHUNK_COL_SHIFT_BITS;
		return makeChunkKey(chunkRowIndex, chunkColIndex);
	}

	/**
	 * Gets or creates a chunk for the given coordinates
	 * @private
	 * @param {number} globalRowIndex - The global row index
	 * @param {number} globalColIndex - The global column index
	 * @param {boolean} createIfMissing - Whether to create the chunk if it doesn't exist
	 * @returns {Chunk|null} The chunk, or null if not found and createIfMissing is false
	 */
	_getChunk(globalRowIndex, globalColIndex, createIfMissing) {
		const chunkKey = this._getChunkKey(globalRowIndex, globalColIndex);
		let chunk = this._chunks.get(chunkKey);
		if (!chunk && createIfMissing) {
			chunk = createSparseChunk();
			this._chunks.set(chunkKey, chunk);
		}
		this._lastAccessedChunkKey = chunkKey;
		return chunk || null;
	}

	/**
	 * Assigns a value to a dense chunk at the specified local index
	 * @private
	 * @param {DenseChunk} denseChunk - The dense chunk to modify
	 * @param {number} localIndex - The local index within the chunk
	 * @param {CellValue} value - The value to assign
	 */
	_assignValueToDenseChunk(denseChunk, localIndex, value) {
		if (typeof value === 'number') {
			denseChunk.tagByLocalIndex[localIndex] = CELL_TAG_NUMBER;
			denseChunk.numberByLocalIndex[localIndex] = value;
		} else if (typeof value === 'boolean') {
			denseChunk.tagByLocalIndex[localIndex] = CELL_TAG_BOOLEAN;
			denseChunk.numberByLocalIndex[localIndex] = value ? 1 : 0;
		} else {
			denseChunk.tagByLocalIndex[localIndex] = CELL_TAG_STRING;
			denseChunk.stringIdByLocalIndex[localIndex] = this.globalStringTable.getIdForString(
				String(value)
			);
		}
	}

	/**
	 * Gets a value from a dense chunk at the specified local index
	 * @private
	 * @param {DenseChunk} denseChunk - The dense chunk to read from
	 * @param {number} localIndex - The local index within the chunk
	 * @returns {CellValue} The value at the specified index
	 */
	_getValueFromDenseChunk(denseChunk, localIndex) {
		const tag = denseChunk.tagByLocalIndex[localIndex];
		if (tag === CELL_TAG_NUMBER) return denseChunk.numberByLocalIndex[localIndex];
		if (tag === CELL_TAG_BOOLEAN) return denseChunk.numberByLocalIndex[localIndex] === 1;
		if (tag === CELL_TAG_STRING) {
			return this.globalStringTable.getStringById(denseChunk.stringIdByLocalIndex[localIndex]);
		}
		return null;
	}
}
