// Drag selection controller
// Exports a factory that encapsulates drag state and handlers while delegating
// mutations back to the caller via provided getters/setters to preserve Svelte reactivity.

export function createDragSelectionController({ getters, setters, methods, refs, constants }) {
	let lastPointer = { x: 0, y: 0 };
	let auto = { vx: 0, vy: 0, raf: null };

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
		canvas.setPointerCapture(e.pointerId);
		const { x } = methods.localXY(canvas, e);
		lastPointer = { x, y: 0 };
		const col = methods.xToColInHeader(x);
		beginSelection('col', 0, col, e);
	}
	function onColHeadPointerMove(e) {
		if (!getters.getSelecting()) return;
		const canvas = refs.getColHeadCanvas();
		const { x } = methods.localXY(canvas, e);
		lastPointer = { x, y: 0 };
		updateSelectionTo(0, methods.xToColInHeader(x));
		updateAutoScroll(x, 0);
	}
	function onColHeadPointerUp(e) {
		const canvas = refs.getColHeadCanvas();
		canvas.releasePointerCapture(e.pointerId);
		endSelection();
	}

	// Pointer handlers - ROW HEADER
	function onRowHeadPointerDown(e) {
		const canvas = refs.getRowHeadCanvas();
		canvas.setPointerCapture(e.pointerId);
		const { y } = methods.localXY(canvas, e);
		lastPointer = { x: 0, y };
		const row = methods.yToRowInHeader(y);
		beginSelection('row', row, 0, e);
	}
	function onRowHeadPointerMove(e) {
		if (!getters.getSelecting()) return;
		const canvas = refs.getRowHeadCanvas();
		const { y } = methods.localXY(canvas, e);
		lastPointer = { x: 0, y };
		updateSelectionTo(methods.yToRowInHeader(y), 0);
		updateAutoScroll(0, y);
	}
	function onRowHeadPointerUp(e) {
		const canvas = refs.getRowHeadCanvas();
		canvas.releasePointerCapture(e.pointerId);
		endSelection();
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
		onRowHeadPointerDown,
		onRowHeadPointerMove,
		onRowHeadPointerUp
	};
}
