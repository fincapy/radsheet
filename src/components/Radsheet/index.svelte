<script>
	import HorizontalScrollbar from '../HorizontalScrollbar.svelte';
	import VerticalScrollbar from '../VerticalScrollbar.svelte';
	import { Sheet } from '../../domain/sheet/sheet.js';
	import { columns } from '../../domain/constants/columns.js';
	import { onMount, onDestroy } from 'svelte';
	import {
		CELL_HEIGHT,
		CELL_WIDTH,
		ROW_HEADER_WIDTH,
		COLUMN_HEADER_HEIGHT,
		SCROLLBAR_SIZE,
		EDGE
	} from './constants.js';
	import { drawHeaders as drawHeadersImpl } from './render/drawHeaders.js';
	import { drawGrid as drawGridImpl } from './render/drawGrid.js';
	import { setupControllers } from './controllers/setupControllers.js';
	import { keymap, createKeymapHandler } from './commands/keymap.js';
	import { createRenderContext } from './render/createRenderContext.js';
	import EditorOverlay from '../EditorOverlay.svelte';
	import { localXY, pointToCell, xToColInHeader, yToRowInHeader } from './math.js';

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
	const addRows = () => executeWithRerender(() => sheet.addRows(1000));

	// Viewport + layout state
	let scrollTop = $state(0);
	let scrollLeft = $state(0);
	let containerWidth = $state(0);
	let containerHeight = $state(0);

	// Viewport getters/setters
	const getScrollTop = () => scrollTop;
	const getScrollLeft = () => scrollLeft;
	const getContainerHeight = () => containerHeight;
	const getContainerWidth = () => containerWidth;
	const getTotalHeight = () => totalHeight;
	const getTotalWidth = () => totalWidth;
	const getConstants = () => ({ CELL_HEIGHT, CELL_WIDTH });
	const setScrollTop = (v) => (scrollTop = v);
	const setScrollLeft = (v) => (scrollLeft = v);

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

	// Selection getters/setters
	const getSelecting = () => selecting;
	const getDragMode = () => dragMode;
	const getAnchorRow = () => anchorRow;
	const getAnchorCol = () => anchorCol;
	const getFocusRow = () => focusRow;
	const getFocusCol = () => focusCol;
	const getLastActiveRow = () => lastActiveRow;
	const getLastActiveCol = () => lastActiveCol;
	const getSheetNumRows = () => sheet.numRows;
	const getNumRows = () => sheet.numRows;
	const getColumnsLength = () => columns.length;
	const setSelecting = (v) => (selecting = v);
	const setDragMode = (v) => (dragMode = v);
	const setAnchorRow = (v) => (anchorRow = v);
	const setAnchorCol = (v) => (anchorCol = v);
	const setFocusRow = (v) => (focusRow = v);
	const setFocusCol = (v) => (focusCol = v);
	const setLastActiveRow = (v) => (lastActiveRow = v);
	const setLastActiveCol = (v) => (lastActiveCol = v);
	const setIsSelectionCopied = (v) => (isSelectionCopied = v);

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

	// Editor state
	let editorState = $state({
		open: false,
		row: 0,
		col: 0,
		value: '',
		seedText: null
	});

	// Controllers setup
	const { viewport, selection, commandBus, drag, dbl } = setupControllers({
		viewport: {
			getters: {
				getScrollTop,
				getScrollLeft,
				getContainerHeight,
				getContainerWidth,
				getTotalHeight,
				getTotalWidth,
				getConstants
			},
			setters: { setScrollTop, setScrollLeft }
		},
		selection: {
			getters: {
				getSelecting,
				getDragMode,
				getAnchorRow,
				getAnchorCol,
				getFocusRow,
				getFocusCol,
				getLastActiveRow,
				getLastActiveCol,
				getSheetNumRows,
				getColumnsLength,
				getNumRows
			},
			setters: {
				setSelecting,
				setDragMode,
				setAnchorRow,
				setAnchorCol,
				setFocusRow,
				setFocusCol,
				setLastActiveRow,
				setLastActiveCol,
				setIsSelectionCopied
			}
		},
		editor: { state: editorState, readCell, writeCell },
		methods: {
			triggerRedraw: () => {
				drawHeaders();
				drawGrid();
			},
			drawHeaders: () => drawHeaders(),
			drawGrid: () => drawGrid(),
			localXY: (el, e) => localXY(el, e),
			pointToCell: (x, y) => pointToCell(x, y, scrollLeft, scrollTop, CELL_WIDTH, CELL_HEIGHT),
			xToColInHeader: (x) => xToColInHeader(x, scrollLeft, CELL_WIDTH),
			yToRowInHeader: (y) => yToRowInHeader(y, scrollTop, CELL_HEIGHT)
		},
		refs: {
			getGridCanvas: () => gridCanvas,
			getColHeadCanvas: () => colHeadCanvas,
			getRowHeadCanvas: () => rowHeadCanvas
		},
		constants: { EDGE }
	});

	const { onWheel } = viewport;

	// Input handler
	const onKeyDown = createKeymapHandler(keymap, commandBus);

	// Renderers via centralized render context
	let renderCtx;

	function drawHeaders() {
		if (!renderCtx) return;
		drawHeadersImpl(renderCtx.getHeaderParams());
	}

	function drawGrid() {
		if (!renderCtx) return;
		drawGridImpl(renderCtx.getGridParams());
	}

	// Redraw on relevant changes
	$effect(() => {
		anchorRow;
		anchorCol;
		focusRow;
		focusCol;
		isSelectionCopied;
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

	onMount(() => {
		if (typeof window !== 'undefined') {
			window.__sheet = sheet;
		}

		const cleanupResizeObserver = viewport.setupResizeObserver(gridContainerEl);

		// Initialize render context when refs available
		renderCtx = createRenderContext({
			gridCanvas: () => gridCanvas,
			colHeadCanvas: () => colHeadCanvas,
			rowHeadCanvas: () => rowHeadCanvas,
			containerWidth: () => containerWidth,
			containerHeight: () => containerHeight,
			CELL_WIDTH,
			CELL_HEIGHT,
			COLUMN_HEADER_HEIGHT,
			ROW_HEADER_WIDTH,
			columns,
			scrollLeft: () => scrollLeft,
			scrollTop: () => scrollTop,
			startIndexCol: () => startIndexCol,
			endIndexCol: () => endIndexCol,
			startIndexRow: () => startIndexRow,
			endIndexRow: () => endIndexRow,
			visibleRowCount: () => visibleRowCount,
			visibleColCount: () => visibleColCount,
			readCell,
			getSelection: () => selection.getSelection(),
			anchorRow: () => anchorRow,
			anchorCol: () => anchorCol,
			isSelectionCopied: () => isSelectionCopied
		});

		// Ensure first paint happens after render context is ready
		drawHeaders();
		drawGrid();

		return () => {
			cleanupResizeObserver();
		};
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') {
			if (window.__sheet === sheet) delete window.__sheet;
		}
	});
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
			onpointerdown={drag.onColHeadPointerDown}
			onpointermove={drag.onColHeadPointerMove}
			onpointerup={drag.onColHeadPointerUp}
			ondblclick={dbl.onAnyDblClick}
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
			onpointerdown={drag.onRowHeadPointerDown}
			onpointermove={drag.onRowHeadPointerMove}
			onpointerup={drag.onRowHeadPointerUp}
			ondblclick={dbl.onAnyDblClick}
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
			onpointerdown={drag.onGridPointerDown}
			onpointermove={drag.onGridPointerMove}
			onpointerup={drag.onGridPointerUp}
			ondblclick={dbl.onGridDblClick}
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
