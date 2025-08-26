/**
 * @file Implements a sharded global string table for interning strings across the entire sheet.
 * This is a memory optimization that ensures each unique string is stored only once.
 * Instead of storing the full string in each cell, dense chunks store a numeric ID
 * that maps to the string in this global table.
 *
 * Sharding strategy:
 * - Shard 0 is the legacy/default shard for backwards compatibility.
 * - Additional shards are allocated per column on demand to avoid a single giant Map.
 * - IDs are 32-bit unsigned integers composed as: [8-bit shardId | 24-bit localId].
 */

/**
 * Manages a mapping between strings and unique integer IDs.
 * This class is crucial for the memory efficiency of dense chunks.
 */
export class GlobalStringTable {
	constructor() {
		/** @type {{ idByString: Map<string, number>, stringById: string[] }[]} */
		this._shards = [];
		/** @type {Map<number, number[]>} columnIndex -> array of shardIds (in order of allocation) */
		this._columnShardIds = new Map();
		/** @type {number} next shard id to allocate (0 reserved for default) */
		this._nextAllocShardId = 1;

		// Ensure default shard 0 exists and expose back-compat fields used in tests
		const shard0 = this._ensureShard(0);
		this.idByString = shard0.idByString;
		this.stringById = shard0.stringById;
	}

	/**
	 * Ensures a shard exists and returns it.
	 * @param {number} shardId
	 */
	_ensureShard(shardId) {
		let shard = this._shards[shardId];
		if (!shard) {
			shard = { idByString: new Map(), stringById: [] };
			this._shards[shardId] = shard;
		}
		return shard;
	}

	/**
	 * Allocates and returns a fresh shard id. Up to 256 shards are supported.
	 * @returns {number}
	 */
	_allocShardId() {
		if (this._nextAllocShardId > 0xff) {
			// Exhausted shard id space; fall back to last shard id
			return 0xff;
		}
		const sid = this._nextAllocShardId;
		this._nextAllocShardId++;
		this._ensureShard(sid);
		return sid;
	}

	/**
	 * Gets the shard id used for a column, allocating one if missing.
	 * Returns the list for search and the current (last) shard id for inserts.
	 * @param {number} columnIndex
	 * @returns {{ list:number[], current:number }}
	 */
	_getOrCreateShardRefsForColumn(columnIndex) {
		let list = this._columnShardIds.get(columnIndex);
		if (!list || list.length === 0) {
			const sid = this._allocShardId();
			list = [sid];
			this._columnShardIds.set(columnIndex, list);
		}
		return { list, current: list[list.length - 1] };
	}

	/**
	 * Switches the current shard for a column by allocating a new shard id and appending it.
	 * @param {number} columnIndex
	 * @returns {number} new current shard id
	 */
	_rolloverShardForColumn(columnIndex) {
		const { list } = this._getOrCreateShardRefsForColumn(columnIndex);
		const sid = this._allocShardId();
		list.push(sid);
		return sid;
	}

	/**
	 * Gets the unique ID for a given string. If the string is new, it's added to
	 * the table and assigned a new ID.
	 * @param {string} text The string to intern.
	 * @returns {number} The unique ID for the string.
	 */
	/**
	 * Gets the unique ID for a given string. If a columnIndex is provided, the
	 * string is interned within that column's shard(s), searching existing shards
	 * first and inserting into the current shard (with rollover on capacity).
	 * If columnIndex is omitted, shard 0 is used (legacy behavior).
	 * @param {string} text
	 * @param {number} [columnIndex]
	 * @returns {number}
	 */
	getIdForString(text, columnIndex) {
		// Legacy/default path: shard 0
		if (columnIndex === undefined) {
			const shard = this._ensureShard(0);
			const existing = shard.idByString.get(text);
			if (existing !== undefined) return GlobalStringTable.encodeId(0, existing);
			const newLocalId = shard.stringById.length;
			shard.stringById.push(text);
			shard.idByString.set(text, newLocalId);
			return GlobalStringTable.encodeId(0, newLocalId);
		}

		// Column-sharded path
		const { list, current } = this._getOrCreateShardRefsForColumn(columnIndex >>> 0);

		// Look up across all shards for this column (small list, usually 1)
		for (let i = list.length - 1; i >= 0; i--) {
			const sid = list[i];
			const shard = this._ensureShard(sid);
			const existing = shard.idByString.get(text);
			if (existing !== undefined) return GlobalStringTable.encodeId(sid, existing);
		}

		// Insert into current shard; rollover if at capacity
		let sid = current;
		let shard = this._ensureShard(sid);
		if (shard.stringById.length >= 0xffffff) {
			sid = this._rolloverShardForColumn(columnIndex >>> 0);
			shard = this._ensureShard(sid);
		}
		const newLocalId = shard.stringById.length;
		shard.stringById.push(text);
		shard.idByString.set(text, newLocalId);
		return GlobalStringTable.encodeId(sid, newLocalId);
	}

	/**
	 * Retrieves a string by its unique ID.
	 * @param {number} id The ID of the string to retrieve.
	 * @returns {string | undefined} The string, or undefined if the ID is invalid.
	 */
	getStringById(id) {
		const uid = id >>> 0;
		const shardId = GlobalStringTable.decodeShard(uid);
		const localId = GlobalStringTable.decodeLocalId(uid);
		const shard = this._shards[shardId];
		if (!shard) return undefined;
		return shard.stringById[localId];
	}

	/**
	 * Loads the string table from a pre-existing list of strings. This is used
	 * when initializing the sheet from a persistent store.
	 * @param {string[]} list The list of strings to load, in order of their IDs.
	 */
	loadFromList(list) {
		// Back-compat: load into shard 0
		const shard = this._ensureShard(0);
		shard.stringById = Array.from(list);
		shard.idByString = new Map(shard.stringById.map((s, i) => [s, i]));
		// Refresh back-compat aliases
		this.idByString = shard.idByString;
		this.stringById = shard.stringById;
	}

	/**
	 * Encodes (shardId, localId) into a 32-bit unsigned integer.
	 * @param {number} shardId
	 * @param {number} localId
	 */
	static encodeId(shardId, localId) {
		return ((shardId & 0xff) << 24) | (localId & 0xffffff);
	}

	/** @param {number} id */
	static decodeShard(id) {
		return (id >>> 24) & 0xff;
	}

	/** @param {number} id */
	static decodeLocalId(id) {
		return id & 0xffffff;
	}
}
