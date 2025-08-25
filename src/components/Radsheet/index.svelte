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
	import { localXY, yToRowInHeader } from './math.js';
	import {
		parseTSVChunked,
		serializeRangeToTSVAsync as serializeRangeToTSVAsyncImpl
	} from './workers/worker-client.js';

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

	// Column widths and helpers (variable widths)
	let colWidths = $state(columns.map(() => CELL_WIDTH));
	const MIN_COL_WIDTH = 40;
	function getColWidth(c) {
		return colWidths[c] ?? CELL_WIDTH;
	}
	function setColumnWidth(c, w) {
		colWidths[c] = Math.max(MIN_COL_WIDTH, Math.round(w));
		scheduleRender();
	}
	function colLeft(c) {
		let x = 0;
		for (let i = 0; i < c; i++) x += getColWidth(i);
		return x;
	}
	function xToColVariable(x) {
		const target = x + scrollLeft;
		let acc = 0;
		for (let c = 0; c < columns.length; c++) {
			const w = getColWidth(c);
			if (acc + w > target) return c;
			acc += w;
		}
		return columns.length - 1;
	}
	function pointToCellVariable(x, y) {
		const col = xToColVariable(x);
		const adjustedY = y + scrollTop;
		const row = Math.max(0, Math.floor(adjustedY / CELL_HEIGHT));
		return { row, col };
	}
	function getColEdgeNearX(x, threshold = 5) {
		// returns index of column to resize if near a right edge, else null
		let acc = 0;
		for (let c = 0; c < columns.length; c++) {
			const w = getColWidth(c);
			const edgeAbs = acc + w;
			const edgeLocal = edgeAbs - scrollLeft;
			if (Math.abs(edgeLocal - x) <= threshold) return c;
			acc = edgeAbs;
		}
		return null;
	}
	let measureCtx = null;
	function ensureMeasureCtx() {
		if (measureCtx) return measureCtx;
		if (typeof document === 'undefined') return null;
		const canvas = document.createElement('canvas');
		measureCtx = canvas.getContext('2d');
		return measureCtx;
	}
	function measureText(text, opts = { bold: false }) {
		const ctx = ensureMeasureCtx();
		if (!ctx) return 0;
		ctx.font = `${opts.bold ? '600 ' : ''}12px Inter, system-ui, sans-serif`;
		return ctx.measureText(String(text ?? '')).width;
	}
	function autoFitColumn(colIndex) {
		const padX = 8;
		let maxW = measureText(columns[colIndex] ?? String(colIndex), { bold: true }) + padX * 2;
		const maxRowsToScan = Math.min(sheet.numRows, 1000);
		for (let r = 0; r < maxRowsToScan; r++) {
			const v = readCell(r, colIndex);
			if (v !== '' && v != null) {
				const w = measureText(v, { bold: false }) + padX * 2;
				if (w > maxW) maxW = w;
			}
		}
		setColumnWidth(colIndex, Math.max(MIN_COL_WIDTH, Math.ceil(maxW)));
	}

	// Hover UI state for resize affordance
	let hoverResizeCol = $state(null);
	const getHoverResizeCol = () => hoverResizeCol;
	const setHoverResizeCol = (idx) => {
		hoverResizeCol = typeof idx === 'number' ? idx : null;
		scheduleRender();
	};

	// Metrics and derived viewport calculations
	const totalHeight = $derived((sheetVersion, sheet.numRows) * CELL_HEIGHT);
	const totalWidth = $derived(
		(() => {
			colWidths;
			let sum = 0;
			for (let i = 0; i < columns.length; i++) sum += getColWidth(i);
			return sum;
		})()
	);

	// Visible window (row/column indices)
	const startIndexRow = $derived(Math.floor(scrollTop / CELL_HEIGHT));
	const visibleRowCount = $derived(Math.ceil(containerHeight / CELL_HEIGHT) + 1);
	const endIndexRow = $derived(
		Math.min((sheetVersion, sheet.numRows), startIndexRow + visibleRowCount)
	);

	// Expose reactive numRows for template/props updates on addRows()
	const numRowsView = $derived((sheetVersion, sheet.numRows));
	const startIndexCol = $derived(
		(() => {
			colWidths;
			let acc = 0;
			for (let c = 0; c < columns.length; c++) {
				const w = getColWidth(c);
				if (acc + w > scrollLeft) return c;
				acc += w;
			}
			return columns.length;
		})()
	);
	const endIndexCol = $derived(
		(() => {
			colWidths;
			let left = 0;
			let start = 0;
			for (let c = 0; c < columns.length; c++) {
				const w = getColWidth(c);
				if (left + w > scrollLeft) {
					start = c;
					break;
				}
				left += w;
			}
			let x = left;
			let end = start;
			for (let c = start; c < columns.length; c++) {
				x += getColWidth(c);
				end = c + 1;
				if (x >= scrollLeft + containerWidth) break;
			}
			return Math.min(end, columns.length);
		})()
	);
	const visibleColCount = $derived(endIndexCol - startIndexCol);

	// Editor state
	let editorState = $state({
		open: false,
		row: 0,
		col: 0,
		value: '',
		seedText: null
	});

	const serializeRangeToTSVAsync = (r1, c1, r2, c2) =>
		serializeRangeToTSVAsyncImpl(readCell, r1, c1, r2, c2);

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
				getConstants,
				getColLeft: (c) => colLeft(c),
				getColWidth: (c) => getColWidth(c)
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
		editor: {
			state: editorState,
			readCell,
			writeCell,
			serializeRangeToTSV: (r1, c1, r2, c2) => sheet.serializeRangeToTSV(r1, c1, r2, c2),
			deserializeTSV: (r, c, text) => sheet.deserializeTSV(r, c, text),
			serializeRangeToTSVAsync
		},
		methods: {
			triggerRedraw: () => {
				drawHeaders();
				drawGrid();
			},
			drawHeaders: () => drawHeaders(),
			drawGrid: () => drawGrid(),
			localXY: (el, e) => localXY(el, e),
			pointToCell: (x, y) => pointToCellVariable(x, y),
			xToColInHeader: (x) => xToColVariable(x),
			getColEdgeNearX: (x, threshold) => getColEdgeNearX(x, threshold),
			setColumnWidth: (idx, w) => setColumnWidth(idx, w),
			autoFitColumn: (idx) => autoFitColumn(idx),
			getColLeft: (c) => colLeft(c),
			yToRowInHeader: (y) => yToRowInHeader(y, scrollTop, CELL_HEIGHT),
			setHoverResizeCol: (idx) => setHoverResizeCol(idx)
		},
		refs: {
			getGridCanvas: () => gridCanvas,
			getColHeadCanvas: () => colHeadCanvas,
			getRowHeadCanvas: () => rowHeadCanvas
		},
		constants: { EDGE }
	});

	const { onWheel } = viewport;

	function onPaste(e) {
		const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
		if (!text) return;
		e.preventDefault();
		// For large pastes, stream parse on worker and setBlock in chunks
		if (text.length > 200000) {
			const sel = selection.getSelection();
			const startR = sel ? sel.r1 : lastActiveRow;
			const startC = sel ? sel.c1 : lastActiveCol;
			let maxCols = 0;
			let totalRows = 0;

			parseTSVChunked(text, {
				onInit: (_totalRows, _totalCols) => {
					totalRows = _totalRows;
					maxCols = _totalCols;
				},
				onChunk: (rowOffset, values) => {
					sheet.setBlock(startR + rowOffset, startC, values);
					scheduleRender();
				},
				onDone: () => {
					const fr = startR + Math.max(0, totalRows - 1);
					const fc = startC + Math.max(0, maxCols - 1);
					selection.setRange(startR, startC, fr, fc);
					viewport.scrollCellIntoView(fr, fc);
					scheduleRender();
				}
			});
		} else {
			commandBus.dispatch({ type: 'PasteFromClipboard', payload: { text } });
		}
	}

	// Input handler
	const onKeyDown = createKeymapHandler(keymap, commandBus);

	// Renderers via centralized render context
	let renderCtx;

	// Coalesced rendering via requestAnimationFrame to reduce jank
	let renderScheduled = false;
	function drawHeadersNow() {
		if (!renderCtx) return;
		drawHeadersImpl(renderCtx.getHeaderParams());
	}
	function drawGridNow() {
		if (!renderCtx) return;
		drawGridImpl(renderCtx.getGridParams());
	}
	function scheduleRender() {
		if (renderScheduled) return;
		renderScheduled = true;
		requestAnimationFrame(() => {
			renderScheduled = false;
			drawHeadersNow();
			drawGridNow();
		});
	}

	// Backwards-compat shim for callers expecting immediate functions
	function drawHeaders() {
		scheduleRender();
	}
	function drawGrid() {
		scheduleRender();
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
		scheduleRender();
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
			isSelectionCopied: () => isSelectionCopied,
			getColWidth: (c) => getColWidth(c),
			colLeft: (c) => colLeft(c),
			getHoverResizeCol: () => hoverResizeCol
		});

		// Ensure first paint happens after render context is ready
		scheduleRender();

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

<svelte:window onkeydown={onKeyDown} onpaste={onPaste} />

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
			onpointerleave={drag.onColHeadPointerLeave}
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
			getColLeft={(c) => colLeft(c)}
			getColWidth={(c) => getColWidth(c)}
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
