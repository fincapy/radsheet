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

		/** @type {boolean} */
		this.zeroMatch = false;

		/** @type {number} */
		this.lastDataRow = 0; // legacy global; may be superseded by per-column logic
	}

	setFilters(filters) {
		this.filters = filters || [];
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
		if (this.zeroMatch) return visualIndex;
		return this.fenwickTree.findKth(visualIndex + 1);
	}

	/**
	 * Row mapping for write operations. If filtering hides all rows, allow writing
	 * directly to the unfiltered row index corresponding to the visual index.
	 * @param {number} visualIndex
	 * @returns {number}
	 */
	rowIdAtForWrite(visualIndex) {
		if (this.zeroMatch) return visualIndex;
		if (!this.rowMask || !this.fenwickTree) {
			return visualIndex;
		}
		return this.fenwickTree.findKth(visualIndex + 1);
	}

	/**
	 * Gets a value from a cell using visual row coordinates.
	 * @param {number} visualRow
	 * @param {number} col
	 * @returns {import('../sheet/sheet.js').CellValue}
	 */
	getValue(visualRow, col) {
		if (this.zeroMatch) return null;
		if (!this.rowMask || !this.fenwickTree) {
			return this.sheet.getValue(visualRow, col);
		}
		const r = this.fenwickTree.findKth(visualRow + 1);
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
		const r = this.rowIdAtForWrite(visualRow);
		if (r === -1) return;
		this.sheet.setValue(r, col, v);
	}

	_rebuildFilter() {
		if (!this.filters || this.filters.length === 0) {
			this.rowMask = null;
			this.fenwickTree = null;
			this.visibleCount = this.sheet.numRows;
			return;
		}

		this.rowMask = new Array(this.sheet.numRows).fill(true);
		this.fenwickTree = new FenwickTree(this.sheet.numRows);

		// Build per-column last active row, with adjacency fallback
		/** @type {Map<number, number>} */
		const lastRowByCol = new Map();
		const getLastRowForCol = (col) => {
			if (lastRowByCol.has(col)) return lastRowByCol.get(col);
			let last = -1;
			for (let r = this.sheet.numRows - 1; r >= 0; r--) {
				if (this.sheet.hasValue(r, col)) {
					last = r;
					break;
				}
			}
			// If column has no values, fallback to immediate adjacent columns
			if (last === -1) {
				let left = -1;
				if (col - 1 >= 0) {
					for (let r = this.sheet.numRows - 1; r >= 0; r--) {
						if (this.sheet.hasValue(r, col - 1)) {
							left = r;
							break;
						}
					}
				}
				let right = -1;
				if (col + 1 < this.sheet.numCols) {
					for (let r = this.sheet.numRows - 1; r >= 0; r--) {
						if (this.sheet.hasValue(r, col + 1)) {
							right = r;
							break;
						}
					}
				}
				last = Math.max(left, right);
			}
			lastRowByCol.set(col, last);
			return last;
		};

		// Normalize filters to evaluators per column
		/** @type {{ col:number, evaluator: (v:any, row:number)=>boolean }[]} */
		const compiled = [];
		for (const f of this.filters) {
			if (!f) continue;
			const col = f.col;
			if (Array.isArray(f.values)) {
				const set = new Set(f.values);
				compiled.push({
					col,
					evaluator: (v, row) => {
						const activeLast = getLastRowForCol(col);
						if ((v == null || v === '') && activeLast !== -1 && row > activeLast) return true;
						return set.has(v);
					}
				});
			} else if (f.condition && f.condition.op) {
				const op = String(f.condition.op);
				const termRaw = f.condition.term == null ? '' : String(f.condition.term);
				const term = termRaw.toLowerCase();
				const evalCond = (v, row) => {
					const activeLast = getLastRowForCol(col);
					if (op === 'isBlank')
						return v == null || v === '' || (activeLast !== -1 && row > activeLast);
					if (op === 'isNotBlank') {
						if (activeLast !== -1 && row > activeLast && (v == null || v === '')) return true;
						return !(v == null || v === '');
					}
					const s = String(v ?? '').toLowerCase();
					if (op === 'contains') return s.includes(term);
					if (op === 'equals') return s === term;
					if (op === 'startsWith') return s.startsWith(term);
					if (op === 'endsWith') return s.endsWith(term);
					return true;
				};
				compiled.push({ col, evaluator: evalCond });
			}
		}

		for (let r = 0; r < this.sheet.numRows; r++) {
			let isVisible = true;
			for (let i = 0; i < compiled.length; i++) {
				const spec = compiled[i];
				const cellValue = this.sheet.getValue(r, spec.col);
				if (!spec.evaluator(cellValue, r)) {
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

		if (visibleCount === 0) {
			this.zeroMatch = true;
			this.rowMask = null;
			this.fenwickTree = null;
			this.visibleCount = this.sheet.numRows;
			return;
		}

		this.zeroMatch = false;
		this.visibleCount = visibleCount;
	}

	// _rebuildSort() { /* For later */ }
}
