/**
 * @file This file contains the SheetView class, which provides a filtered (and eventually sorted)
 * view over a core Sheet object without mutating the underlying data.
 */
import { FenwickTree } from '../ds/FenwickTree.js';
import { serialize2DToTSV } from '../clipboard/tsv.js';

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

		/** @type {number[] | null} */
		this.sortedRows = null; // Array of sheet row indices in visual order (after filter + sort)

		/** @type {Uint8Array | null} */
		this.rowMask = null; // 1 if visible, 0 otherwise

		/** @type {FenwickTree | null} */
		this.fenwickTree = null;

		this.visibleCount = sheet.numRows;
		this.version = 0;

		/** @type {boolean} */
		this.zeroMatch = false;

		/** @type {number} */
		this.lastDataRow = 0; // legacy global; may be superseded by per-column logic
	}
	/**
	 * Serializes a rectangular visual range to TSV using the current view ordering.
	 * @param {number} topVisualRow
	 * @param {number} leftCol
	 * @param {number} bottomVisualRow
	 * @param {number} rightCol
	 * @returns {string}
	 */
	serializeRangeToTSV(topVisualRow, leftCol, bottomVisualRow, rightCol) {
		const values = [];
		for (let vr = topVisualRow; vr <= bottomVisualRow; vr++) {
			const row = [];
			for (let c = leftCol; c <= rightCol; c++) row.push(this.getValue(vr, c));
			values.push(row);
		}
		return serialize2DToTSV(values);
	}

	/**
	 * Returns the last row index with data for a column, using immediate adjacency fallback
	 * to the left or right if the column itself has no values.
	 * @param {number} col
	 * @returns {number} last row index, or -1 if none found
	 */
	_getActiveLastRowForCol(col) {
		let last = -1;
		for (let r = this.sheet.numRows - 1; r >= 0; r--) {
			if (this.sheet.hasValue(r, col)) {
				last = r;
				break;
			}
		}
		if (last !== -1) return last;
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
		return Math.max(left, right);
	}

	/**
	 * Fallback mapping from visual index (1-based rank) to sheet row index
	 * using the current rowMask. Avoids relying solely on Fenwick for edge cases.
	 * @param {number} kOneBased
	 * @returns {number}
	 */
	_findKthVisible(kOneBased) {
		// Deprecated linear fallback removed for performance; rely on Fenwick
		return -1;
	}

	setFilters(filters) {
		this.filters = filters || [];
		this._rebuildFilter();
		// Keep sort mapping consistent with new filter results
		this._rebuildSort();
		this.version++;
	}

	setSort(sortSpec) {
		this.sortSpec = sortSpec;
		// Build/refresh view-level sort mapping instead of mutating underlying data
		this._rebuildSort();
		this.version++;
	}

	visualRowCount() {
		// If no filter/sort is active, the visual count is simply the total row count
		// from the underlying sheet. This handles cases where rows are added to the sheet
		// after the view is created. Otherwise, use the cached visibleCount.
		if (!this.rowMask && !this.sortedRows) {
			return this.sheet.numRows;
		}
		return this.visibleCount;
	}

	/**
	 * Maps a visual row index to the underlying sheet's row index.
	 * @param {number} visualIndex
	 * @returns {number}
	 */
	rowIdAt(visualIndex) {
		if (Array.isArray(this.sortedRows) && this.sortedRows.length > 0) {
			return (
				this.sortedRows[Math.max(0, Math.min(visualIndex, this.sortedRows.length - 1))] ??
				visualIndex
			);
		}
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
		if (Array.isArray(this.sortedRows) && this.sortedRows.length > 0) {
			return (
				this.sortedRows[Math.max(0, Math.min(visualIndex, this.sortedRows.length - 1))] ??
				visualIndex
			);
		}
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
		if (Array.isArray(this.sortedRows) && this.sortedRows.length > 0) {
			const rSorted = this.sortedRows[visualRow];
			if (rSorted == null || rSorted === -1) return null;
			return this.sheet.getValue(rSorted, col);
		}
		if (!this.rowMask || !this.fenwickTree) {
			return this.sheet.getValue(visualRow, col);
		}
		const r = this.fenwickTree.findKth(visualRow + 1);
		return r === -1 ? this.sheet.getValue(visualRow, col) : this.sheet.getValue(r, col);
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
			this.sortedRows = null; // reset; unsorted natural order
			this.zeroMatch = false; // ensure values render when no filters
			return;
		}

		this.rowMask = new Uint8Array(this.sheet.numRows);
		// initialize to visible, we'll compute precisely below
		this.rowMask.fill(1);
		this.fenwickTree = null;

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
						// Membership applies only within active data range; outside, it does not match.
						const activeLast = getLastRowForCol(col);
						if (activeLast === -1 || row > activeLast) return false;
						return set.has(v);
					}
				});
			} else if (f.condition && f.condition.op) {
				const op = String(f.condition.op);
				const termRaw = f.condition.term == null ? '' : String(f.condition.term);
				const term = termRaw.toLowerCase();
				const evalCond = (v, row) => {
					const activeLast = getLastRowForCol(col);
					// Only blank conditions are range-limited; others do not match out-of-range.
					if (activeLast === -1 || row > activeLast) {
						if (op === 'isBlank') return false; // out-of-range rows are not considered blank matches
						if (op === 'isNotBlank') return true; // keep tail rows when filtering not-blank
						return false; // other conditions don't match out-of-range
					}
					if (op === 'isBlank') return v == null || v === '';
					if (op === 'isNotBlank') return !(v == null || v === '');
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
			this.rowMask[r] = isVisible ? 1 : 0;
		}

		let visibleCount = 0;
		for (let r = 0; r < this.sheet.numRows; r++) if (this.rowMask[r]) visibleCount++;
		// Build fenwick in O(n) from mask
		this.fenwickTree = new FenwickTree(this.sheet.numRows, this.rowMask);

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

	_rebuildSort() {
		// If no sort specified, clear mapping
		if (!this.sortSpec || !this.sortSpec.cols || this.sortSpec.cols.length === 0) {
			this.sortedRows = null;
			return;
		}
		// If filters yielded zero visible rows, skip building mapping
		if (this.zeroMatch) {
			this.sortedRows = null;
			return;
		}
		const primary = this.sortSpec.cols[0];
		if (!primary || typeof primary.c !== 'number') {
			this.sortedRows = null;
			return;
		}
		const colIndex = primary.c;
		const dir = primary.dir === 'desc' ? 'desc' : 'asc';
		const stable = this.sortSpec.stable !== false; // default to stable
		const useMask = !!this.rowMask;

		// If a filter is active, sort ONLY visible rows across the entire sheet,
		// and keep filtered-out rows out of the view mapping entirely.
		// If no filter is active, limit to the active data range and append tail rows unchanged
		// so empty trailing rows remain intact.
		const activeLast = this._getActiveLastRowForCol(colIndex);
		const maxRowNoFilter = activeLast >= 0 ? activeLast : this.sheet.numRows - 1;

		// Build compact arrays: rows (row indices) and keys (sort keys)
		/** @type {number[]} */
		const rows = [];
		/** @type {any[]} */
		const keys = [];
		/** @type {number[]} */
		const tailVisible = [];
		if (useMask && this.rowMask) {
			// Only include visible rows within active range in the sortable set
			for (let r = 0; r <= maxRowNoFilter; r++) {
				if (!this.rowMask[r]) continue;
				rows.push(r);
				keys.push(this.sheet.getValue(r, colIndex));
			}
			// Preserve visible rows beyond the active range as tail
			for (let r = maxRowNoFilter + 1; r < this.sheet.numRows; r++) {
				if (!this.rowMask[r]) continue;
				tailVisible.push(r);
			}
		} else {
			for (let r = 0; r <= maxRowNoFilter; r++) {
				rows.push(r);
				keys.push(this.sheet.getValue(r, colIndex));
			}
			for (let r = maxRowNoFilter + 1; r < this.sheet.numRows; r++) tailVisible.push(r);
		}
		const n = rows.length;
		if (n === 1) {
			this.sortedRows = rows;
			this.visibleCount = rows.length;
			return;
		}

		// Indices into rows/keys arrays for sorting to avoid moving large values repeatedly
		/** @type {number[]} */
		const idx = new Array(n);
		for (let i = 0; i < n; i++) idx[i] = i;

		const cmpIdx = (ia, ib) => {
			const va = keys[ia];
			const vb = keys[ib];
			const aEmpty = va == null || va === '';
			const bEmpty = vb == null || vb === '';
			// Empties: first in asc, last in desc
			if (aEmpty && bEmpty) return stable ? rows[ia] - rows[ib] : 0;
			if (aEmpty !== bEmpty) return dir === 'desc' ? (aEmpty ? 1 : -1) : aEmpty ? -1 : 1;

			let base = 0;
			if (typeof va === 'number' && typeof vb === 'number') base = va - vb;
			else {
				const na = typeof va === 'string' && va.trim() !== '' ? Number(va) : NaN;
				const nb = typeof vb === 'string' && vb.trim() !== '' ? Number(vb) : NaN;
				if (!Number.isNaN(na) && !Number.isNaN(nb)) base = na - nb;
				else {
					const sa = String(va).toLowerCase();
					const sb = String(vb).toLowerCase();
					if (sa < sb) base = -1;
					else if (sa > sb) base = 1;
					else base = 0;
				}
			}
			if (base === 0) return stable ? rows[ia] - rows[ib] : 0;
			return dir === 'desc' ? -base : base;
		};
		idx.sort(cmpIdx);

		// Sorted portion is always the in-range set; append visible tail unchanged
		const sortedInRange = new Array(n);
		for (let i = 0; i < n; i++) sortedInRange[i] = rows[idx[i]];
		this.sortedRows = n > 0 ? sortedInRange.concat(tailVisible) : tailVisible;
		this.visibleCount = this.sortedRows.length;
	}

	/**
	 * Applies current sortSpec to the underlying sheet by reassigning row values
	 * for only the rows currently visible under the active filters.
	 * This operation is executed as a single transaction for undo/redo.
	 */
	_applySortAndReassignRows() {
		if (!this.sortSpec || !this.sortSpec.cols || this.sortSpec.cols.length === 0) {
			return;
		}
		// Compile comparator using the same logic as _rebuildSort
		const primary = this.sortSpec.cols[0];
		if (!primary || typeof primary.c !== 'number') return;
		const colIndex = primary.c;
		const dir = primary.dir === 'desc' ? 'desc' : 'asc';
		const stable = this.sortSpec.stable !== false; // default to stable
		/** @type {{row:number, key:any, tie:number}[]} */
		const visibleRows = [];
		const useMask = !!this.rowMask;
		if (this.zeroMatch) return;
		// Limit to active range for in-place rewrite so we don't affect tail empty rows
		const activeLast = this._getActiveLastRowForCol(colIndex);
		const maxRow = activeLast >= 0 ? activeLast : this.sheet.numRows - 1;
		for (let r = 0; r <= maxRow; r++) {
			if (useMask && !this.rowMask[r]) continue;
			const v = this.sheet.getValue(r, colIndex);
			visibleRows.push({ row: r, key: v, tie: r });
		}
		if (visibleRows.length <= 1) return;
		const cmp = (a, b) => {
			const va = a.key;
			const vb = b.key;
			const aEmpty = va == null || va === '';
			const bEmpty = vb == null || vb === '';
			// Empties: first in asc, last in desc
			if (aEmpty && bEmpty) return stable ? a.tie - b.tie : 0;
			if (aEmpty !== bEmpty) return dir === 'desc' ? (aEmpty ? 1 : -1) : aEmpty ? -1 : 1;

			let base = 0;
			if (typeof va === 'number' && typeof vb === 'number') base = va - vb;
			else {
				const na = typeof va === 'string' && va.trim() !== '' ? Number(va) : NaN;
				const nb = typeof vb === 'string' && vb.trim() !== '' ? Number(vb) : NaN;
				if (!Number.isNaN(na) && !Number.isNaN(nb)) base = na - nb;
				else {
					const sa = String(va).toLowerCase();
					const sb = String(vb).toLowerCase();
					if (sa < sb) base = -1;
					else if (sa > sb) base = 1;
					else base = 0;
				}
			}
			if (base === 0) return stable ? a.tie - b.tie : 0;
			return dir === 'desc' ? -base : base;
		};
		visibleRows.sort(cmp);
		// Targets are the original visible row indices in ascending order
		/** @type {number[]} */
		const targetRows = [];
		for (let r = 0; r <= maxRow; r++) {
			if (useMask && !this.rowMask[r]) continue;
			targetRows.push(r);
		}
		// Snapshot all source rows after sort
		const cols = this.sheet.numCols;
		const snapshots = visibleRows.map(({ row }) => this.sheet.getBlock(row, 0, row, cols - 1)[0]);
		// Apply in a single transaction
		this.sheet.transact(() => {
			// Clear destination in the active range only
			for (let i = 0; i < targetRows.length; i++) {
				const dest = targetRows[i];
				this.sheet.deleteBlock(dest, 0, dest, this.sheet.numCols - 1);
			}
			// Then write snapshots in target order for as many visible rows as we have
			for (let i = 0; i < snapshots.length && i < targetRows.length; i++) {
				const dest = targetRows[i];
				const rowValues = snapshots[i];
				this.sheet.setBlock(dest, 0, [rowValues]);
			}
		});
		// Rebuild filter structures since underlying data changed to keep mask correct
		this._rebuildFilter();
		// Clear any view-level sort mapping; data is now sorted in place
		this.sortedRows = null;
	}
}
