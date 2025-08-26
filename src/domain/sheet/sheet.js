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
import { serialize2DToTSV, parseCell } from '../clipboard/tsv.js';
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

const columns = [
	'A',
	'B',
	'C',
	'D',
	'E',
	'F',
	'G',
	'H',
	'I',
	'J',
	'K',
	'L',
	'M',
	'N',
	'O',
	'P',
	'Q',
	'R',
	'S',
	'T',
	'U',
	'V',
	'W',
	'X',
	'Y',
	'Z'
];

/**
 * The Sheet class is the central entity for all spreadsheet operations.
 * It is the vanilla javascript memory and logic engine that powers all operations
 * for the component.
 */
export class Sheet {
	constructor() {
		/** @type {number} */
		this.numRows = 1000;
		/** @type {number} */
		this.numCols = 27;
		this.columnLabels = Array.from({ length: this.numCols }, (_, i) => this._indexToColumnLabel(i));
		/** @type {GlobalStringTable} */
		this.globalStringTable = new GlobalStringTable();
		/** @type {Map<string, Chunk>} */
		this._chunks = new Map();
		/** @type {string} */
		this._lastAccessedChunkKey = '';

		// --- Undo/Redo state ---
		/** @type {{ ops:{ r:number, c:number, prev:CellValue, next:CellValue }[], meta?:{anchorRow?:number, anchorCol?:number} }[]} */
		this._undoStack = [];
		/** @type {{ ops:{ r:number, c:number, prev:CellValue, next:CellValue }[], meta?:{anchorRow?:number, anchorCol?:number} }[]} */
		this._redoStack = [];
		/** @type {{ r:number, c:number, prev:CellValue, next:CellValue }[]|null} */
		this._currentTransaction = null;
		/** @type {{anchorRow?:number, anchorCol?:number}|null} */
		this._currentMeta = null;
		/** @type {Map<string, number>|null} */
		this._txnIndexByCell = null;
		/** @type {boolean} */
		this._isApplyingHistory = false;
		this._setDataRowCount = 0;
	}

	// given an index, return the column label A-Z, AA-AZ, etc.
	_indexToColumnLabel(index) {
		if (index < 26) {
			// First 26 indexes: A-Z
			return columns[index];
		} else {
			// Beyond 26: AA, AB, AC, etc.
			const firstChar = columns[Math.floor((index - 26) / 26)];
			const secondChar = columns[(index - 26) % 26];
			return firstChar + secondChar;
		}
	}

	addColumns(additionalCols = 26) {
		this.numCols += additionalCols;
		this.columnLabels = Array.from({ length: this.numCols }, (_, i) => this._indexToColumnLabel(i));
	}

	/**
	 * Runs a set of edits as a single undoable transaction.
	 * If already in a transaction, it executes inline.
	 * @param {() => void} fn
	 */
	transact(fn, meta) {
		if (this._currentTransaction) {
			fn();
			return;
		}
		this.beginTransaction(meta);
		try {
			fn();
			this.commitTransaction();
		} catch (err) {
			// Discard on error
			this._currentTransaction = null;
			this._txnIndexByCell = null;
			this._currentMeta = null;
			throw err;
		}
	}

	/** Starts an explicit transaction */
	beginTransaction(meta) {
		if (this._currentTransaction) return; // nested supported as no-op
		this._currentTransaction = [];
		this._txnIndexByCell = new Map();
		this._currentMeta = meta || null;
	}

	/** Commits the current transaction onto the undo stack */
	commitTransaction() {
		if (!this._currentTransaction) return;
		const txOps = this._currentTransaction;
		const meta = this._currentMeta || undefined;
		this._currentTransaction = null;
		this._txnIndexByCell = null;
		this._currentMeta = null;
		if (txOps.length > 0) {
			this._undoStack.push({ ops: txOps, meta });
			this._redoStack.length = 0; // clear
		}
	}

	/** Undo last committed transaction */
	undo() {
		if (this._currentTransaction) this.commitTransaction();
		const txn = this._undoStack.pop();
		if (!txn) return false;
		this._isApplyingHistory = true;
		try {
			// Apply in reverse order
			for (let i = txn.ops.length - 1; i >= 0; i--) {
				const { r, c, prev } = txn.ops[i];
				if (prev === '' || prev == null) this.deleteValue(r, c);
				else this.setValue(r, c, prev);
			}
		} finally {
			this._isApplyingHistory = false;
		}
		this._redoStack.push(txn);
		return txn.meta || true;
	}

	/** Redo last undone transaction */
	redo() {
		if (this._currentTransaction) this.commitTransaction();
		const txn = this._redoStack.pop();
		if (!txn) return false;
		this._isApplyingHistory = true;
		try {
			for (let i = 0; i < txn.ops.length; i++) {
				const { r, c, next } = txn.ops[i];
				if (next === '' || next == null) this.deleteValue(r, c);
				else this.setValue(r, c, next);
			}
		} finally {
			this._isApplyingHistory = false;
		}
		this._undoStack.push(txn);
		return txn.meta || true;
	}

	/**
	 * Deletes all values in a rectangular block (inclusive coordinates).
	 * Operation is recorded as a single transaction for undo/redo.
	 * @param {number} topRow
	 * @param {number} leftCol
	 * @param {number} bottomRow
	 * @param {number} rightCol
	 * @returns {number} Number of cells that changed from non-empty to empty
	 */
	deleteBlock(topRow, leftCol, bottomRow, rightCol) {
		if (topRow > bottomRow || leftCol > rightCol) return 0;
		const startedHere = !this._currentTransaction;
		if (startedHere) this.beginTransaction();
		let deleteCount = 0;
		for (let r = topRow; r <= bottomRow; r++) {
			for (let c = leftCol; c <= rightCol; c++) {
				const prev = this.getValue(r, c);
				if (prev !== null) {
					this.deleteValue(r, c);
					deleteCount++;
				}
			}
		}
		if (startedHere) this.commitTransaction();
		return deleteCount;
	}

	/** Indicates if there is a transaction to undo */
	canUndo() {
		return (
			this._undoStack.length > 0 ||
			(this._currentTransaction && this._currentTransaction.length > 0)
		);
	}

	/** Indicates if there is a transaction to redo */
	canRedo() {
		return this._redoStack.length > 0;
	}

	/** @private */
	_recordChange(r, c, prev, next) {
		if (this._isApplyingHistory) return; // do not record during undo/redo
		if (!this._currentTransaction) return; // only record inside transactions
		if (prev === next) return; // no-op
		const key = r + ',' + c;
		const map = this._txnIndexByCell;
		if (map && map.has(key)) {
			const idx = map.get(key);
			const entry = this._currentTransaction[idx];
			// Only update next; preserve earliest prev
			entry.next = next;
			return;
		}
		const entry = { r, c, prev, next };
		this._currentTransaction.push(entry);
		if (map) map.set(key, this._currentTransaction.length - 1);
	}

	/**
	 * Serializes a rectangular cell range to TSV suitable for pasting into spreadsheet apps
	 * @param {number} topRow - Inclusive top row index
	 * @param {number} leftCol - Inclusive left column index
	 * @param {number} bottomRow - Inclusive bottom row index
	 * @param {number} rightCol - Inclusive right column index
	 * @returns {string} Tab-separated values with newline-delimited rows
	 */
	serializeRangeToTSV(topRow, leftCol, bottomRow, rightCol) {
		const values = [];
		for (let r = topRow; r <= bottomRow; r++) {
			const row = [];
			for (let c = leftCol; c <= rightCol; c++) row.push(this.getValue(r, c));
			values.push(row);
		}
		return serialize2DToTSV(values);
	}

	/**
	 * Reads a rectangular block of values into a 2D array
	 * @param {number} topRow
	 * @param {number} leftCol
	 * @param {number} bottomRow
	 * @param {number} rightCol
	 * @returns {CellValue[][]}
	 */
	getBlock(topRow, leftCol, bottomRow, rightCol) {
		const rows = [];
		for (let r = topRow; r <= bottomRow; r++) {
			const row = [];
			for (let c = leftCol; c <= rightCol; c++) {
				row.push(this.getValue(r, c));
			}
			rows.push(row);
		}
		return rows;
	}

	/**
	 * Deserializes TSV text and writes it into the sheet starting at a position.
	 * @param {number} topRow - Inclusive top row index to paste into
	 * @param {number} leftCol - Inclusive left column index to paste into
	 * @param {string} tsv - Text to paste (tab/newline separated)
	 * @returns {{rows:number, cols:number, writeCount:number}} Size written and number of cells set
	 */
	deserializeTSV(topRow, leftCol, tsv) {
		if (!tsv) return { rows: 0, cols: 0, writeCount: 0 };
		// Entire paste is one transaction for efficient undo
		const startedHere = !this._currentTransaction;
		if (startedHere) this.beginTransaction();
		const rawLines = tsv.split(/\r?\n/);
		// Drop final empty line if input ends with newline
		const lines =
			rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
				? rawLines.slice(0, -1)
				: rawLines;
		let maxCols = 0;
		const values2D = [];
		for (const line of lines) {
			const cells = line.split('\t');
			maxCols = Math.max(maxCols, cells.length);
			const parsedRow = cells.map((s) => this._parseTSVCell(s));
			values2D.push(parsedRow);
		}
		const writeCount = this.setBlock(topRow, leftCol, values2D);
		if (startedHere) this.commitTransaction();
		return { rows: values2D.length, cols: maxCols, writeCount };
	}

	/**
	 * @private
	 * @param {string} s
	 * @returns {CellValue}
	 */
	_parseTSVCell(s) {
		return parseCell(s);
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
			// Treat as delete
			const prev = this.getValue(globalRowIndex, globalColIndex);
			this.deleteValue(globalRowIndex, globalColIndex);
			this._recordChange(globalRowIndex, globalColIndex, prev, null);
			return;
		}

		const prev = this.getValue(globalRowIndex, globalColIndex);

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

		this._recordChange(globalRowIndex, globalColIndex, prev, value);
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
		const prevValue = this.getValue(globalRowIndex, globalColIndex);

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

		this._recordChange(globalRowIndex, globalColIndex, prevValue, null);
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
					const prev = this.getValue(globalRowIndex, globalColIndex);
					this.deleteValue(globalRowIndex, globalColIndex);
					// deleteValue will record change
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

	setDataFromObjects(objects, startingRow = 0, startingCol = 0) {
		if (!objects || objects.length === 0) return;
		const stableKeys = Object.keys(objects[0]);
		for (let i = 0; i < objects.length; i++) {
			const obj = objects[i];
			this._setDataRowCount++;
			for (let j = 0; j < stableKeys.length; j++) {
				const key = stableKeys[j];
				this.setValue(startingRow + i, startingCol + j, obj[key]);
			}
		}
		if (stableKeys.length > this.numCols) {
			this.numCols = stableKeys.length;
			this.columnLabels = Array.from({ length: stableKeys.length }, (_, i) =>
				this._indexToColumnLabel(i)
			);
		}
		if (this._setDataRowCount > this.numRows) {
			this.numRows = this._setDataRowCount;
		}
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
