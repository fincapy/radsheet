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
	import { resolveTheme } from './theme.js';
	let { theme: themeInput = 'light', data: dataInput } = $props();
	let resolvedTheme = $state(resolveTheme(themeInput));

	$effect(() => {
		setData(dataInput);
		console.log('sheet', sheet.numRows, sheet.numCols);
	});

	$effect(() => {
		themeInput;
		resolvedTheme = resolveTheme(themeInput);
	});
	const cssVars = $derived(
		(() => {
			const t = resolvedTheme;
			return `
			--rs-surface-bg: ${t.surface.background};
			--rs-header-bg: ${t.header.background};
			--rs-header-text: ${t.header.text};
			--rs-header-grid: ${t.header.gridLine};
			--rs-border: ${t.header.border};
			--rs-grid-line: ${t.grid.lineColor};
			--rs-grid-text: ${t.grid.text};
			--rs-selection-stroke: ${t.selection.stroke};
			--rs-selection-fill-grid: ${t.selection.fillGrid};
			--rs-selection-fill-header: ${t.selection.fillHeader};
			--rs-hover-resize-glow: ${t.selection.hoverResizeGlow};
			--rs-hover-resize-line: ${t.selection.hoverResizeLine};
			--rs-popover-bg: ${t.popover.background};
			--rs-popover-border: ${t.popover.border};
			--rs-popover-text: ${t.popover.text};
			--rs-popover-muted-text: ${t.popover.mutedText};
			--rs-popover-hover-bg: ${t.popover.hoverBackground};
			--rs-icon-muted: ${t.icon.muted};
			--rs-editor-bg: ${t.editor.background};
			--rs-editor-text: ${t.editor.text};
			--rs-editor-border-focus: ${t.editor.borderFocus};
			--rs-scrollbar-track: ${t.scrollbar.track};
			--rs-scrollbar-thumb: ${t.scrollbar.thumb};
			--rs-scrollbar-thumb-hover: ${t.scrollbar.thumbHover};
			--rs-scrollbar-thumb-active: ${t.scrollbar.thumbActive};
			--rs-scrollbar-border: ${t.scrollbar.border};
			--rs-scrollbar-button-bg: ${t.scrollbar.buttonBg};
			--rs-scrollbar-button-hover-bg: ${t.scrollbar.buttonHoverBg};
			--rs-scrollbar-icon: ${t.scrollbar.icon};
			--rs-font-family: ${t.font.family};
			--rs-font-cell-size: ${t.font.cellSizePx}px; 
			--rs-font-header-size: ${t.font.headerSizePx}px;`;
		})()
	);
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
	const addColumns = () => {
		executeWithRerender(() => {
			sheet.addColumns(26);
		});
	};
	// include sheetVersion so UI reacts when columns are added
	const columnLabels = $derived((sheetVersion, sheet.columnLabels));
	const readCell = (r, c) => sheet.getValue(r, c);
	const writeCell = (r, c, v) =>
		executeWithRerender(() => {
			// include anchor metadata so undo can restore anchor position
			sheet.transact(() => sheet.setValue(r, c, v), {
				anchorRow: anchorRow ?? r,
				anchorCol: anchorCol ?? c
			});
		});
	const addRows = () => executeWithRerender(() => sheet.addRows(1000));
	const undo = () =>
		executeWithRerender(() => {
			const meta = sheet.undo();
			if (meta && typeof meta === 'object') {
				if (typeof meta.anchorRow === 'number') {
					setAnchorRow(meta.anchorRow);
					setFocusRow(meta.anchorRow);
					setLastActiveRow(meta.anchorRow);
				}
				if (typeof meta.anchorCol === 'number') {
					setAnchorCol(meta.anchorCol);
					setFocusCol(meta.anchorCol);
					setLastActiveCol(meta.anchorCol);
				}
			}
		});
	const redo = () =>
		executeWithRerender(() => {
			const meta = sheet.redo();
			if (meta && typeof meta === 'object') {
				if (typeof meta.anchorRow === 'number') {
					setAnchorRow(meta.anchorRow);
					setFocusRow(meta.anchorRow);
					setLastActiveRow(meta.anchorRow);
				}
				if (typeof meta.anchorCol === 'number') {
					setAnchorCol(meta.anchorCol);
					setFocusCol(meta.anchorCol);
					setLastActiveCol(meta.anchorCol);
				}
			}
		});
	const deleteSelection = () =>
		executeWithRerender(() => {
			const sel = selection ? selection.getSelection() : null;
			if (sel) {
				sheet.transact(() => sheet.deleteBlock(sel.r1, sel.c1, sel.r2, sel.c2), {
					anchorRow: sel.r1,
					anchorCol: sel.c1
				});
			} else {
				sheet.transact(
					() => sheet.deleteBlock(lastActiveRow, lastActiveCol, lastActiveRow, lastActiveCol),
					{ anchorRow: lastActiveRow, anchorCol: lastActiveCol }
				);
			}
		});

	// Context menu state
	let ctxOpen = $state(false);
	let ctxX = $state(0);
	let ctxY = $state(0);
	let ctxMenuEl = $state(null);

	function openContextMenu(e) {
		e.preventDefault();
		const clickX = e.clientX;
		const clickY = e.clientY;

		// Set initial position
		ctxX = clickX;
		ctxY = clickY;
		ctxOpen = true;

		// Use nextTick to ensure the menu is rendered before calculating position
		setTimeout(() => {
			if (ctxMenuEl) {
				const menuRect = ctxMenuEl.getBoundingClientRect();
				const windowWidth = window.innerWidth;
				const windowHeight = window.innerHeight;

				// Check if menu would overflow right edge
				if (clickX + menuRect.width > windowWidth) {
					ctxX = Math.max(0, windowWidth - menuRect.width - 8);
				}

				// Check if menu would overflow bottom edge
				if (clickY + menuRect.height > windowHeight) {
					ctxY = Math.max(0, windowHeight - menuRect.height - 8);
				}

				// Ensure menu doesn't go off the left or top edges
				ctxX = Math.max(0, ctxX);
				ctxY = Math.max(0, ctxY);
			}
		}, 0);
	}
	function closeContextMenu() {
		ctxOpen = false;
	}
	function onContextAction(type) {
		closeContextMenu();
		if (type === 'Undo') {
			undo();
		} else if (type === 'Redo') {
			redo();
		} else if (type === 'Copy') {
			commandBus.dispatch({ type: 'CopySelection' });
		} else if (type === 'Paste') {
			commandBus.dispatch({ type: 'PasteFromClipboard' });
		} else if (type === 'Cut') {
			// Cut = Copy + Delete
			commandBus.dispatch({ type: 'CopySelection' });
			deleteSelection();
		} else if (type === 'Delete') {
			deleteSelection();
		} else if (type === 'AddRows') {
			addRows();
		} else if (type === 'AddColumns') {
			addColumns();
		}
	}

	function selectAll() {
		const lastRow = Math.max(0, sheet.numRows - 1);
		const lastCol = Math.max(0, columnLabels.length - 1);
		selection.setRange(0, 0, lastRow, lastCol);
		scheduleRender();
	}

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
	const getColumnsLength = () => columnLabels.length;
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
	let colWidths = $derived(columnLabels.map(() => CELL_WIDTH));
	const MIN_COL_WIDTH = 40;
	function getColWidth(c) {
		return colWidths[c] ?? CELL_WIDTH;
	}
	// Sparse Fenwick tree for cumulative adjustments relative to defaults
	class SparseFenwick {
		constructor() {
			this.tree = new Map();
			this.maxIndex = 0;
		}
		setMax(n) {
			if (n > this.maxIndex) this.maxIndex = n;
		}
		add(indexOneBased, delta) {
			for (let i = indexOneBased; i <= this.maxIndex; i += i & -i) {
				this.tree.set(i, (this.tree.get(i) || 0) + delta);
			}
		}
		sum(countOneBased) {
			let res = 0;
			for (let i = countOneBased; i > 0; i -= i & -i) {
				res += this.tree.get(i) || 0;
			}
			return res;
		}
	}

	const colFenwick = new SparseFenwick();
	const rowFenwick = new SparseFenwick();

	function setColumnWidth(c, w) {
		const clamped = Math.max(MIN_COL_WIDTH, Math.round(w));
		const prev = getColWidth(c);
		if (clamped !== prev) {
			colWidths[c] = clamped;
			// update cumulative adjustment relative to default width
			colFenwick.add(c + 1, clamped - prev);
			scheduleRender();
		}
	}
	function colLeft(c) {
		// left of column c = base default + cumulative adjustments for 0..c-1
		return c * CELL_WIDTH + colFenwick.sum(c);
	}
	function xToColVariable(x) {
		const target = x + scrollLeft;
		let lo = 0;
		let hi = columnLabels.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			const rightEdge = (mid + 1) * CELL_WIDTH + colFenwick.sum(mid + 1);
			if (rightEdge > target) hi = mid;
			else lo = mid + 1;
		}
		return Math.max(0, Math.min(columnLabels.length - 1, lo));
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
		for (let c = 0; c < columnLabels.length; c++) {
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
		ctx.font = `${opts.bold ? '600 ' : ''}${resolvedTheme.font.cellSizePx}px ${resolvedTheme.font.family}`;
		return ctx.measureText(String(text ?? '')).width;
	}
	function autoFitColumn(colIndex) {
		const padX = 8;
		let foundContent = false;
		let maxW = 0; // if no content stays 0 => snap to default
		const maxRowsToScan = Math.min(sheet.numRows, 1000);
		for (let r = 0; r < maxRowsToScan; r++) {
			const v = readCell(r, colIndex);
			if (v !== '' && v != null) {
				foundContent = true;
				const w = measureText(v, { bold: false }) + padX * 2;
				if (w > maxW) maxW = w;
			}
		}
		if (!foundContent) {
			setColumnWidth(colIndex, CELL_WIDTH); // snap back to default when empty
			return;
		}
		setColumnWidth(colIndex, Math.max(MIN_COL_WIDTH, Math.ceil(maxW)));
	}

	// Row heights and helpers (variable heights)
	let rowHeights = $state([]);
	const MIN_ROW_HEIGHT = 18;
	function getRowHeight(r) {
		return rowHeights[r] ?? CELL_HEIGHT;
	}
	function setRowHeight(r, h) {
		const clamped = Math.max(MIN_ROW_HEIGHT, Math.round(h));
		const prev = getRowHeight(r);
		if (clamped !== prev) {
			rowHeights[r] = clamped;
			// update cumulative adjustment relative to default height
			rowFenwick.add(r + 1, clamped - prev);
			scheduleRender();
		}
	}
	function rowTop(r) {
		// top of row r = base default + cumulative adjustments for rows < r
		const rClamped = Math.max(0, Math.min(r, sheet.numRows));
		return rClamped * CELL_HEIGHT + rowFenwick.sum(rClamped);
	}
	function yToRowVariable(y) {
		const target = y + scrollTop;
		let lo = 0;
		let hi = sheet.numRows;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			const rightEdge = (mid + 1) * CELL_HEIGHT + rowFenwick.sum(mid + 1);
			if (rightEdge > target) hi = mid;
			else lo = mid + 1;
		}
		return Math.max(0, Math.min(sheet.numRows - 1, lo));
	}

	function getRowEdgeNearY(y, threshold = 5) {
		let acc = 0;
		for (let r = 0; r < sheet.numRows; r++) {
			const h = getRowHeight(r);
			const edgeAbs = acc + h;
			const edgeLocal = edgeAbs - scrollTop;
			if (Math.abs(edgeLocal - y) <= threshold) return r;
			acc = edgeAbs;
		}
		return null;
	}

	function autoFitRow(rowIndex) {
		const padY = 6;
		let maxLines = 0; // 0 means empty -> snap to default height
		let hasContent = false;
		const maxColsToScan = Math.min(columnLabels.length, 200);
		for (let c = 0; c < maxColsToScan; c++) {
			const v = readCell(rowIndex, c);
			if (v != null && v !== '') {
				hasContent = true;
				const lines = String(v).split('\n').length;
				if (lines > maxLines) maxLines = lines;
			}
		}
		if (!hasContent) {
			setRowHeight(rowIndex, CELL_HEIGHT); // snap back to default height when empty
			return;
		}
		const lineHeight = 14;
		const needed = Math.max(MIN_ROW_HEIGHT, Math.ceil(maxLines * lineHeight + padY));
		setRowHeight(rowIndex, needed);
	}

	// Hover UI state for resize affordance
	let hoverResizeCol = $state(null);
	const getHoverResizeCol = () => hoverResizeCol;
	const setHoverResizeCol = (idx) => {
		hoverResizeCol = typeof idx === 'number' ? idx : null;
		scheduleRender();
	};

	// Hover UI state for row resize affordance
	let hoverResizeRow = $state(null);
	const getHoverResizeRow = () => hoverResizeRow;
	const setHoverResizeRow = (idx) => {
		hoverResizeRow = typeof idx === 'number' ? idx : null;
		scheduleRender();
	};
	const numRowsView = $derived((sheetVersion, sheet.numRows));
	// Metrics and derived viewport calculations
	const totalHeight = $derived(
		(() => {
			rowHeights;
			numRowsView; // ensure reactivity when rows are added via sheetVersion
			// default total + cumulative adjustments
			return numRowsView * CELL_HEIGHT + rowFenwick.sum(numRowsView);
		})()
	);
	const totalWidth = $derived(
		(() => {
			colWidths;
			columnLabels;
			return columnLabels.length * CELL_WIDTH + colFenwick.sum(columnLabels.length);
		})()
	);

	// Visible window (row/column indices)
	const startIndexRow = $derived(
		(() => {
			rowHeights;
			numRowsView; // depend on numRowsView for reactivity
			let lo = 0;
			let hi = numRowsView;
			const target = scrollTop;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				const rightEdge = (mid + 1) * CELL_HEIGHT + rowFenwick.sum(mid + 1);
				if (rightEdge > target) hi = mid;
				else lo = mid + 1;
			}
			return Math.max(0, Math.min(numRowsView, lo));
		})()
	);
	const endIndexRow = $derived(
		(() => {
			rowHeights;
			numRowsView; // depend on numRowsView for reactivity
			const target = scrollTop + containerHeight;
			let lo = 0;
			let hi = numRowsView;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				const topAtMid = mid * CELL_HEIGHT + rowFenwick.sum(mid);
				if (topAtMid >= target) hi = mid;
				else lo = mid + 1;
			}
			return Math.max(0, Math.min(numRowsView, lo));
		})()
	);
	const visibleRowCount = $derived(endIndexRow - startIndexRow);

	const startIndexCol = $derived(
		(() => {
			colWidths;
			let lo = 0;
			let hi = columnLabels.length;
			const target = scrollLeft;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				const rightEdge = (mid + 1) * CELL_WIDTH + colFenwick.sum(mid + 1);
				if (rightEdge > target) hi = mid;
				else lo = mid + 1;
			}
			return Math.max(0, Math.min(columnLabels.length, lo));
		})()
	);
	const endIndexCol = $derived(
		(() => {
			colWidths;
			const target = scrollLeft + containerWidth;
			let lo = 0;
			let hi = columnLabels.length;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				const leftAtMid = mid * CELL_WIDTH + colFenwick.sum(mid);
				if (leftAtMid >= target) hi = mid;
				else lo = mid + 1;
			}
			return Math.max(0, Math.min(columnLabels.length, lo));
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
			sheetTransact: (fn, meta) => sheet.transact(fn, meta),
			drawHeaders: () => drawHeaders(),
			drawGrid: () => drawGrid(),
			localXY: (el, e) => localXY(el, e),
			pointToCell: (x, y) => ({ col: xToColVariable(x), row: yToRowVariable(y) }),
			xToColInHeader: (x) => xToColVariable(x),
			getColEdgeNearX: (x, threshold) => getColEdgeNearX(x, threshold),
			setColumnWidth: (idx, w) => setColumnWidth(idx, w),
			autoFitColumn: (idx) => autoFitColumn(idx),
			getColLeft: (c) => colLeft(c),
			yToRowInHeader: (y) => yToRowVariable(y),
			getRowEdgeNearY: (y, threshold) => getRowEdgeNearY(y, threshold),
			setRowHeight: (r, h) => setRowHeight(r, h),
			autoFitRow: (r) => autoFitRow(r),
			getRowTop: (r) => rowTop(r),
			setHoverResizeCol: (idx) => setHoverResizeCol(idx),
			undo,
			redo,
			deleteSelection
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
					if (!sheet._currentTransaction) sheet.beginTransaction();
					sheet.setBlock(startR + rowOffset, startC, values);
					scheduleRender();
				},
				onDone: () => {
					if (sheet._currentTransaction) sheet.commitTransaction();
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

	export const setData = (data, startingRow = 0, startingCol = 0) => {
		if (!data || data.length === 0) return;
		const rowCount = data.length;
		const BATCH_ROWS = 1000; // tweakable for smoothness vs throughput
		let rowIndex = 0;

		function processChunk() {
			const end = Math.min(rowIndex + BATCH_ROWS, rowCount);

			// feed directly, no extra slice — avoid copies
			for (let r = rowIndex; r < end; r++) {
				sheet.setDataFromObjects([data[r]], startingRow + r, startingCol);
			}

			// bump version so derived sizes/labels recompute and UI expands
			sheetVersion++;
			scheduleRender(); // rerender after this batch

			rowIndex = end;
			if (rowIndex < rowCount) {
				// yield to browser: let it render and handle input
				requestAnimationFrame(processChunk);
			}
		}

		requestAnimationFrame(processChunk);
		return { lastRow: rowIndex };
	};

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

	// Force repaint when theme changes
	$effect(() => {
		resolvedTheme;
		// Update 2d canvas paints to new theme immediately
		scheduleRender();
	});

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
		colFenwick.setMax(sheet.numCols);
		rowFenwick.setMax(sheet.numRows);
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
			columns: () => columnLabels,
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
			getHoverResizeCol: () => hoverResizeCol,
			getRowHeight: (r) => getRowHeight(r),
			rowTop: (r) => rowTop(r),
			getHoverResizeRow: () => hoverResizeRow,
			theme: () => resolvedTheme
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

<svelte:window
	onkeydown={(e) => {
		if (ctxOpen && e.key === 'Escape') {
			closeContextMenu();
			return;
		}
		onKeyDown(e);
	}}
	onpaste={onPaste}
	onclick={() => {
		if (ctxOpen) closeContextMenu();
	}}
/>

<div
	class="grid h-full w-full"
	style="{cssVars}; grid-template-columns: {ROW_HEADER_WIDTH}px 1fr {SCROLLBAR_SIZE}px; grid-template-rows: {COLUMN_HEADER_HEIGHT}px 1fr {SCROLLBAR_SIZE}px; border: 1px solid var(--rs-border); background: var(--rs-surface-bg);"
	oncontextmenu={openContextMenu}
	role="application"
>
	<!-- TL corner (Select all) -->
	<div
		class="flex items-center justify-center"
		style="border-right: 1px solid var(--rs-border); border-bottom: 1px solid var(--rs-border);"
		role="button"
		aria-label="Select all"
		tabindex="0"
		title="Select all"
		onclick={selectAll}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				selectAll();
			}
		}}
	>
		<svg
			class="h-3.5 w-3.5"
			style="color: var(--rs-icon-muted);"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			stroke-width="1"
			aria-hidden="true"
		>
			<path d="M2 2h12v12H2z" />
		</svg>
	</div>

	<!-- Column headers -->
	<div
		class="relative overflow-hidden"
		style="border-bottom: 1px solid var(--rs-border); background: var(--rs-header-bg);"
	>
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
	<div
		style="border-bottom: 1px solid var(--rs-border); border-left: 1px solid var(--rs-border); background: var(--rs-header-bg);"
	></div>

	<!-- Row headers -->
	<div
		class="relative overflow-hidden"
		style="border-right: 1px solid var(--rs-border); background: var(--rs-header-bg);"
	>
		<canvas
			class="canvas absolute top-0 left-0"
			bind:this={rowHeadCanvas}
			onpointerdown={drag.onRowHeadPointerDown}
			onpointermove={drag.onRowHeadPointerMove}
			onpointerup={drag.onRowHeadPointerUp}
			onpointerleave={drag.onRowHeadPointerLeave}
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
			getRowTop={(r) => rowTop(r)}
			getRowHeight={(r) => getRowHeight(r)}
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
	<div
		style="border-top: 1px solid var(--rs-border); border-right: 1px solid var(--rs-border); background: var(--rs-header-bg);"
	></div>

	<!-- Horizontal scrollbar -->
	<HorizontalScrollbar
		{scrollLeft}
		{totalWidth}
		{containerWidth}
		onUpdate={(newLeft) => viewport.clampScroll(scrollTop, newLeft)}
	/>

	<!-- BR filler -->
	<div
		style="border-top: 1px solid var(--rs-border); border-left: 1px solid var(--rs-border); background: var(--rs-header-bg);"
	></div>

	{#if ctxOpen}
		<div
			bind:this={ctxMenuEl}
			class="fixed z-50 w-56 rounded-lg shadow-xl backdrop-blur-sm"
			style="background: var(--rs-popover-bg); color: var(--rs-popover-text); border: 1px solid var(--rs-popover-border); left:{ctxX}px; top:{ctxY}px;"
			role="menu"
			tabindex="0"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				if (e.key === 'Escape') closeContextMenu();
			}}
			oncontextmenu={(e) => e.preventDefault()}
		>
			<!-- Undo -->
			<button
				class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
				style="color: var(--rs-popover-text);"
				onclick={() => onContextAction('Undo')}
				disabled={!sheet.canUndo()}
			>
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4"
						style="color: var(--rs-icon-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
						/>
					</svg>
					<span>Undo</span>
				</div>
				<span class="text-xs" style="color: var(--rs-popover-muted-text);">Ctrl+Z</span>
			</button>

			<!-- Redo -->
			<button
				class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
				style="color: var(--rs-popover-text);"
				onclick={() => onContextAction('Redo')}
				disabled={!sheet.canRedo()}
			>
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4"
						style="color: var(--rs-icon-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
						/>
					</svg>
					<span>Redo</span>
				</div>
				<span class="text-xs" style="color: var(--rs-popover-muted-text);">Ctrl+Y</span>
			</button>

			<!-- Divider -->
			<div class="my-1" style="border-top: 1px solid var(--rs-popover-border);"></div>

			<!-- Copy -->
			<button
				class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm transition-colors"
				style="color: var(--rs-popover-text);"
				onclick={() => onContextAction('Copy')}
			>
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4"
						style="color: var(--rs-icon-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
					<span>Copy</span>
				</div>
				<span class="text-xs" style="color: var(--rs-popover-muted-text);">Ctrl+C</span>
			</button>

			<!-- Paste -->
			<button
				class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm transition-colors"
				style="color: var(--rs-popover-text);"
				onclick={() => onContextAction('Paste')}
			>
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4"
						style="color: var(--rs-icon-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
						/>
					</svg>
					<span>Paste</span>
				</div>
				<span class="text-xs" style="color: var(--rs-popover-muted-text);">Ctrl+V</span>
			</button>

			<!-- Divider -->
			<div class="my-1" style="border-top: 1px solid var(--rs-popover-border);"></div>

			<!-- Delete -->
			<button
				class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm transition-colors"
				style="color: var(--rs-popover-text);"
				onclick={() => onContextAction('Delete')}
			>
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4"
						style="color: var(--rs-icon-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
						/>
					</svg>
					<span>Delete</span>
				</div>
				<span class="text-xs" style="color: var(--rs-popover-muted-text);">Delete</span>
			</button>

			<!-- Divider -->
			<div class="my-1" style="border-top: 1px solid var(--rs-popover-border);"></div>

			<!-- Add Rows -->
			<button
				class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm transition-colors"
				style="color: var(--rs-popover-text);"
				onclick={() => onContextAction('AddRows')}
			>
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4"
						style="color: var(--rs-icon-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					<span>Add 1000 Rows</span>
				</div>
			</button>

			<!-- Add Columns -->
			<button
				class="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left text-sm transition-colors"
				style="color: var(--rs-popover-text);"
				onclick={() => onContextAction('AddColumns')}
			>
				<div class="flex items-center gap-3">
					<svg
						class="h-4 w-4"
						style="color: var(--rs-icon-muted);"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M12 4v16m8-8H4"
						/>
					</svg>
					<span>Add A–Z Columns</span>
				</div>
			</button>
		</div>
		<!-- window handlers are integrated into the main <svelte:window> above -->
	{/if}
</div>

<style>
	.canvas {
		display: block;
		touch-action: none;
	}
</style>
