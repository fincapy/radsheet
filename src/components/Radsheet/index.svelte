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
	import { createSelectionController } from './controllers/selectionController.js';
	import { createCommandBus } from './commands/commandBus.js';
	import { keymap, createKeymapHandler } from './input/keymap.js';
	import { createEditorController } from './controllers/editorController.js';
	import EditorOverlay from '../EditorOverlay.svelte';

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

	// autoscroll while dragging near edges handled in dragSelection module

	// Editor state
	let editorState = $state({
		open: false,
		row: 0,
		col: 0,
		value: '',
		seedText: null
	});

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

	// Selection controller
	const selection = createSelectionController({
		getters: {
			getAnchorRow: () => anchorRow,
			getAnchorCol: () => anchorCol,
			getFocusRow: () => focusRow,
			getFocusCol: () => focusCol,
			getLastActiveRow: () => lastActiveRow,
			getLastActiveCol: () => lastActiveCol,
			getSheetNumRows: () => sheet.numRows,
			getColumnsLength: () => columns.length
		},
		setters: {
			setAnchorRow: (v) => (anchorRow = v),
			setAnchorCol: (v) => (anchorCol = v),
			setFocusRow: (v) => (focusRow = v),
			setFocusCol: (v) => (focusCol = v),
			setLastActiveRow: (v) => (lastActiveRow = v),
			setLastActiveCol: (v) => (lastActiveCol = v),
			setIsSelectionCopied: (v) => (isSelectionCopied = v)
		},
		controllers: {
			viewport
		}
	});

	// Editor Controller
	const editorController = createEditorController({
		editorState,
		getters: {
			readCell
		},
		setters: {
			writeCell
		},
		controllers: {
			viewport,
			selection
		}
	});

	// Command Bus
	const commandBus = createCommandBus({
		getters: {
			isEditorOpen: () => editorController.isEditorOpen(),
			getLastActiveRow: () => lastActiveRow,
			getLastActiveCol: () => lastActiveCol,
			getContainerHeight: () => containerHeight,
			getConstants: () => ({ CELL_HEIGHT, CELL_WIDTH }),
			getColumnsLength: () => columns.length
		},
		setters: {
			handleCopy,
			triggerRedraw: () => {
				drawHeaders();
				drawGrid();
			}
		},
		controllers: {
			selection,
			editor: editorController
		}
	});

	// Input handler
	const onKeyDown = createKeymapHandler(keymap, commandBus);

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
		commandBus.dispatch({ type: 'OpenEditorAtFocus', payload: { row, col } });
	}

	function handleAnyDblClick(e) {
		// Fallback: if a canvas receives a dblclick (e.g., header), open editor at current focus
		const target = e.target;
		if (target && target.tagName && target.tagName.toLowerCase() === 'canvas') {
			if (!editorController.isEditorOpen()) commandBus.dispatch({ type: 'OpenEditorAtFocus' });
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
			isEditorOpen: () => editorController.isEditorOpen(),
			commitEditor: (save) => editorController.commitEditor(save),
			drawHeaders: () => drawHeaders(),
			drawGrid: () => drawGrid(),
			getSelection: () => selection.getSelection(),
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

	/** Handle copy operation - sets selection border to dotted */
	function handleCopy() {
		const sel = selection.getSelection();
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

		<EditorOverlay
			{editorState}
			commandBus={{ dispatch: commandBus.dispatch, handleKeyDown: onKeyDown }}
			{CELL_WIDTH}
			{CELL_HEIGHT}
			{scrollLeft}
			{scrollTop}
		/>
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
</style>
