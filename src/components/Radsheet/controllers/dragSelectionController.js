// Drag selection controller
// Exports a factory that encapsulates drag state and handlers while delegating
// mutations back to the caller via provided getters/setters to preserve Svelte reactivity.

export function createDragSelectionController({ getters, setters, methods, refs, constants }) {
	let lastPointer = { x: 0, y: 0 };
	let auto = { vx: 0, vy: 0, raf: null };
	let resizing = { active: false, colIndex: -1, startX: 0, startWidth: 0 };
	let rowResizing = { active: false, rowIndex: -1, startY: 0, startHeight: 0 };

	function beginSelection(kind, row, col, e) {
		if (methods.isEditorOpen()) methods.commitEditor(true);
		setters.setDragMode(kind);
		if (e.shiftKey) {
			setters.setAnchorRow(getters.getLastActiveRow());
			setters.setAnchorCol(getters.getLastActiveCol());
		} else {
			setters.setAnchorRow(row);
			setters.setAnchorCol(col);
		}
		if (kind === 'row') {
			setters.setFocusRow(row);
			setters.setAnchorCol(0);
			setters.setFocusCol(getters.getColumnsLength() - 1);
		} else if (kind === 'col') {
			setters.setFocusCol(col);
			setters.setAnchorRow(0);
			setters.setFocusRow(getters.getNumRows() - 1);
		} else {
			setters.setFocusRow(row);
			setters.setFocusCol(col);
		}
		setters.setIsSelectionCopied(false);
		setters.setSelecting(true);
		methods.drawHeaders();
		methods.drawGrid();
	}

	const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

	function updateSelectionTo(row, col) {
		if (!getters.getSelecting()) return;
		if (getters.getDragMode && getters.getDragMode() === 'row') {
			setters.setFocusRow(clamp(row, 0, getters.getNumRows() - 1));
			setters.setFocusCol(getters.getColumnsLength() - 1);
		} else if (getters.getDragMode && getters.getDragMode() === 'col') {
			setters.setFocusCol(clamp(col, 0, getters.getColumnsLength() - 1));
			setters.setFocusRow(getters.getNumRows() - 1);
		} else {
			setters.setFocusRow(clamp(row, 0, getters.getNumRows() - 1));
			setters.setFocusCol(clamp(col, 0, getters.getColumnsLength() - 1));
		}
		methods.drawHeaders();
		methods.drawGrid();
	}

	function endSelection() {
		setters.setSelecting(false);
		const sel = methods.getSelection ? methods.getSelection() : null;
		if (sel) {
			setters.setLastActiveRow(getters.getAnchorRow());
			setters.setLastActiveCol(getters.getAnchorCol());
		}
		stopAutoScroll();
		setters.setDragMode(null);
		methods.drawHeaders();
		methods.drawGrid();
	}

	function edgeVelocity(pos, size) {
		const EDGE = constants.EDGE;
		if (pos < EDGE) return -Math.ceil((EDGE - pos) / 2);
		if (pos > size - EDGE) return Math.ceil((pos - (size - EDGE)) / 2);
		return 0;
	}

	function updateAutoScroll(x, y) {
		const vx = edgeVelocity(x, getters.getContainerWidth());
		const vy = edgeVelocity(y, getters.getContainerHeight());
		auto.vx = vx;
		auto.vy = vy;
		if ((vx || vy) && !auto.raf) {
			auto.raf = requestAnimationFrame(tickAutoScroll);
		}
		if (!vx && !vy) stopAutoScroll();
	}

	function tickAutoScroll() {
		if (!getters.getSelecting()) return stopAutoScroll();
		if (!auto.vx && !auto.vy) return stopAutoScroll();
		methods.clampScroll(getters.getScrollTop() + auto.vy, getters.getScrollLeft() + auto.vx);
		const { row, col } = methods.pointToCell(lastPointer.x, lastPointer.y);
		updateSelectionTo(row, col);
		auto.raf = requestAnimationFrame(tickAutoScroll);
	}

	function stopAutoScroll() {
		if (auto.raf) cancelAnimationFrame(auto.raf);
		auto.raf = null;
		auto.vx = auto.vy = 0;
	}

	// Pointer handlers - GRID
	function onGridPointerDown(e) {
		const canvas = refs.getGridCanvas();
		// Right-click: preserve existing range selection; if single-cell selection, move it
		if (e && e.button === 2) {
			const { x, y } = methods.localXY(canvas, e);
			lastPointer = { x, y };
			const { row, col } = methods.pointToCell(x, y);
			const sel = methods.getSelection ? methods.getSelection() : null;
			const isRange = !!(sel && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2));
			const isInsideRange = !!(
				sel &&
				row >= sel.r1 &&
				row <= sel.r2 &&
				col >= sel.c1 &&
				col <= sel.c2
			);
			// If not a range, or click is outside current range, move selection
			if (!isRange || !isInsideRange) {
				// Move single selection to the right-clicked cell
				setters.setAnchorRow(row);
				setters.setAnchorCol(col);
				setters.setFocusRow(row);
				setters.setFocusCol(col);
				setters.setLastActiveRow(row);
				setters.setLastActiveCol(col);
				setters.setIsSelectionCopied(false);
				methods.drawHeaders();
				methods.drawGrid();
			}
			return; // Do not start drag selection on right-click
		}
		canvas.setPointerCapture(e.pointerId);
		const { x, y } = methods.localXY(canvas, e);
		lastPointer = { x, y };
		const { row, col } = methods.pointToCell(x, y);
		beginSelection('grid', row, col, e);
	}
	function onGridPointerMove(e) {
		if (!getters.getSelecting()) return;
		const canvas = refs.getGridCanvas();
		const { x, y } = methods.localXY(canvas, e);
		lastPointer = { x, y };
		const { row, col } = methods.pointToCell(x, y);
		updateSelectionTo(row, col);
		updateAutoScroll(x, y);
	}
	function onGridPointerUp(e) {
		const canvas = refs.getGridCanvas();
		canvas.releasePointerCapture(e.pointerId);
		endSelection();
	}

	// Pointer handlers - COLUMN HEADER
	function onColHeadPointerDown(e) {
		const canvas = refs.getColHeadCanvas();
		// Ignore right-click to preserve existing selection
		if (e && e.button === 2) {
			return;
		}
		canvas.setPointerCapture(e.pointerId);
		const { x } = methods.localXY(canvas, e);
		lastPointer = { x, y: 0 };
		// Check resize hotspot near right edge
		const hitCol = methods.getColEdgeNearX ? methods.getColEdgeNearX(x, 5) : null;
		if (hitCol != null) {
			resizing = {
				active: true,
				colIndex: hitCol,
				startX: x,
				startWidth: methods.getColLeft(hitCol + 1) - methods.getColLeft(hitCol)
			};
			return;
		}
		const col = methods.xToColInHeader(x);
		// If near the filter icon area on the right side of the header cell, open filter popover
		if (methods.openFilterForColumn) {
			const rightAbs = methods.getColLeft(col + 1);
			const rightLocal = rightAbs - getters.getScrollLeft();
			if (x >= rightLocal - 24 && x <= rightLocal - 4) {
				// Only open if filtering UI is enabled
				if (methods.isFilteringEnabled && methods.isFilteringEnabled()) {
					methods.openFilterForColumn(col);
					return;
				}
				return;
			}
		}
		beginSelection('col', 0, col, e);
	}
	function onColHeadPointerMove(e) {
		if (e && e.target && e.target.closest && e.target.closest('[data-rs-filter-popover]')) return;
		const canvasMove = refs.getColHeadCanvas();
		const { x } = methods.localXY(canvasMove, e);
		lastPointer = { x, y: 0 };
		// Update hover indicator and cursor
		if (!getters.getSelecting() && !resizing.active) {
			const hit = methods.getColEdgeNearX ? methods.getColEdgeNearX(x, 5) : null;
			methods.setHoverResizeCol(hit);
			// Determine if hovering over filter icon area for the current column
			let cursor = 'default';
			if (hit != null) {
				cursor = 'col-resize';
			} else if (methods.getColLeft && getters.getScrollLeft != null) {
				const col = methods.xToColInHeader(x);
				const rightAbs = methods.getColLeft(col + 1);
				const rightLocal = rightAbs - getters.getScrollLeft();
				if (
					x >= rightLocal - 24 &&
					x <= rightLocal - 4 &&
					methods.isFilteringEnabled &&
					methods.isFilteringEnabled()
				) {
					cursor = 'pointer';
				}
			}
			if (canvasMove && canvasMove.style) {
				canvasMove.style.cursor = cursor;
			}
		}
		if (resizing.active) {
			const dx = x - resizing.startX;
			methods.setColumnWidth(resizing.colIndex, Math.max(40, resizing.startWidth + dx));
			methods.drawHeaders();
			methods.drawGrid();
			return;
		}
		if (!getters.getSelecting()) return;
		updateSelectionTo(0, methods.xToColInHeader(x));
		updateAutoScroll(x, 0);
	}

	function onColHeadPointerLeave() {
		const canvas = refs.getColHeadCanvas();
		methods.setHoverResizeCol(null);
		if (canvas && canvas.style) canvas.style.cursor = 'default';
	}
	function onColHeadPointerUp(e) {
		const canvas = refs.getColHeadCanvas();
		// Always release pointer capture; event may end over popover
		try {
			canvas.releasePointerCapture(e.pointerId);
		} catch {}
		if (e && e.target && e.target.closest && e.target.closest('[data-rs-filter-popover]')) return;
		if (resizing.active) {
			resizing = { active: false, colIndex: -1, startX: 0, startWidth: 0 };
			methods.setHoverResizeCol(null);
			if (canvas && canvas.style) canvas.style.cursor = 'default';
			return;
		}
		endSelection();
	}

	// Pointer handlers - ROW HEADER
	function onRowHeadPointerDown(e) {
		const canvas = refs.getRowHeadCanvas();
		// Ignore right-click to preserve existing selection
		if (e && e.button === 2) {
			return;
		}
		canvas.setPointerCapture(e.pointerId);
		const { y } = methods.localXY(canvas, e);
		lastPointer = { x: 0, y };
		// Check resize hotspot near bottom edge
		const hitRow = methods.getRowEdgeNearY ? methods.getRowEdgeNearY(y, 5) : null;
		if (hitRow != null) {
			rowResizing = {
				active: true,
				rowIndex: hitRow,
				startY: y,
				startHeight: methods.getRowTop(hitRow + 1) - methods.getRowTop(hitRow)
			};
			if (canvas && canvas.style) canvas.style.cursor = 'row-resize';
			return;
		}
		const row = methods.yToRowInHeader(y);
		beginSelection('row', row, 0, e);
	}
	function onRowHeadPointerMove(e) {
		const canvas = refs.getRowHeadCanvas();
		const { y } = methods.localXY(canvas, e);
		lastPointer = { x: 0, y };
		if (!getters.getSelecting() && !rowResizing.active) {
			const hit = methods.getRowEdgeNearY ? methods.getRowEdgeNearY(y, 5) : null;
			if (canvas && canvas.style) canvas.style.cursor = hit != null ? 'row-resize' : 'default';
		}
		if (rowResizing.active) {
			const dy = y - rowResizing.startY;
			methods.setRowHeight(rowResizing.rowIndex, Math.max(18, rowResizing.startHeight + dy));
			methods.drawHeaders();
			methods.drawGrid();
			return;
		}
		if (!getters.getSelecting()) return;
		updateSelectionTo(methods.yToRowInHeader(y), 0);
		updateAutoScroll(0, y);
	}
	function onRowHeadPointerUp(e) {
		const canvas = refs.getRowHeadCanvas();
		canvas.releasePointerCapture(e.pointerId);
		if (rowResizing.active) {
			rowResizing = { active: false, rowIndex: -1, startY: 0, startHeight: 0 };
			if (canvas && canvas.style) canvas.style.cursor = 'default';
			return;
		}
		endSelection();
	}

	function onRowHeadPointerLeave() {
		const canvas = refs.getRowHeadCanvas();
		if (canvas && canvas.style) canvas.style.cursor = 'default';
	}

	return {
		beginSelection,
		updateSelectionTo,
		endSelection,
		onGridPointerDown,
		onGridPointerMove,
		onGridPointerUp,
		onColHeadPointerDown,
		onColHeadPointerMove,
		onColHeadPointerUp,
		onColHeadPointerLeave,
		onRowHeadPointerDown,
		onRowHeadPointerMove,
		onRowHeadPointerUp,
		onRowHeadPointerLeave
	};
}
