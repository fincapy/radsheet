<script>
	import HorizontalScrollbar from '../HorizontalScrollbar.svelte';
	import VerticalScrollbar from '../VerticalScrollbar.svelte';
	import { Sheet } from '../../domain/sheet/sheet.js';
	import { columns } from '../../domain/constants/columns.js';
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
	} from './constants.js';
	import { drawHeaders as drawHeadersImpl } from './drawHeaders.js';
	import { drawGrid as drawGridImpl } from './drawGrid.js';
	import { createDragSelection } from './dragSelection.js';
	import { createViewportController } from './controllers/viewportController.js';

	// bump when data changes so effect repaints
	let sheetVersion = $state(0);
	const executeWithRerender = (fn) => {
		fn();
		sheetVersion++;
	};

	// Domain model (source of truth for cell values)
	let sheet = $state.raw(new Sheet());
	const readCell = (r, c) => sheet.getValue(r, c);
	const writeCell = (r, c, v) => executeWithRerender(() => sheet.setValue(r, c, v));

	// Viewport + layout state
	let scrollTop = $state(0);
	let scrollLeft = $state(0);
	let containerWidth = $state(0);
	let containerHeight = $state(0);

	// Canvas refs
	let gridCanvas; // main cells
	let colHeadCanvas; // column headers
	let rowHeadCanvas; // row headers
	let gridContainerEl; // container element for main grid area

	// Selection state (anchor is where selection started, focus is the moving end)
	let selecting = $state(false);
	let dragMode = $state(null); // 'grid' | 'row' | 'col' | null
	let anchorRow = $state(null);
	let anchorCol = $state(null);
	let focusRow = $state(null);
	let focusCol = $state(null);
	let lastActiveRow = $state(0);
	let lastActiveCol = $state(0);
	let isSelectionCopied = $state(false); // Track if selection is copied (for dotted border)

	// Editor overlay state
	let editor = $state({ open: false, row: 0, col: 0, value: '' });
	let inputEl = $state(null);
	onMount(() => {
		// Expose sheet API for e2e tests
		if (typeof window !== 'undefined') {
			window.__sheet = sheet;
		}

		const cleanupResizeObserver = viewport.setupResizeObserver(gridContainerEl);

		return () => {
			cleanupResizeObserver();
		};
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			if (window.__sheet === sheet) delete window.__sheet;
		}
	});

	/** Open the inline editor at the given cell. Optionally seed with initial text. */
	function openEditorAt(row, col, seedText = null) {
		viewport.scrollCellIntoView(row, col);
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
			e.stopPropagation();
			commitEditor(true);
			// move down like spreadsheets
			moveFocusBy(1, 0);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			e.stopPropagation();
			commitEditor(true);
			moveFocusBy(0, 1);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			e.stopPropagation();
			commitEditor(true);
			moveFocusBy(0, -1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			e.stopPropagation();
			commitEditor(true);
			moveFocusBy(-1, 0);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			e.stopPropagation();
			commitEditor(true);
			moveFocusBy(1, 0);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			commitEditor(false);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			e.stopPropagation();
			const dir = e.shiftKey ? -1 : 1;
			commitEditor(true);
			moveFocusBy(0, dir);
		}
	}

	// autoscroll while dragging near edges handled in dragSelection module

	// Viewport controller
	const viewport = createViewportController({
		getters: {
			getScrollTop: () => scrollTop,
			getScrollLeft: () => scrollLeft,
			getContainerHeight: () => containerHeight,
			getContainerWidth: () => containerWidth,
			getTotalHeight: () => totalHeight,
			getTotalWidth: () => totalWidth,
			getConstants: () => ({ CELL_HEIGHT, CELL_WIDTH })
		},
		setters: {
			setScrollTop: (v) => (scrollTop = v),
			setScrollLeft: (v) => (scrollLeft = v)
		}
	});
	const { onWheel } = viewport;

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

	function onGridDblClick(e) {
		const { x, y } = localXY(gridCanvas, e);
		const { row, col } = pointToCell(x, y);
		openEditorAt(row, col);
	}

	function handleAnyDblClick(e) {
		// Fallback: if a canvas receives a dblclick (e.g., header), open editor at current focus
		const target = e.target;
		if (target && target.tagName && target.tagName.toLowerCase() === 'canvas') {
			if (!editor.open) openEditorAt(lastActiveRow, lastActiveCol);
		}
	}

	// Drag selection module wiring
	const drag = createDragSelection({
		getters: {
			getSelecting: () => selecting,
			getDragMode: () => dragMode,
			getNumRows: () => sheet.numRows,
			getColumnsLength: () => columns.length,
			getContainerWidth: () => containerWidth,
			getContainerHeight: () => containerHeight,
			getScrollTop: () => scrollTop,
			getScrollLeft: () => scrollLeft,
			getLastActiveRow: () => lastActiveRow,
			getLastActiveCol: () => lastActiveCol,
			getAnchorRow: () => anchorRow,
			getAnchorCol: () => anchorCol
		},
		setters: {
			setSelecting: (v) => (selecting = v),
			setDragMode: (v) => (dragMode = v),
			setAnchorRow: (v) => (anchorRow = v),
			setAnchorCol: (v) => (anchorCol = v),
			setFocusRow: (v) => (focusRow = v),
			setFocusCol: (v) => (focusCol = v),
			setLastActiveRow: (v) => (lastActiveRow = v),
			setLastActiveCol: (v) => (lastActiveCol = v),
			setIsSelectionCopied: (v) => (isSelectionCopied = v)
		},
		methods: {
			isEditorOpen: () => editor.open,
			commitEditor: (save) => commitEditor(save),
			drawHeaders: () => drawHeaders(),
			drawGrid: () => drawGrid(),
			getSelection: () => getSelection(),
			clampScroll: (t, l) => viewport.clampScroll(t, l),
			localXY: (el, e) => localXY(el, e),
			pointToCell: (x, y) => pointToCell(x, y),
			xToColInHeader: (x) => xToColInHeader(x),
			yToRowInHeader: (y) => yToRowInHeader(y)
		},
		refs: {
			getGridCanvas: () => gridCanvas,
			getColHeadCanvas: () => colHeadCanvas,
			getRowHeadCanvas: () => rowHeadCanvas
		},
		constants: { EDGE }
	});

	const {
		onGridPointerDown,
		onGridPointerMove,
		onGridPointerUp,
		onColHeadPointerDown,
		onColHeadPointerMove,
		onColHeadPointerUp,
		onRowHeadPointerDown,
		onRowHeadPointerMove,
		onRowHeadPointerUp
	} = drag;

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
			anchorCol,
			isSelectionCopied
		});
	}

	// Keyboard: Enter to edit; type to start editing; arrows to move selection
	function onKeyDown(e) {
		if (editor.open) return; // let input handle keys
		if (e.key === 'Enter') {
			e.preventDefault();
			openEditorAt(lastActiveRow, lastActiveCol);
			return;
		}
		if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
			// start typing replaces content
			openEditorAt(lastActiveRow, lastActiveCol, e.key);
			e.preventDefault();
			return;
		}

		// Handle arrow keys with shift and ctrl modifiers
		const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
		if (arrowKeys.includes(e.key)) {
			e.preventDefault();

			if (e.shiftKey) {
				// Shift+Arrow: Extend selection
				if (e.ctrlKey) {
					// Ctrl+Shift+Arrow: Extend selection to edge of data
					extendSelectionToEdge(e.key);
				} else {
					// Shift+Arrow: Extend selection by one cell
					extendSelectionBy(e.key);
				}
			} else {
				// Regular arrow: Move focus (clear selection)
				const nav = {
					ArrowUp: [-1, 0],
					ArrowDown: [1, 0],
					ArrowLeft: [0, -1],
					ArrowRight: [0, 1]
				};
				const [dr, dc] = nav[e.key];
				moveFocusBy(dr, dc);
			}
			return;
		}

		// Handle copy (Ctrl+C)
		if (e.ctrlKey && e.key === 'c') {
			e.preventDefault();
			handleCopy();
			return;
		}

		// Handle other navigation keys
		const nav = {
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
		isSelectionCopied = false; // Reset copied state when selection changes
		viewport.scrollCellIntoView(r, c);
		drawHeaders();
		drawGrid();
	}

	/** Extend selection by one cell in the specified direction */
	function extendSelectionBy(key) {
		// If no selection exists, create one with current cell as anchor
		if (anchorRow === null || anchorCol === null) {
			anchorRow = lastActiveRow;
			anchorCol = lastActiveCol;
		}

		const nav = {
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1]
		};

		const [dr, dc] = nav[key];
		let newFocusRow = Math.min(Math.max(focusRow + dr, 0), sheet.numRows - 1);
		let newFocusCol = Math.min(Math.max(focusCol + dc, 0), columns.length - 1);

		focusRow = newFocusRow;
		focusCol = newFocusCol;
		lastActiveRow = newFocusRow;
		lastActiveCol = newFocusCol;

		viewport.scrollCellIntoView(newFocusRow, newFocusCol);
		drawHeaders();
		drawGrid();
	}

	/** Extend selection to the edge of data in the specified direction */
	function extendSelectionToEdge(key) {
		// If no selection exists, create one with current cell as anchor
		if (anchorRow === null || anchorCol === null) {
			anchorRow = lastActiveRow;
			anchorCol = lastActiveCol;
		}

		let newFocusRow = focusRow;
		let newFocusCol = focusCol;

		switch (key) {
			case 'ArrowUp':
				// Find the topmost row with data or go to row 0
				newFocusRow = 0;
				break;
			case 'ArrowDown':
				// Find the bottommost row with data or go to last row
				newFocusRow = sheet.numRows - 1;
				break;
			case 'ArrowLeft':
				// Find the leftmost column with data or go to column 0
				newFocusCol = 0;
				break;
			case 'ArrowRight':
				// Find the rightmost column with data or go to last column
				newFocusCol = columns.length - 1;
				break;
		}

		focusRow = newFocusRow;
		focusCol = newFocusCol;
		lastActiveRow = newFocusRow;
		lastActiveCol = newFocusCol;

		viewport.scrollCellIntoView(newFocusRow, newFocusCol);
		drawHeaders();
		drawGrid();
	}

	/** Handle copy operation - sets selection border to dotted */
	function handleCopy() {
		const sel = getSelection();
		if (sel) {
			isSelectionCopied = true;
			drawHeaders();
			drawGrid();
		}
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
		isSelectionCopied; // depend on copy state
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
		></canvas>
	</div>

	<!-- Main grid -->
	<div
		class="relative overflow-hidden"
		onwheel={onWheel}
		bind:this={gridContainerEl}
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
		onUpdate={(newTop) => viewport.clampScroll(newTop, scrollLeft)}
	/>

	<!-- BL filler -->
	<div class="border-t border-r border-gray-300 bg-gray-50"></div>

	<!-- Horizontal scrollbar -->
	<HorizontalScrollbar
		{scrollLeft}
		{totalWidth}
		{containerWidth}
		onUpdate={(newLeft) => viewport.clampScroll(scrollTop, newLeft)}
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
