<script>
	import HorizontalScrollbar from './HorizontalScrollbar.svelte';
	import VerticalScrollbar from './VerticalScrollbar.svelte';
	import { Sheet } from '../domain/sheet/sheet.js';
	import { columns } from '../domain/constants/columns.js';
	import { onMount, onDestroy } from 'svelte';
	/**
	 * Radsheet
	 *
	 * Responsibilities (high-level):
	 * - Own UI state (selection, focus, editor overlay, scroll positions)
	 * - Map pointer/keyboard events to state transitions
	 * - Delegate drawing to small, testable renderers in `components/radsheet/*`
	 * - Perform just enough math to compute the viewport and selection ranges
	 *
	 * Reactivity overview:
	 * - Primitive state: scrollTop/Left, container sizes, selection anchors/focus, sheetVersion
	 * - Derived state: total sizes, start/end indices, visible counts
	 * - Rendering: a single $effect explicitly reads all inputs that should trigger a redraw
	 *
	 * Notes:
	 * - We do not depend on transient UI flags to trigger rerenders; redraws are driven by the
	 *   above state only. This keeps rendering deterministic and easy to reason about.
	 */
	import {
		CELL_HEIGHT,
		CELL_WIDTH,
		ROW_HEADER_WIDTH,
		COLUMN_HEADER_HEIGHT,
		SCROLLBAR_SIZE,
		EDGE
	} from './radsheet/constants.js';
	import { drawHeaders as drawHeadersImpl } from './radsheet/drawHeaders.js';
	import { drawGrid as drawGridImpl } from './radsheet/drawGrid.js';

	// Domain model (source of truth for cell values)
	let sheet = $state.raw(new Sheet());

	// Viewport + layout state
	let scrollTop = $state(0);
	let scrollLeft = $state(0);
	let containerWidth = $state(0);
	let containerHeight = $state(0);
	let sheetVersion = $state(0); // bump when data changes so effect repaints

	// Canvas refs
	let gridCanvas; // main cells
	let colHeadCanvas; // column headers
	let rowHeadCanvas; // row headers

	// Selection state (anchor is where selection started, focus is the moving end)
	let selecting = $state(false);
	let dragMode = $state(null); // 'grid' | 'row' | 'col' | null
	let anchorRow = $state(null);
	let anchorCol = $state(null);
	let focusRow = $state(null);
	let focusCol = $state(null);
	let lastActiveRow = $state(0);
	let lastActiveCol = $state(0);

	// Cell access adapters to support multiple Sheet APIs
	function readCell(r, c) {
		if (sheet?.getValue) return sheet.getValue(r, c);
		if (sheet?.value) return sheet.value(r, c);
		if (sheet?.cells) return sheet.cells[`${r},${c}`] ?? '';
		return '';
	}
	function writeCell(r, c, v) {
		if (sheet?.setValue) {
			sheet.setValue(r, c, v);
		} else if (sheet?.set) {
			let ret = sheet.set(r, c, v);
			if (ret && ret !== sheet) sheet = ret; // support immutable returns
		} else if (sheet?.cells) {
			sheet.cells[`${r},${c}`] = v;
		}
		sheetVersion++;
	}

	// Editor overlay state
	let editor = $state({ open: false, row: 0, col: 0, value: '' });
	let inputEl = $state(null);

	// Persistence (optional). These are referenced in the template behind a runtime guard.
	// Define minimal defaults so the template compiles even when persistence is not wired.
	let isPersisting = $state(false);
	let lastPersistTime = $state(0);
	function saveToDisk() {
		// If the Sheet exposes a chunkStore with a persist API, call it; otherwise no-op.
		try {
			if (sheet?.chunkStore?.persist) {
				isPersisting = true;
				sheet.chunkStore.persist().finally(() => {
					isPersisting = false;
					lastPersistTime = Date.now();
				});
			}
		} catch (err) {
			isPersisting = false;
		}
	}

	onMount(() => {
		// Expose sheet API for e2e tests
		if (typeof window !== 'undefined') {
			window.__sheet = sheet;
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			if (window.__sheet === sheet) delete window.__sheet;
		}
	});

	/** Open the inline editor at the given cell. Optionally seed with initial text. */
	function openEditorAt(row, col, seedText = null) {
		scrollCellIntoView(row, col);
		anchorRow = focusRow = lastActiveRow = row;
		anchorCol = focusCol = lastActiveCol = col;
		const current = String(readCell(row, col) ?? '');
		editor.open = true;
		editor.row = row;
		editor.col = col;
		editor.value = seedText != null ? seedText : current;
		queueMicrotask(() => {
			if (!inputEl) return;
			inputEl.focus({ preventScroll: true });
			if (seedText == null)
				inputEl.select(); // replace existing by default
			else inputEl.setSelectionRange(editor.value.length, editor.value.length);
		});
		drawHeaders();
		drawGrid();
	}
	/** Commit or cancel the current edit, then redraw. */
	function commitEditor(save) {
		if (!editor.open) return;
		const { row, col, value } = editor;
		editor.open = false;
		if (save) {
			writeCell(row, col, value);
		}
		anchorRow = focusRow = lastActiveRow = row;
		anchorCol = focusCol = lastActiveCol = col;
		drawHeaders();
		drawGrid();
	}
	/** Handle editing navigation keys and commit/cancel. */
	function onEditorKeyDown(e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitEditor(true);
			// move down like spreadsheets
			moveFocusBy(1, 0);
			openEditorAt(lastActiveRow, lastActiveCol);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			commitEditor(true);
			moveFocusBy(0, 1);
			openEditorAt(lastActiveRow, lastActiveCol);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			commitEditor(true);
			moveFocusBy(0, -1);
			openEditorAt(lastActiveRow, lastActiveCol);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			commitEditor(true);
			moveFocusBy(-1, 0);
			openEditorAt(lastActiveRow, lastActiveCol);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			commitEditor(true);
			moveFocusBy(1, 0);
			openEditorAt(lastActiveRow, lastActiveCol);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			commitEditor(false);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			const dir = e.shiftKey ? -1 : 1;
			commitEditor(true);
			moveFocusBy(0, dir);
			openEditorAt(lastActiveRow, lastActiveCol);
		}
	}

	// autoscroll while dragging near edges
	let lastPointer = { x: 0, y: 0 };
	let auto = { vx: 0, vy: 0, raf: null };

	// Metrics and derived viewport calculations
	const totalHeight = $derived((sheetVersion, sheet.numRows) * CELL_HEIGHT);
	const totalWidth = $derived(columns.length * CELL_WIDTH);

	// Visible window (row/column indices)
	const startIndexRow = $derived(Math.floor(scrollTop / CELL_HEIGHT));
	const visibleRowCount = $derived(Math.ceil(containerHeight / CELL_HEIGHT) + 1);
	const endIndexRow = $derived(
		Math.min((sheetVersion, sheet.numRows), startIndexRow + visibleRowCount)
	);

	// Expose reactive numRows for template/props updates on addRows()
	const numRowsView = $derived((sheetVersion, sheet.numRows));

	const startIndexCol = $derived(Math.floor(scrollLeft / CELL_WIDTH));
	const visibleColCount = $derived(Math.ceil(containerWidth / CELL_WIDTH) + 1);
	const endIndexCol = $derived(Math.min(columns.length, startIndexCol + visibleColCount));

	// Selection helper (compute on demand)
	function getSelection() {
		if (anchorRow == null || focusRow == null) return null;
		const r1 = Math.max(0, Math.min(anchorRow, focusRow));
		const r2 = Math.min(sheet.numRows - 1, Math.max(anchorRow, focusRow));
		const c1 = Math.max(0, Math.min(anchorCol, focusCol));
		const c2 = Math.min(columns.length - 1, Math.max(anchorCol, focusCol));
		return { r1, r2, c1, c2 };
	}

	/** Clamp scroll positions to content bounds. */
	function clampScroll(newTop, newLeft) {
		const maxScrollTop = Math.max(0, totalHeight - containerHeight);
		const maxScrollLeft = Math.max(0, totalWidth - containerWidth);
		scrollTop = Math.max(0, Math.min(newTop, maxScrollTop));
		scrollLeft = Math.max(0, Math.min(newLeft, maxScrollLeft));
	}

	/** Handle wheel scrolling inside the main grid. */
	function onWheel(e) {
		e.preventDefault();
		clampScroll(scrollTop + e.deltaY, scrollLeft + e.deltaX);
	}

	// Helpers: local pointer coordinates and pixel -> cell mappers
	function localXY(el, e) {
		const r = el.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	// map pixel → cell
	function pointToCell(x, y) {
		const col = Math.floor((x + scrollLeft) / CELL_WIDTH);
		const adjustedY = y + scrollTop;
		const row = Math.max(0, Math.floor(adjustedY / CELL_HEIGHT));
		return { row, col };
	}
	function xToColInHeader(x) {
		return Math.floor((x + scrollLeft) / CELL_WIDTH);
	}
	function yToRowInHeader(y) {
		return Math.floor((y + scrollTop) / CELL_HEIGHT);
	}

	/** Begin selection drag. kind: 'grid' | 'row' | 'col' */
	function beginSelection(kind, row, col, e) {
		if (editor.open) commitEditor(true); // click elsewhere commits
		dragMode = kind; // 'grid' | 'row' | 'col'
		if (e.shiftKey) {
			anchorRow = lastActiveRow;
			anchorCol = lastActiveCol;
		} else {
			anchorRow = row;
			anchorCol = col;
		}
		// initialize focus depending on mode
		if (kind === 'row') {
			focusRow = row;
			anchorCol = 0;
			focusCol = columns.length - 1;
		} else if (kind === 'col') {
			focusCol = col;
			anchorRow = 0;
			focusRow = sheet.numRows - 1;
		} else {
			focusRow = row;
			focusCol = col;
		}
		selecting = true;
		drawHeaders();
		drawGrid();
	}

	const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

	/** Update the moving end of selection to the given row/col. */
	function updateSelectionTo(row, col) {
		if (!selecting) return;
		if (dragMode === 'row') {
			focusRow = clamp(row, 0, sheet.numRows - 1);
			focusCol = columns.length - 1; // stick to full width
		} else if (dragMode === 'col') {
			focusCol = clamp(col, 0, columns.length - 1);
			focusRow = sheet.numRows - 1; // stick to full height
		} else {
			focusRow = clamp(row, 0, sheet.numRows - 1);
			focusCol = clamp(col, 0, columns.length - 1);
		}
		drawHeaders();
		drawGrid();
	}

	/** Finish selection drag and finalize active cell. */
	function endSelection() {
		selecting = false;
		const sel = getSelection();
		if (sel) {
			// After drag selection, keep the "active" cell at the original anchor
			// so arrow navigation starts from the initially clicked cell.
			lastActiveRow = anchorRow;
			lastActiveCol = anchorCol;
		}
		stopAutoScroll();
		dragMode = null;
		drawHeaders();
		drawGrid();
	}

	// pointer handlers - GRID
	function onGridPointerDown(e) {
		gridCanvas.setPointerCapture(e.pointerId);
		const { x, y } = localXY(gridCanvas, e);
		lastPointer = { x, y };
		const { row, col } = pointToCell(x, y);
		beginSelection('grid', row, col, e);
	}
	function onGridPointerMove(e) {
		if (!selecting) return;
		const { x, y } = localXY(gridCanvas, e);
		lastPointer = { x, y };
		const { row, col } = pointToCell(x, y);
		updateSelectionTo(row, col);
		updateAutoScroll(x, y);
	}
	function onGridPointerUp(e) {
		gridCanvas.releasePointerCapture(e.pointerId);
		endSelection();
	}
	function onGridDblClick(e) {
		const { x, y } = localXY(gridCanvas, e);
		const { row, col } = pointToCell(x, y);
		openEditorAt(row, col);
	}

	// pointer handlers - COLUMN HEADER
	function onColHeadPointerDown(e) {
		colHeadCanvas.setPointerCapture(e.pointerId);
		const { x } = localXY(colHeadCanvas, e);
		lastPointer = { x, y: 0 };
		const col = xToColInHeader(x);
		beginSelection('col', 0, col, e);
	}
	function onColHeadPointerMove(e) {
		if (!selecting) return;
		const { x } = localXY(colHeadCanvas, e);
		lastPointer = { x, y: 0 };
		updateSelectionTo(0, xToColInHeader(x));
		updateAutoScroll(x, 0);
	}
	function onColHeadPointerUp(e) {
		colHeadCanvas.releasePointerCapture(e.pointerId);
		endSelection();
	}

	// pointer handlers - ROW HEADER
	function onRowHeadPointerDown(e) {
		rowHeadCanvas.setPointerCapture(e.pointerId);
		const { y } = localXY(rowHeadCanvas, e);
		lastPointer = { x: 0, y };
		const row = yToRowInHeader(y);
		beginSelection('row', row, 0, e);
	}
	function onRowHeadPointerMove(e) {
		if (!selecting) return;
		const { y } = localXY(rowHeadCanvas, e);
		lastPointer = { x: 0, y };
		updateSelectionTo(yToRowInHeader(y), 0);
		updateAutoScroll(0, y);
	}
	function onRowHeadPointerUp(e) {
		rowHeadCanvas.releasePointerCapture(e.pointerId);
		endSelection();
	}

	function handleAnyDblClick(e) {
		// Fallback: if a canvas receives a dblclick (e.g., header), open editor at current focus
		const target = e.target;
		if (target && target.tagName && target.tagName.toLowerCase() === 'canvas') {
			if (!editor.open) openEditorAt(lastActiveRow, lastActiveCol);
		}
	}

	// Auto-scroll while dragging near edges
	function edgeVelocity(pos, size) {
		if (pos < EDGE) return -Math.ceil((EDGE - pos) / 2);
		if (pos > size - EDGE) return Math.ceil((pos - (size - EDGE)) / 2);
		return 0;
	}
	function updateAutoScroll(x, y) {
		const vx = edgeVelocity(x, containerWidth);
		const vy = edgeVelocity(y, containerHeight);
		auto.vx = vx;
		auto.vy = vy;
		if ((vx || vy) && !auto.raf) {
			auto.raf = requestAnimationFrame(tickAutoScroll);
		}
		if (!vx && !vy) stopAutoScroll();
	}
	function tickAutoScroll() {
		if (!selecting) return stopAutoScroll();
		if (!auto.vx && !auto.vy) return stopAutoScroll();
		clampScroll(scrollTop + auto.vy, scrollLeft + auto.vx);
		const { row, col } = pointToCell(lastPointer.x, lastPointer.y);
		updateSelectionTo(row, col);
		auto.raf = requestAnimationFrame(tickAutoScroll);
	}
	function stopAutoScroll() {
		if (auto.raf) cancelAnimationFrame(auto.raf);
		auto.raf = null;
		auto.vx = auto.vy = 0;
	}

	// Renderers: thin wrappers that delegate to extracted modules for testability
	function drawHeaders() {
		drawHeadersImpl({
			colHeadCanvas,
			rowHeadCanvas,
			containerWidth,
			containerHeight,
			COLUMN_HEADER_HEIGHT,
			ROW_HEADER_WIDTH,
			CELL_WIDTH,
			CELL_HEIGHT,
			columns,
			scrollLeft,
			scrollTop,
			startIndexCol,
			endIndexCol,
			startIndexRow,
			endIndexRow,
			getSelection
		});
	}

	function drawGrid() {
		drawGridImpl({
			gridCanvas,
			containerWidth,
			containerHeight,
			CELL_WIDTH,
			CELL_HEIGHT,
			startIndexCol,
			endIndexCol,
			startIndexRow,
			endIndexRow,
			visibleRowCount,
			visibleColCount,
			scrollLeft,
			scrollTop,
			readCell,
			getSelection,
			anchorRow,
			anchorCol
		});
	}

	// Keyboard: Enter to edit; type to start editing; arrows to move selection
	function onKeyDown(e) {
		if (editor.open) return; // let input handle keys
		if (e.key === 'Enter') {
			openEditorAt(lastActiveRow, lastActiveCol);
			e.preventDefault();
			return;
		}
		if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
			// start typing replaces content
			openEditorAt(lastActiveRow, lastActiveCol, e.key);
			e.preventDefault();
			return;
		}
		const nav = {
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1],
			PageUp: [-visibleRowCount + 1, 0],
			PageDown: [visibleRowCount - 1, 0],
			Home: [0, -lastActiveCol],
			End: [0, columns.length]
		};
		if (e.key in nav) {
			const [dr, dc] = nav[e.key];
			moveFocusBy(dr, dc);
			e.preventDefault();
		}
	}
	function moveFocusBy(dr, dc) {
		let r = Math.min(Math.max(lastActiveRow + dr, 0), sheet.numRows - 1);
		let c = Math.min(Math.max(lastActiveCol + dc, 0), columns.length - 1);
		anchorRow = focusRow = lastActiveRow = r;
		anchorCol = focusCol = lastActiveCol = c;
		scrollCellIntoView(r, c);
		drawHeaders();
		drawGrid();
	}
	function scrollCellIntoView(r, c) {
		const cellTop = r * CELL_HEIGHT;
		const cellLeft = c * CELL_WIDTH;
		const cellBottom = cellTop + CELL_HEIGHT;
		const cellRight = cellLeft + CELL_WIDTH;
		let newTop = scrollTop;
		let newLeft = scrollLeft;
		if (cellTop < scrollTop) newTop = cellTop;
		else if (cellBottom > scrollTop + containerHeight) newTop = cellBottom - containerHeight;
		if (cellLeft < scrollLeft) newLeft = cellLeft;
		else if (cellRight > scrollLeft + containerWidth) newLeft = cellRight - containerWidth;
		clampScroll(newTop, newLeft);
	}

	// Redraw on relevant changes — explicitly read deps so $effect tracks them
	// This is the complete list of reactive inputs that cause a redraw:
	// - Selection drivers: anchorRow/Col, focusRow/Col
	// - Viewport positions/sizes: scrollTop/Left, containerWidth/Height
	// - Visible index windows: startIndexRow/Col, endIndexRow/Col
	// - Data version: sheetVersion
	$effect(() => {
		anchorRow;
		anchorCol;
		focusRow;
		focusCol; // depend on raw selection drivers
		scrollTop;
		scrollLeft;
		containerWidth;
		containerHeight;
		startIndexRow;
		startIndexCol;
		endIndexRow;
		endIndexCol;
		sheetVersion;
		drawHeaders();
		drawGrid();
	});

	function addRows() {
		sheet.addRows(1000);
		sheetVersion++;
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<div
	class="grid h-full w-full bg-white"
	style="grid-template-columns: {ROW_HEADER_WIDTH}px 1fr {SCROLLBAR_SIZE}px; grid-template-rows: {COLUMN_HEADER_HEIGHT}px 1fr {SCROLLBAR_SIZE}px;"
>
	<!-- TL corner -->
	<div class="border-r border-b border-gray-300 bg-gray-50"></div>

	<!-- Column headers -->
	<div class="relative overflow-hidden border-b border-gray-300 bg-gray-50">
		<canvas
			class="canvas absolute top-0 left-0"
			bind:this={colHeadCanvas}
			onpointerdown={onColHeadPointerDown}
			onpointermove={onColHeadPointerMove}
			onpointerup={onColHeadPointerUp}
			ondblclick={handleAnyDblClick}
			style="height: {COLUMN_HEADER_HEIGHT}px; width: 100%;"
			bind:clientWidth={containerWidth}
		></canvas>
	</div>

	<!-- top-right filler -->
	<div class="border-b border-l border-gray-300 bg-gray-50"></div>

	<!-- Row headers -->
	<div class="relative overflow-hidden border-r border-gray-300 bg-gray-50">
		<canvas
			class="canvas absolute top-0 left-0"
			bind:this={rowHeadCanvas}
			onpointerdown={onRowHeadPointerDown}
			onpointermove={onRowHeadPointerMove}
			onpointerup={onRowHeadPointerUp}
			ondblclick={handleAnyDblClick}
			style="width:{ROW_HEADER_WIDTH}px; height:100%;"
			bind:clientHeight={containerHeight}
		></canvas>
	</div>

	<!-- Main grid -->
	<div
		class="relative overflow-hidden"
		onwheel={onWheel}
		bind:clientHeight={containerHeight}
		bind:clientWidth={containerWidth}
	>
		<canvas
			class="canvas absolute top-0 left-0 z-10"
			bind:this={gridCanvas}
			onpointerdown={onGridPointerDown}
			onpointermove={onGridPointerMove}
			onpointerup={onGridPointerUp}
			ondblclick={onGridDblClick}
			style="width:100%; height:100%;"
		></canvas>

		{#if editor.open}
			<input
				class="editor absolute z-20 border-2 border-blue-500 bg-white px-2 text-sm outline-none"
				bind:this={inputEl}
				style="left: {editor.col * CELL_WIDTH - scrollLeft}px; top: {editor.row * CELL_HEIGHT -
					scrollTop}px; width: {CELL_WIDTH}px; height: {CELL_HEIGHT}px;"
				value={editor.value}
				oninput={(e) => (editor.value = e.currentTarget.value)}
				onkeydown={(e) => onEditorKeyDown(e)}
				onblur={() => commitEditor(true)}
			/>
		{/if}
	</div>

	<!-- Vertical scrollbar -->
	<VerticalScrollbar
		{scrollTop}
		{totalHeight}
		viewportHeight={containerHeight}
		onUpdate={(newTop) => clampScroll(newTop, scrollLeft)}
	/>

	<!-- BL filler -->
	<div class="border-t border-r border-gray-300 bg-gray-50"></div>

	<!-- Horizontal scrollbar -->
	<HorizontalScrollbar
		{scrollLeft}
		{totalWidth}
		{containerWidth}
		onUpdate={(newLeft) => clampScroll(scrollTop, newLeft)}
	/>

	<!-- BR filler -->
	<div class="border-t border-l border-gray-300 bg-gray-50"></div>

	<div class="col-span-3 flex items-center gap-2 p-2">
		<button class="rounded border px-2 py-1" onclick={addRows}>add 1000 rows</button>
		{#if sheet.chunkStore}
			<button class="rounded border px-2 py-1" onclick={saveToDisk}>save to disk</button>
		{/if}
		<div class="text-sm text-gray-500">
			rows: {numRowsView}, cols: {columns.length}
			{#if sheet.chunkStore}
				| cache: {Math.round(sheet.estimatedBytesInHotCache() / 1024)}KB
				{#if isPersisting}
					| saving...
				{:else if lastPersistTime > 0}
					| saved {Math.round((Date.now() - lastPersistTime) / 1000)}s ago
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.canvas {
		display: block;
		touch-action: none;
	}
	.editor {
		box-sizing: border-box;
	}
</style>
