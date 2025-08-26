/**
 * @file This file contains the SheetView class, which provides a filtered (and eventually sorted)
 * view over a core Sheet object without mutating the underlying data.
 */
import { FenwickTree } from '../ds/FenwickTree.js';

/**
 * A view on a Sheet that can be filtered and sorted without mutating the underlying data.
 * All row indices passed to its methods are "visual" rows, which are then mapped to the
 * real rows in the sheet.
 */
export class SheetView {
	/** @param {import('../sheet/sheet.js').Sheet} sheet */
	constructor(sheet) {
		this.sheet = sheet;

		/** @type {any[]} */
		this.filters = []; // Array<FilterSpec>
		this.sortSpec = null; // { cols: [{c, dir:'asc'|'desc'}], stable: true }

		/** @type {boolean[] | null} */
		this.rowMask = null; // A boolean array or bitset. True if the row is visible.

		/** @type {FenwickTree | null} */
		this.fenwickTree = null;

		this.visibleCount = sheet.numRows;
		this.version = 0;
	}

	setFilters(filters) {
		this.filters = filters;
		this._rebuildFilter();
		this.version++;
	}

	setSort(sortSpec) {
		this.sortSpec = sortSpec;
		// this._rebuildSort(); // for later
		this.version++;
	}

	visualRowCount() {
		return this.visibleCount;
	}

	/**
	 * Maps a visual row index to the underlying sheet's row index.
	 * @param {number} visualIndex
	 * @returns {number}
	 */
	rowIdAt(visualIndex) {
		if (!this.rowMask || !this.fenwickTree) {
			return visualIndex;
		}

		// Use Fenwick tree to find the k-th visible row in O(log n) time.
		// visualIndex is 0-based, findKth expects a 1-based rank.
		return this.fenwickTree.findKth(visualIndex + 1);
	}

	/**
	 * Gets a value from a cell using visual row coordinates.
	 * @param {number} visualRow
	 * @param {number} col
	 * @returns {import('../sheet/sheet.js').CellValue}
	 */
	getValue(visualRow, col) {
		const r = this.rowIdAt(visualRow);
		if (r === -1) return null;
		return this.sheet.getValue(r, col);
	}

	/**
	 * Sets a value in a cell using visual row coordinates.
	 * @param {number} visualRow
	 * @param {number} col
	 * @param {import('../sheet/sheet.js').CellValue} v
	 */
	setValue(visualRow, col, v) {
		const r = this.rowIdAt(visualRow);
		if (r === -1) return;
		this.sheet.setValue(r, col, v);
	}

	_rebuildFilter() {
		if (this.filters.length === 0) {
			this.rowMask = null;
			this.fenwickTree = null;
			this.visibleCount = this.sheet.numRows;
			return;
		}

		this.rowMask = new Array(this.sheet.numRows).fill(true);
		this.fenwickTree = new FenwickTree(this.sheet.numRows);

		const filterMaps = this.filters.map((f) => ({
			col: f.col,
			values: new Set(f.values)
		}));

		for (let r = 0; r < this.sheet.numRows; r++) {
			let isVisible = true;
			for (const filter of filterMaps) {
				const cellValue = this.sheet.getValue(r, filter.col);
				if (!filter.values.has(cellValue)) {
					isVisible = false;
					break;
				}
			}
			this.rowMask[r] = isVisible;
		}

		let visibleCount = 0;
		for (let r = 0; r < this.sheet.numRows; r++) {
			if (this.rowMask[r]) {
				visibleCount++;
				this.fenwickTree.add(r + 1, 1);
			}
		}

		this.visibleCount = visibleCount;
	}

	// _rebuildSort() { /* For later */ }
}
