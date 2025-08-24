export const columns = [
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

/* ============================================================================
   Ultra-Scale Spreadsheet Storage (plain JS, descriptive names)
   - Grid is split into fixed-size CHUNKS (tiles) for locality and paging
   - Each chunk auto-switches between:
       * Sparse mode: Map<localCellIndex, JS value>
       * Dense mode: Struct-of-Arrays (typed arrays) with string interning
   - Optional: Hot RAM cache (LRU) + cold IndexedDB store with compressed chunks
   - API (sync on hot data): getValue, setValue, hasValue, deleteValue, setBlock,
                             entries, entriesInRect, loadRange, flush, estimatedBytes
   ============================================================================ */

/* ------------------------------ Tunable knobs ------------------------------ */

// One chunk holds 64x64 cells (power of two -> cheap bit math)
export const CHUNK_NUM_ROWS = 64;
export const CHUNK_NUM_COLS = 64;
export const CHUNK_ROW_SHIFT_BITS = 6;
export const CHUNK_COL_SHIFT_BITS = 6;
export const CELLS_PER_CHUNK = CHUNK_NUM_ROWS * CHUNK_NUM_COLS;

// Used to pack (chunkRow, chunkCol) into a single numeric key
// 2^20 chunk-columns * 2^20 chunk-rows → ~10^12 unique chunk keys before overflow
const MAX_CHUNK_COLUMNS_FOR_KEY_PACKING = 1 << 20;

// When a sparse chunk is at or above this fill ratio, promote to dense
export const PROMOTE_TO_DENSE_FILL_RATIO = 0.5;

// When a dense chunk drops to or below this fill ratio, demote to sparse
export const DEMOTE_TO_SPARSE_FILL_RATIO = 0.3;

// In-RAM hot cache size (number of chunks). Tune by memory budget.
export const DEFAULT_HOT_CHUNK_CAPACITY = 2000;

/* ------------------------------- Small helpers ----------------------------- */

function makeChunkKey(chunkRowIndex, chunkColIndex) {
	return chunkRowIndex * MAX_CHUNK_COLUMNS_FOR_KEY_PACKING + chunkColIndex;
}

// Compute the cell’s index inside its chunk (0..CELLS_PER_CHUNK-1)
export function computeLocalIndexWithinChunk(globalRowIndex, globalColIndex) {
	const localRow = globalRowIndex & (CHUNK_NUM_ROWS - 1); // fast % 64
	const localCol = globalColIndex & (CHUNK_NUM_COLS - 1);
	return (localRow << CHUNK_COL_SHIFT_BITS) | localCol; // row * 64 + col
}

/* ------------------------------ String interning --------------------------- */

export class GlobalStringTable {
	constructor() {
		this.idByString = new Map();
		this.stringById = [];
		this.hasUnpersistedChanges = false;
	}
	getIdForString(text) {
		let existing = this.idByString.get(text);
		if (existing !== undefined) return existing;
		const newId = this.stringById.length;
		this.stringById.push(text);
		this.idByString.set(text, newId);
		this.hasUnpersistedChanges = true;
		return newId;
	}
	getStringById(id) {
		return this.stringById[id];
	}
	loadFromList(list) {
		this.stringById = Array.from(list);
		this.idByString = new Map(this.stringById.map((s, i) => [s, i]));
		this.hasUnpersistedChanges = false;
	}
}

/* ----------------------------- LRU hot cache ------------------------------- */

export class LeastRecentlyUsedCache {
	constructor(maxItems) {
		this.maximumItems = maxItems;
		this.map = new Map(); // preserves order of insertion
		this.onEvict = null; // optional callback (key, value) when ejecting
	}
	get(key) {
		const value = this.map.get(key);
		if (!value) return undefined;
		// Bump to most-recent by re-inserting
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}
	set(key, value) {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, value);
		if (this.map.size > this.maximumItems) {
			const oldestKey = this.map.keys().next().value;
			const oldestValue = this.map.get(oldestKey);
			this.map.delete(oldestKey);
			if (this.onEvict) this.onEvict(oldestKey, oldestValue);
		}
	}
	has(key) {
		return this.map.has(key);
	}
	delete(key) {
		return this.map.delete(key);
	}
	*entries() {
		yield* this.map.entries();
	}
	*values() {
		yield* this.map.values();
	}
}

/* ------------------------- Simple RLE + varint codec ----------------------- */

// Run-length encode a Uint8Array (e.g., tag array)
export function rleEncodeUint8(uint8) {
	const bytes = [];
	for (let i = 0; i < uint8.length; ) {
		const value = uint8[i];
		let runLength = 1;
		i++;
		while (i < uint8.length && uint8[i] === value && runLength < 255) {
			runLength++;
			i++;
		}
		bytes.push(runLength, value);
	}
	return Uint8Array.from(bytes);
}

export function rleDecodeUint8(encodedBytes, outputLength) {
	const output = new Uint8Array(outputLength);
	let outIndex = 0,
		inIndex = 0;
	while (inIndex < encodedBytes.length) {
		const runLength = encodedBytes[inIndex++];
		const value = encodedBytes[inIndex++];
		output.fill(value, outIndex, outIndex + runLength);
		outIndex += runLength;
	}
	return output;
}

// ULEB128-style varint
export function writeVarintUnsigned(value, outArray) {
	let v = value >>> 0;
	while (v > 0x7f) {
		outArray.push((v & 0x7f) | 0x80);
		v >>>= 7;
	}
	outArray.push(v);
}

export function readVarintUnsigned(bytes, startIndex) {
	let shift = 0,
		result = 0,
		index = startIndex,
		current;
	do {
		current = bytes[index++];
		result |= (current & 0x7f) << shift;
		shift += 7;
	} while (current & 0x80);
	return [result >>> 0, index];
}

export function concatUint8(chunks) {
	let total = 0;
	for (const chunk of chunks) total += chunk.length;
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

export function float64ArrayToBytes(f64array) {
	return new Uint8Array(f64array.buffer.slice(0)); // copy
}

export function bytesToFloat64Array(bytes, offsetBytes, count) {
	const slice = bytes.slice(offsetBytes, offsetBytes + count * 8); // copy
	return new Float64Array(slice.buffer, slice.byteOffset, count);
}

/* ------------------------------ Chunk factories ---------------------------- */

// Sparse chunk: only stores present cells (Map of localIndex -> value)
export function createSparseChunk() {
	return { kind: 'sparse', nonEmptyCellCount: 0, localIndexToValue: new Map(), isDirty: false };
}

// Dense chunk: struct-of-arrays for speed & low GC
// tag: 0 empty, 1 number, 2 string, 3 boolean
export function createDenseChunk() {
	return {
		kind: 'dense',
		nonEmptyCellCount: 0,
		isDirty: false,
		tagByLocalIndex: new Uint8Array(CELLS_PER_CHUNK),
		numberByLocalIndex: new Float64Array(CELLS_PER_CHUNK), // also stores booleans as 0/1
		stringIdByLocalIndex: new Uint32Array(CELLS_PER_CHUNK)
	};
}

/* -------------------------- Per-chunk compression -------------------------- */
/* File format (very small header):
   DENSE:
     [ 'D'(1 byte), version(1) ]
     [ tagRLELength(varint) ][ tagRLEBytes ]
     [ numericCount(varint) ][ numericPayload(Float64 * numericCount) ]
     [ stringCount(varint)  ][ stringIDs(varint repeated stringCount times) ]

   SPARSE:
     [ 'S'(1 byte), version(1) ]
     [ entryCount(varint) ]
     then repeated entryCount times:
       [ deltaLocalIndex(varint) ][ valueTag(1) ][ valuePayload(...) ]
       valueTag: 1 number (Float64), 3 boolean (1 byte 0/1), 2 string (stringId varint)
*/

export const ChunkCodec = {
	// eslint-disable-next-line
	encodeDenseChunk(denseChunk, globalStringTable) {
		const header = [0x44 /* 'D' */, 0x01 /* version */];

		// 1) compress tag array via RLE
		const rleOfTags = rleEncodeUint8(denseChunk.tagByLocalIndex);
		const rleLenVarint = [];
		writeVarintUnsigned(rleOfTags.length, rleLenVarint);

		// 2) gather numeric payload
		let numericCount = 0;
		for (let i = 0; i < CELLS_PER_CHUNK; i++) {
			const tag = denseChunk.tagByLocalIndex[i];
			if (tag === 1 || tag === 3) numericCount++;
		}
		const numericCountVarint = [];
		writeVarintUnsigned(numericCount, numericCountVarint);

		const numericValues = new Float64Array(numericCount);
		for (let i = 0, out = 0; i < CELLS_PER_CHUNK; i++) {
			const tag = denseChunk.tagByLocalIndex[i];
			if (tag === 1 || tag === 3) numericValues[out++] = denseChunk.numberByLocalIndex[i];
		}
		const numericBytes = float64ArrayToBytes(numericValues);

		// 3) gather string ids as varints
		let stringCount = 0;
		for (let i = 0; i < CELLS_PER_CHUNK; i++)
			if (denseChunk.tagByLocalIndex[i] === 2) stringCount++;
		const stringCountVarint = [];
		writeVarintUnsigned(stringCount, stringCountVarint);
		const stringIdVarints = [];
		for (let i = 0; i < CELLS_PER_CHUNK; i++) {
			if (denseChunk.tagByLocalIndex[i] === 2) {
				writeVarintUnsigned(denseChunk.stringIdByLocalIndex[i], stringIdVarints);
			}
		}

		return concatUint8([
			Uint8Array.from(header),
			Uint8Array.from(rleLenVarint),
			rleOfTags,
			Uint8Array.from(numericCountVarint),
			numericBytes,
			Uint8Array.from(stringCountVarint),
			Uint8Array.from(stringIdVarints)
		]);
	},
	// eslint-disable-next-line
	decodeDenseChunk(encodedBytes, globalStringTable) {
		let readIndex = 0;
		const typeByte = encodedBytes[readIndex++],
			versionByte = encodedBytes[readIndex++];
		if (typeByte !== 0x44 || versionByte !== 0x01) throw new Error('Invalid dense chunk header');

		let rleLength;
		[rleLength, readIndex] = readVarintUnsigned(encodedBytes, readIndex);
		const rleRegion = encodedBytes.slice(readIndex, readIndex + rleLength);
		readIndex += rleLength;

		const dense = createDenseChunk();
		dense.tagByLocalIndex = rleDecodeUint8(rleRegion, CELLS_PER_CHUNK);

		let numericCount;
		[numericCount, readIndex] = readVarintUnsigned(encodedBytes, readIndex);
		const numericF64 = bytesToFloat64Array(encodedBytes, readIndex, numericCount);
		readIndex += numericCount * 8;

		// fill numberByLocalIndex from numericF64 where tags say number/bool
		for (let i = 0, out = 0; i < CELLS_PER_CHUNK; i++) {
			const tag = dense.tagByLocalIndex[i];
			if (tag === 1 || tag === 3) dense.numberByLocalIndex[i] = numericF64[out++];
		}

		let stringCount;
		[stringCount, readIndex] = readVarintUnsigned(encodedBytes, readIndex);
		for (let decoded = 0, i = 0; i < CELLS_PER_CHUNK && decoded < stringCount; i++) {
			if (dense.tagByLocalIndex[i] === 2) {
				let stringId;
				[stringId, readIndex] = readVarintUnsigned(encodedBytes, readIndex);
				dense.stringIdByLocalIndex[i] = stringId;
				decoded++;
			}
		}

		let filled = 0;
		for (const tag of dense.tagByLocalIndex) if (tag !== 0) filled++;
		dense.nonEmptyCellCount = filled;
		dense.isDirty = false;
		return dense;
	},

	encodeSparseChunk(sparseChunk, globalStringTable) {
		const header = [0x53 /* 'S' */, 0x01 /* version */];

		// Sort entries by local index to enable delta coding
		const sortedEntries = Array.from(sparseChunk.localIndexToValue.entries()).sort(
			(a, b) => a[0] - b[0]
		);

		const entryCountVarint = [];
		writeVarintUnsigned(sortedEntries.length, entryCountVarint);

		const payloadBytes = [];
		let previousLocalIndex = 0;
		let isFirst = true;

		for (const [localIndex, jsValue] of sortedEntries) {
			// delta-encode local index
			const delta = isFirst ? localIndex : localIndex - previousLocalIndex;
			isFirst = false;
			previousLocalIndex = localIndex;
			writeVarintUnsigned(delta, payloadBytes);

			// tag + payload
			if (typeof jsValue === 'number') {
				// tag 1 + Float64 payload
				payloadBytes.push(1);
				const dv = new DataView(new ArrayBuffer(8));
				dv.setFloat64(0, jsValue, true);
				// flush current payload chunk then 8-byte float (avoid copying every time)
				// simpler: push varint+tag now, then append 8 bytes via typed array
				const before = Uint8Array.from(payloadBytes);
				payloadBytes.length = 0; // clear for next
				const numBytes = new Uint8Array(dv.buffer);
				// concat small chunks
				const merged = new Uint8Array(before.length + numBytes.length);
				merged.set(before, 0);
				merged.set(numBytes, before.length);
				// Replace payloadBytes with merged so far
				// (we will continue to append to a growing array by rebuilding occasionally)
				Array.prototype.push.apply(payloadBytes, Array.from(merged));
			} else if (typeof jsValue === 'boolean') {
				// tag 3 + 1 byte (0/1)
				payloadBytes.push(3, jsValue ? 1 : 0);
			} else {
				// tag 2 + stringId(varint)
				payloadBytes.push(2);
				const stringId = globalStringTable.getIdForString(String(jsValue));
				writeVarintUnsigned(stringId, payloadBytes);
			}
		}

		return concatUint8([
			Uint8Array.from(header),
			Uint8Array.from(entryCountVarint),
			Uint8Array.from(payloadBytes)
		]);
	},

	decodeSparseChunk(encodedBytes, globalStringTable) {
		let readIndex = 0;
		const typeByte = encodedBytes[readIndex++],
			versionByte = encodedBytes[readIndex++];
		if (typeByte !== 0x53 || versionByte !== 0x01) throw new Error('Invalid sparse chunk header');

		let entryCount;
		[entryCount, readIndex] = readVarintUnsigned(encodedBytes, readIndex);
		const sparse = createSparseChunk();

		let currentLocalIndex = 0;
		for (let n = 0; n < entryCount; n++) {
			let delta;
			[delta, readIndex] = readVarintUnsigned(encodedBytes, readIndex);
			currentLocalIndex += delta;

			const valueTag = encodedBytes[readIndex++];

			if (valueTag === 1) {
				// number
				const dv = new DataView(encodedBytes.buffer, encodedBytes.byteOffset + readIndex, 8);
				const value = dv.getFloat64(0, true);
				readIndex += 8;
				sparse.localIndexToValue.set(currentLocalIndex, value);
			} else if (valueTag === 3) {
				// boolean
				const value = !!encodedBytes[readIndex++];
				sparse.localIndexToValue.set(currentLocalIndex, value);
			} else if (valueTag === 2) {
				// string
				let stringId;
				[stringId, readIndex] = readVarintUnsigned(encodedBytes, readIndex);
				sparse.localIndexToValue.set(currentLocalIndex, globalStringTable.getStringById(stringId));
			} else {
				throw new Error('Unknown value tag in sparse chunk');
			}
			sparse.nonEmptyCellCount++;
		}

		sparse.isDirty = false;
		return sparse;
	},

	encodeChunk(genericChunk, globalStringTable) {
		return genericChunk.kind === 'dense'
			? this.encodeDenseChunk(genericChunk, globalStringTable)
			: this.encodeSparseChunk(genericChunk, globalStringTable);
	},

	decodeChunk(encodedBytes, globalStringTable) {
		const typeByte = encodedBytes[0];
		if (typeByte === 0x44) return this.decodeDenseChunk(encodedBytes, globalStringTable);
		if (typeByte === 0x53) return this.decodeSparseChunk(encodedBytes, globalStringTable);
		throw new Error('Unknown chunk type');
	}
};

/* --------------------------- IndexedDB chunk store ------------------------- */

export class ChunkStore {
	constructor(
		{ databaseName = 'SheetDB', chunkStoreName = 'chunks', metaStoreName = 'meta' } = {},
		idbFactory
	) {
		this.databaseName = databaseName;
		this.chunkStoreName = chunkStoreName;
		this.metaStoreName = metaStoreName;
		this.database = null;
		this._idbFactory = idbFactory || indexedDB;
	}

	async _openIfNeeded() {
		if (this.database) return;
		this.database = await new Promise((resolve, reject) => {
			const request = this._idbFactory.open(this.dbName, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(this.chunkStoreName))
					db.createObjectStore(this.chunkStoreName);
				if (!db.objectStoreNames.contains(this.metaStoreName))
					db.createObjectStore(this.metaStoreName);
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	async getCompressedChunkBytes(chunkKey) {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.chunkStoreName, 'readonly');
			const store = tx.objectStore(this.chunkStoreName);
			const req = store.get(chunkKey);
			req.onsuccess = () => {
				const val = req.result;
				if (!val) return resolve(null);
				if (val instanceof Uint8Array) return resolve(val);
				if (val instanceof ArrayBuffer) return resolve(new Uint8Array(val));
				resolve(new Uint8Array(val)); // best-effort
			};
			req.onerror = () => reject(req.error);
		});
	}

	async putCompressedChunkBytes(chunkKey, bytes) {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.chunkStoreName, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.objectStore(this.chunkStoreName).put(bytes, chunkKey);
		});
	}

	async deleteChunk(chunkKey) {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.chunkStoreName, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.objectStore(this.chunkStoreName).delete(chunkKey);
		});
	}

	async getStringTableList() {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.metaStoreName, 'readonly');
			const req = tx.objectStore(this.metaStoreName).get('strings');
			req.onsuccess = () => resolve(req.result || null);
			req.onerror = () => reject(req.error);
		});
	}

	async putStringTableList(list) {
		await this._openIfNeeded();
		return new Promise((resolve, reject) => {
			const tx = this.database.transaction(this.metaStoreName, 'readwrite');
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.objectStore(this.metaStoreName).put(Array.from(list), 'strings');
		});
	}
}

/* --------------------------------- Sheet ---------------------------------- */

export class Sheet {
	constructor() {
		this.numRows = 0;
		this.globalStringTable = new GlobalStringTable();
		this._hotChunks = new LeastRecentlyUsedCache(DEFAULT_HOT_CHUNK_CAPACITY);
		this.chunkStore = null;
		this._lastChunkKey = null;
		this._lastChunk = null;

		this._hotChunks.onEvict = (evictedChunkKey, evictedChunk) => {
			if (!this.chunkStore || !evictedChunk.isDirty) return;
			this._persistSingleChunk(evictedChunkKey, evictedChunk).catch(console.error);
		};
	}

	/* ------------------------- optional: attach a store ---------------------- */

	async useStore(chunkStore) {
		this.chunkStore = chunkStore;
		const persistedStrings = await this.chunkStore.getStringTableList();
		if (persistedStrings) this.globalStringTable.loadFromList(persistedStrings);
	}

	/* ------------------------------- Public API ------------------------------ */

	addRows(additionalRows = 1000) {
		this.numRows += additionalRows;
	}

	getValue(globalRowIndex, globalColIndex) {
		const chunk = this._getHotChunkSynchronously(
			globalRowIndex,
			globalColIndex,
			/*createIfMissing=*/ false
		);
		if (!chunk) return null;
		const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);

		if (chunk.kind === 'sparse') {
			return chunk.localIndexToValue.get(localIndex) ?? null;
		} else {
			const tag = chunk.tagByLocalIndex[localIndex];
			if (tag === 0) return null;
			if (tag === 1) return chunk.numberByLocalIndex[localIndex];
			if (tag === 3) return chunk.numberByLocalIndex[localIndex] === 1;
			return this.globalStringTable.getStringById(chunk.stringIdByLocalIndex[localIndex]);
		}
	}

	hasValue(globalRowIndex, globalColIndex) {
		const chunk = this._getHotChunkSynchronously(globalRowIndex, globalColIndex, false);
		if (!chunk) return false;
		const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);
		return chunk.kind === 'sparse'
			? chunk.localIndexToValue.has(localIndex)
			: chunk.tagByLocalIndex[localIndex] !== 0;
	}

	setValue(globalRowIndex, globalColIndex, value) {
		// Treat "", null, undefined as delete
		if (value === '' || value == null) {
			this.deleteValue(globalRowIndex, globalColIndex);
			return;
		}

		let chunk = this._getHotChunkSynchronously(
			globalRowIndex,
			globalColIndex,
			/*createIfMissing=*/ true
		);
		const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);
		chunk.isDirty = true;

		if (chunk.kind === 'sparse') {
			if (!chunk.localIndexToValue.has(localIndex)) chunk.nonEmptyCellCount++;
			chunk.localIndexToValue.set(localIndex, value);

			// Promote to dense if chunk is becoming full
			if (chunk.nonEmptyCellCount / CELLS_PER_CHUNK >= PROMOTE_TO_DENSE_FILL_RATIO) {
				const dense = createDenseChunk();
				dense.nonEmptyCellCount = chunk.nonEmptyCellCount;

				for (const [i, cellValue] of chunk.localIndexToValue) {
					if (typeof cellValue === 'number') {
						dense.tagByLocalIndex[i] = 1;
						dense.numberByLocalIndex[i] = cellValue;
					} else if (typeof cellValue === 'boolean') {
						dense.tagByLocalIndex[i] = 3;
						dense.numberByLocalIndex[i] = cellValue ? 1 : 0;
					} else {
						dense.tagByLocalIndex[i] = 2;
						dense.stringIdByLocalIndex[i] = this.globalStringTable.getIdForString(
							String(cellValue)
						);
					}
				}
				dense.isDirty = true;
				this._hotChunks.set(this._lastAccessedChunkKey, dense);
			}
		} else {
			// Already dense: write into SoA
			if (typeof value === 'number') {
				if (chunk.tagByLocalIndex[localIndex] === 0) chunk.nonEmptyCellCount++;
				chunk.tagByLocalIndex[localIndex] = 1;
				chunk.numberByLocalIndex[localIndex] = value;
			} else if (typeof value === 'boolean') {
				if (chunk.tagByLocalIndex[localIndex] === 0) chunk.nonEmptyCellCount++;
				chunk.tagByLocalIndex[localIndex] = 3;
				chunk.numberByLocalIndex[localIndex] = value ? 1 : 0;
			} else {
				if (chunk.tagByLocalIndex[localIndex] === 0) chunk.nonEmptyCellCount++;
				chunk.tagByLocalIndex[localIndex] = 2;
				chunk.stringIdByLocalIndex[localIndex] = this.globalStringTable.getIdForString(
					String(value)
				);
			}
		}
	}

	deleteValue(globalRowIndex, globalColIndex) {
		const chunk = this._getHotChunkSynchronously(
			globalRowIndex,
			globalColIndex,
			/*createIfMissing=*/ false
		);
		if (!chunk) return;

		const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);

		if (chunk.kind === 'sparse') {
			if (chunk.localIndexToValue.delete(localIndex)) {
				chunk.nonEmptyCellCount--;
				chunk.isDirty = true;
				if (chunk.nonEmptyCellCount === 0) {
					this._hotChunks.delete(localIndex);
				}
			}
		} else {
			if (chunk.tagByLocalIndex[localIndex] !== 0) {
				chunk.tagByLocalIndex[localIndex] = 0;
				chunk.numberByLocalIndex[localIndex] = 0;
				chunk.stringIdByLocalIndex[localIndex] = 0;
				chunk.nonEmptyCellCount--;
				chunk.isDirty = true;

				// Demote to sparse if it got quite empty
				if (
					chunk.nonEmptyCellCount > 0 &&
					chunk.nonEmptyCellCount / CELLS_PER_CHUNK <= DEMOTE_TO_SPARSE_FILL_RATIO
				) {
					const sparse = createSparseChunk();
					sparse.nonEmptyCellCount = chunk.nonEmptyCellCount;

					for (let i = 0; i < CELLS_PER_CHUNK; i++) {
						const tag = chunk.tagByLocalIndex[i];
						if (tag === 0) continue;
						if (tag === 1) sparse.localIndexToValue.set(i, chunk.numberByLocalIndex[i]);
						else if (tag === 3) sparse.localIndexToValue.set(i, chunk.numberByLocalIndex[i] === 1);
						else
							sparse.localIndexToValue.set(
								i,
								this.globalStringTable.getStringById(chunk.stringIdByLocalIndex[i])
							);
					}
					sparse.isDirty = true;
					this._hotChunks.set(this._lastAccessedChunkKey, sparse);
				}

				if (chunk.nonEmptyCellCount === 0) {
					this._hotChunks.delete(this._lastAccessedChunkKey);
				}
			}
		}
	}

	// Batch write a 2D block (e.g. paste). Returns number of cells written.
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

				let chunk = this._getHotChunkSynchronously(globalRowIndex, globalColIndex, true);
				const localIndex = computeLocalIndexWithinChunk(globalRowIndex, globalColIndex);
				chunk.isDirty = true;

				if (chunk.kind === 'sparse') {
					if (!chunk.localIndexToValue.has(localIndex)) chunk.nonEmptyCellCount++;
					chunk.localIndexToValue.set(localIndex, cellValue);

					if (chunk.nonEmptyCellCount / CELLS_PER_CHUNK >= PROMOTE_TO_DENSE_FILL_RATIO) {
						const dense = createDenseChunk();
						dense.nonEmptyCellCount = chunk.nonEmptyCellCount;
						for (const [i, v] of chunk.localIndexToValue) {
							if (typeof v === 'number') {
								dense.tagByLocalIndex[i] = 1;
								dense.numberByLocalIndex[i] = v;
							} else if (typeof v === 'boolean') {
								dense.tagByLocalIndex[i] = 3;
								dense.numberByLocalIndex[i] = v ? 1 : 0;
							} else {
								dense.tagByLocalIndex[i] = 2;
								dense.stringIdByLocalIndex[i] = this.globalStringTable.getIdForString(String(v));
							}
						}
						dense.isDirty = true;
						this._hotChunks.set(this._lastAccessedChunkKey, dense);
						chunk = dense; // write-through continues below (next loop)
					}
				}
				if (chunk.kind === 'dense') {
					if (typeof cellValue === 'number') {
						if (chunk.tagByLocalIndex[localIndex] === 0) chunk.nonEmptyCellCount++;
						chunk.tagByLocalIndex[localIndex] = 1;
						chunk.numberByLocalIndex[localIndex] = cellValue;
					} else if (typeof cellValue === 'boolean') {
						if (chunk.tagByLocalIndex[localIndex] === 0) chunk.nonEmptyCellCount++;
						chunk.tagByLocalIndex[localIndex] = 3;
						chunk.numberByLocalIndex[localIndex] = cellValue ? 1 : 0;
					} else {
						if (chunk.tagByLocalIndex[localIndex] === 0) chunk.nonEmptyCellCount++;
						chunk.tagByLocalIndex[localIndex] = 2;
						chunk.stringIdByLocalIndex[localIndex] = this.globalStringTable.getIdForString(
							String(cellValue)
						);
					}
				}
				writeCount++;
			}
		}
		return writeCount;
	}

	// Iterate all non-empty cells currently in the hot cache (RAM)
	*entries() {
		for (const [chunkKey, chunk] of this._hotChunks.entries()) {
			if (!chunk || chunk.nonEmptyCellCount === 0) continue;
			const chunkRowIndex = Math.floor(chunkKey / MAX_CHUNK_COLUMNS_FOR_KEY_PACKING);
			const chunkColIndex = chunkKey % MAX_CHUNK_COLUMNS_FOR_KEY_PACKING;
			const baseGlobalRow = chunkRowIndex << CHUNK_ROW_SHIFT_BITS;
			const baseGlobalCol = chunkColIndex << CHUNK_COL_SHIFT_BITS;

			if (chunk.kind === 'sparse') {
				for (const [localIndex, jsValue] of chunk.localIndexToValue) {
					const localRow = localIndex >> CHUNK_COL_SHIFT_BITS;
					const localCol = localIndex & (CHUNK_NUM_COLS - 1);
					yield { row: baseGlobalRow + localRow, col: baseGlobalCol + localCol, value: jsValue };
				}
			} else {
				for (let localIndex = 0; localIndex < CELLS_PER_CHUNK; localIndex++) {
					const tag = chunk.tagByLocalIndex[localIndex];
					if (tag === 0) continue;
					const localRow = localIndex >> CHUNK_COL_SHIFT_BITS;
					const localCol = localIndex & (CHUNK_NUM_COLS - 1);
					let jsValue;
					if (tag === 1) jsValue = chunk.numberByLocalIndex[localIndex];
					else if (tag === 3) jsValue = chunk.numberByLocalIndex[localIndex] === 1;
					else
						jsValue = this.globalStringTable.getStringById(chunk.stringIdByLocalIndex[localIndex]);
					yield { row: baseGlobalRow + localRow, col: baseGlobalCol + localCol, value: jsValue };
				}
			}
		}
	}

	// Iterate cells in a rectangular area (hot cache only)
	*entriesInRect(topRow, leftCol, bottomRow, rightCol) {
		if (bottomRow < topRow || rightCol < leftCol) return;

		const firstChunkRow = topRow >> CHUNK_ROW_SHIFT_BITS;
		const firstChunkCol = leftCol >> CHUNK_COL_SHIFT_BITS;
		const lastChunkRow = bottomRow >> CHUNK_ROW_SHIFT_BITS;
		const lastChunkCol = rightCol >> CHUNK_COL_SHIFT_BITS;

		for (let chunkRow = firstChunkRow; chunkRow <= lastChunkRow; chunkRow++) {
			for (let chunkCol = firstChunkCol; chunkCol <= lastChunkCol; chunkCol++) {
				const chunkKey = makeChunkKey(chunkRow, chunkCol);
				const chunk = this._hotChunks.get(chunkKey) || this._hotChunks.map.get(chunkKey);
				if (!chunk || chunk.nonEmptyCellCount === 0) continue;

				const baseGlobalRow = chunkRow << CHUNK_ROW_SHIFT_BITS;
				const baseGlobalCol = chunkCol << CHUNK_COL_SHIFT_BITS;

				const localTop = Math.max(0, topRow - baseGlobalRow);
				const localBottom = Math.min(CHUNK_NUM_ROWS - 1, bottomRow - baseGlobalRow);
				const localLeft = Math.max(0, leftCol - baseGlobalCol);
				const localRight = Math.min(CHUNK_NUM_COLS - 1, rightCol - baseGlobalCol);

				if (chunk.kind === 'sparse') {
					for (const [localIndex, jsValue] of chunk.localIndexToValue) {
						const lr = localIndex >> CHUNK_COL_SHIFT_BITS;
						const lc = localIndex & (CHUNK_NUM_COLS - 1);
						if (lr < localTop || lr > localBottom || lc < localLeft || lc > localRight) continue;
						yield { row: baseGlobalRow + lr, col: baseGlobalCol + lc, value: jsValue };
					}
				} else {
					for (let lr = localTop; lr <= localBottom; lr++) {
						const rowBase = lr << CHUNK_COL_SHIFT_BITS;
						for (let lc = localLeft; lc <= localRight; lc++) {
							const localIndex = rowBase | lc;
							const tag = chunk.tagByLocalIndex[localIndex];
							if (tag === 0) continue;
							let jsValue;
							if (tag === 1) jsValue = chunk.numberByLocalIndex[localIndex];
							else if (tag === 3) jsValue = chunk.numberByLocalIndex[localIndex] === 1;
							else
								jsValue = this.globalStringTable.getStringById(
									chunk.stringIdByLocalIndex[localIndex]
								);
							yield { row: baseGlobalRow + lr, col: baseGlobalCol + lc, value: jsValue };
						}
					}
				}
			}
		}
	}

	/* --------------------------- Hot/Cold Integration ------------------------ */

	// Preload chunks intersecting a rect from IndexedDB into the hot cache.
	// This keeps get/set synchronous (no async inside those hot paths).
	async loadRange(topRow, leftCol, bottomRow, rightCol) {
		if (!this.chunkStore) return;

		const firstChunkRow = topRow >> CHUNK_ROW_SHIFT_BITS;
		const firstChunkCol = leftCol >> CHUNK_COL_SHIFT_BITS;
		const lastChunkRow = bottomRow >> CHUNK_ROW_SHIFT_BITS;
		const lastChunkCol = rightCol >> CHUNK_COL_SHIFT_BITS;

		const loadPromises = [];
		for (let chunkRow = firstChunkRow; chunkRow <= lastChunkRow; chunkRow++) {
			for (let chunkCol = firstChunkCol; chunkCol <= lastChunkCol; chunkCol++) {
				const chunkKey = makeChunkKey(chunkRow, chunkCol);
				if (this._hotChunks.has(chunkKey)) continue;
				loadPromises.push(
					(async () => {
						const bytes = await this.chunkStore.getCompressedChunkBytes(chunkKey);
						if (!bytes) return;
						const decodedChunk = ChunkCodec.decodeChunk(bytes, this.globalStringTable);
						this._hotChunks.set(chunkKey, decodedChunk);
					})()
				);
			}
		}
		await Promise.all(loadPromises);

		// Make sure string table is up to date (useStore() already does this; here for safety)
		if (this.globalStringTable.hasUnpersistedChanges && this.chunkStore) {
			await this.chunkStore.putStringTableList(this.globalStringTable.stringById);
			this.globalStringTable.hasUnpersistedChanges = false;
		}
	}

	// Persist all dirty hot chunks + string table; await completion
	async flush() {
		if (!this.chunkStore) return;
		const tasks = [];
		for (const [chunkKey, chunk] of this._hotChunks.entries()) {
			if (chunk.isDirty) tasks.push(this._persistSingleChunk(chunkKey, chunk));
		}
		if (this.globalStringTable.hasUnpersistedChanges) {
			tasks.push(
				this.chunkStore.putStringTableList(this.globalStringTable.stringById).then(() => {
					this.globalStringTable.hasUnpersistedChanges = false;
				})
			);
		}
		await Promise.all(tasks);
	}

	estimatedBytesInHotCache() {
		// Very rough estimate; useful to size your hot cache
		let total = 0;
		for (const chunk of this._hotChunks.values()) {
			if (chunk.kind === 'sparse') {
				// Extremely rough: JS engines differ, treat entry ~ 24 bytes
				total += chunk.nonEmptyCellCount * 24;
			} else {
				total +=
					chunk.tagByLocalIndex.byteLength +
					chunk.numberByLocalIndex.byteLength +
					chunk.stringIdByLocalIndex.byteLength;
			}
		}
		for (const s of this.globalStringTable.stringById) total += 2 * s.length; // rough string bytes
		return total;
	}

	/* -------------------------------- Internals ------------------------------ */

	_getHotChunkSynchronously(globalRowIndex, globalColIndex, createIfMissing) {
		const chunkRowIndex = globalRowIndex >> CHUNK_ROW_SHIFT_BITS;
		const chunkColIndex = globalColIndex >> CHUNK_COL_SHIFT_BITS;
		const chunkKey = makeChunkKey(chunkRowIndex, chunkColIndex);
		this._lastAccessedChunkKey = chunkKey;

		let chunk = this._hotChunks.get(chunkKey);
		if (!chunk) chunk = this._hotChunks.map.get(chunkKey);
		if (!chunk && createIfMissing) {
			chunk = createSparseChunk();
			this._hotChunks.set(chunkKey, chunk);
		}
		return chunk || null;
	}

	async _persistSingleChunk(chunkKey, chunk) {
		if (!this.chunkStore) return;
		const compressedBytes = ChunkCodec.encodeChunk(chunk, this.globalStringTable);
		await this.chunkStore.putCompressedChunkBytes(chunkKey, compressedBytes);
		chunk.isDirty = false;

		if (this.globalStringTable.hasUnpersistedChanges) {
			await this.chunkStore.putStringTableList(this.globalStringTable.stringById);
			this.globalStringTable.hasUnpersistedChanges = false;
		}
	}
}

export const CELL_TYPE_EMPTY = 0;
export const CELL_TYPE_NUMBER = 1;
export const CELL_TYPE_STRING = 2;
