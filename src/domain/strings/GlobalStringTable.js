/**
 * @file Implements a global string table for interning strings across the entire sheet.
 * This is a memory optimization that ensures each unique string is stored only once.
 * Instead of storing the full string in each cell, dense chunks store a numeric ID
 * that maps to the string in this global table.
 */

/**
 * Manages a mapping between strings and unique integer IDs.
 * This class is crucial for the memory efficiency of dense chunks.
 */
export class GlobalStringTable {
	constructor() {
		/**
		 * A map from a string to its assigned numeric ID.
		 * @type {Map<string, number>}
		 * @private
		 */
		this.idByString = new Map();

		/**
		 * An array where the index is the string's ID and the value is the string itself.
		 * @type {string[]}
		 * @private
		 */
		this.stringById = [];

		/**
		 * A flag indicating whether there have been changes to the string table
		 * that have not yet been persisted to storage.
		 * @type {boolean}
		 */
		this.hasUnpersistedChanges = false;
	}

	/**
	 * Gets the unique ID for a given string. If the string is new, it's added to
	 * the table and assigned a new ID.
	 * @param {string} text The string to intern.
	 * @returns {number} The unique ID for the string.
	 */
	getIdForString(text) {
		let existing = this.idByString.get(text);
		if (existing !== undefined) return existing;
		const newId = this.stringById.length;
		this.stringById.push(text);
		this.idByString.set(text, newId);
		this.hasUnpersistedChanges = true;
		return newId;
	}

	/**
	 * Retrieves a string by its unique ID.
	 * @param {number} id The ID of the string to retrieve.
	 * @returns {string | undefined} The string, or undefined if the ID is invalid.
	 */
	getStringById(id) {
		return this.stringById[id];
	}

	/**
	 * Loads the string table from a pre-existing list of strings. This is used
	 * when initializing the sheet from a persistent store.
	 * @param {string[]} list The list of strings to load, in order of their IDs.
	 */
	loadFromList(list) {
		this.stringById = Array.from(list);
		this.idByString = new Map(this.stringById.map((s, i) => [s, i]));
		this.hasUnpersistedChanges = false;
	}
}
