<script>
	import { Sheet, columns } from '../domain/sheet.svelte.js';
	import HorizontalScrollbar from './HorizontalScrollbar.svelte';
	import VerticalScrollbar from './VerticalScrollbar.svelte';

	const CELL_HEIGHT = 30;
	const CELL_WIDTH = 120;
	const ROW_HEADER_WIDTH = 50;
	const COLUMN_HEADER_HEIGHT = 30;
	const SCROLLBAR_SIZE = 12;

	let sheet = $state.raw(new Sheet());

	let scrollTop = $state(0);
	let scrollLeft = $state(0);
	let containerWidth = $state(0);
	let containerHeight = $state(0);
	let sheetVersion = $state(0); // bump when data changes so effect repaints

	// canvases
	let gridCanvas; // main cells
	let colHeadCanvas; // column headers
	let rowHeadCanvas; // row headers

	// selection state
	let selecting = $state(false);
	let dragMode = $state(null); // 'grid' | 'row' | 'col' | null
	let anchorRow = $state(null);
	let anchorCol = $state(null);
	let focusRow = $state(null);
	let focusCol = $state(null);
	let lastActiveRow = $state(0);
	let lastActiveCol = $state(0);

	// simple in-place read/write adapters so we work with different Sheet APIs
	function readCell(r, c) {
		if (sheet?.getValue) return sheet.getValue(r, c);
		if (sheet?.value) return sheet.value(r, c);
		if (sheet?.cells) return sheet.cells[`${r},${c}`] ?? '';
		return '';
	}
	function writeCell(r, c, v) {
		let ret;
		if (sheet?.setValue) ret = sheet.setValue(r, c, v);
		else if (sheet?.set) ret = sheet.set(r, c, v);
		else if (sheet?.cells) {
			sheet.cells[`${r},${c}`] = v;
			ret = sheet;
		}
		if (ret && ret !== sheet) sheet = ret; // support immutable returns
		sheetVersion++;
	}

	// editor overlay
	let editor = $state({ open: false, row: 0, col: 0, value: '' });
	let inputEl = $state(null)

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
			if (seedText == null) inputEl.select(); // replace existing by default
			else inputEl.setSelectionRange(editor.value.length, editor.value.length);
		});
		drawHeaders();
		drawGrid();
	}
	function commitEditor(save) {
		if (!editor.open) return;
		const { row, col, value } = editor;
		editor.open = false;
		if (save) writeCell(row, col, value);
		anchorRow = focusRow = lastActiveRow = row;
		anchorCol = focusCol = lastActiveCol = col;
		drawHeaders();
		drawGrid();
	}
	function onEditorKeyDown(e) {
		if (e.key === 'Enter') {
			commitEditor(true);
			// move down like spreadsheets
			moveFocusBy(1, 0);
			openEditorAt(lastActiveRow, lastActiveCol);
			e.preventDefault();
		} else if (e.key === 'Escape') {
			commitEditor(false);
			e.preventDefault();
		} else if (e.key === 'Tab') {
			const dir = e.shiftKey ? -1 : 1;
			commitEditor(true);
			moveFocusBy(0, dir);
			openEditorAt(lastActiveRow, lastActiveCol);
			e.preventDefault();
		}
	}

	// autoscroll while dragging near edges
	const EDGE = 24; // px hot zone
	let lastPointer = { x: 0, y: 0 };
	let auto = { vx: 0, vy: 0, raf: null };

	// metrics
	const totalHeight = $derived(sheet.rowLength * CELL_HEIGHT);
	const totalWidth = $derived(sheet.columns.length * CELL_WIDTH);

	// visible window
	const startIndexRow = $derived(Math.floor(scrollTop / CELL_HEIGHT));
	const visibleRowCount = $derived(Math.ceil(containerHeight / CELL_HEIGHT) + 1);
	const endIndexRow = $derived(Math.min(sheet.rowLength, startIndexRow + visibleRowCount));

	const startIndexCol = $derived(Math.floor(scrollLeft / CELL_WIDTH));
	const visibleColCount = $derived(Math.ceil(containerWidth / CELL_WIDTH) + 1);
	const endIndexCol = $derived(Math.min(sheet.columns.length, startIndexCol + visibleColCount));

	// selection helper (compute on demand)
	function getSelection() {
		if (anchorRow == null || focusRow == null) return null;
		const r1 = Math.max(0, Math.min(anchorRow, focusRow));
		const r2 = Math.min(sheet.rowLength - 1, Math.max(anchorRow, focusRow));
		const c1 = Math.max(0, Math.min(anchorCol, focusCol));
		const c2 = Math.min(sheet.columns.length - 1, Math.max(anchorCol, focusCol));
		return { r1, r2, c1, c2 };
	}

	function clampScroll(newTop, newLeft) {
		const maxScrollTop = Math.max(0, totalHeight - containerHeight);
		const maxScrollLeft = Math.max(0, totalWidth - containerWidth);
		scrollTop = Math.max(0, Math.min(newTop, maxScrollTop));
		scrollLeft = Math.max(0, Math.min(newLeft, maxScrollLeft));
	}

	function onWheel(e) {
		e.preventDefault();
		clampScroll(scrollTop + e.deltaY, scrollLeft + e.deltaX);
	}

	// helpers: local pointer coords
	function localXY(el, e) {
		const r = el.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	// map pixel → cell
	function pointToCell(x, y) {
		const col = Math.floor((x + scrollLeft) / CELL_WIDTH);
		const row = Math.floor((y + scrollTop) / CELL_HEIGHT);
		return { row, col };
	}
	function xToColInHeader(x) {
		return Math.floor((x + scrollLeft) / CELL_WIDTH);
	}
	function yToRowInHeader(y) {
		return Math.floor((y + scrollTop) / CELL_HEIGHT);
	}

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
			focusCol = sheet.columns.length - 1;
		} else if (kind === 'col') {
			focusCol = col;
			anchorRow = 0;
			focusRow = sheet.rowLength - 1;
		} else {
			focusRow = row;
			focusCol = col;
		}
		selecting = true;
		drawHeaders();
		drawGrid();
	}

	const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

	function updateSelectionTo(row, col) {
		if (!selecting) return;
		if (dragMode === 'row') {
			focusRow = clamp(row, 0, sheet.rowLength - 1);
			focusCol = sheet.columns.length - 1; // stick to full width
		} else if (dragMode === 'col') {
			focusCol = clamp(col, 0, sheet.columns.length - 1);
			focusRow = sheet.rowLength - 1; // stick to full height
		} else {
			focusRow = clamp(row, 0, sheet.rowLength - 1);
			focusCol = clamp(col, 0, sheet.columns.length - 1);
		}
		drawHeaders();
		drawGrid();
	}

	function endSelection() {
		selecting = false;
		const sel = getSelection();
		if (sel) {
			lastActiveRow = sel.r2;
			lastActiveCol = sel.c2;
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

	// High-DPI canvas setup helper
	function setupCtx(canvas, cssW, cssH) {
		const dpr = Math.max(1, window.devicePixelRatio || 1);
		canvas.width = Math.max(1, Math.floor(cssW * dpr));
		canvas.height = Math.max(1, Math.floor(cssH * dpr));
		canvas.style.width = cssW + 'px';
		canvas.style.height = cssH + 'px';
		const ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return ctx;
	}

	function drawHeaders() {
		// Column headers
		if (colHeadCanvas) {
			const ctx = setupCtx(colHeadCanvas, containerWidth, COLUMN_HEADER_HEIGHT);
			ctx.clearRect(0, 0, containerWidth, COLUMN_HEADER_HEIGHT);
			ctx.fillStyle = '#f9fafb';
			ctx.fillRect(0, 0, containerWidth, COLUMN_HEADER_HEIGHT);
			const offsetX = -(scrollLeft % CELL_WIDTH);
			ctx.save();
			ctx.translate(offsetX, 0);

			// selection highlight in header (exactly aligned; no +/-1 fudge)
			const selH = getSelection();
			if (selH) {
				const { c1, c2 } = selH;
				const leftCol = Math.max(c1, startIndexCol);
				const rightCol = Math.min(c2, endIndexCol - 1);
				if (leftCol <= rightCol) {
					const x0 = (leftCol - startIndexCol) * CELL_WIDTH;
					const x1 = (rightCol - startIndexCol + 1) * CELL_WIDTH;
					ctx.fillStyle = 'rgba(59,130,246,0.15)';
					ctx.fillRect(x0, 0, x1 - x0, COLUMN_HEADER_HEIGHT);
				}
			}

			// grid lines + labels
			ctx.font = '600 12px Inter, system-ui, sans-serif';
			ctx.textBaseline = 'middle';
			for (let c = startIndexCol; c <= endIndexCol; c++) {
				const x = (c - startIndexCol) * CELL_WIDTH;
				ctx.fillStyle = '#475569';
				const label = columns[c] ?? String(c);
				ctx.fillText(label, x + 8, COLUMN_HEADER_HEIGHT / 2);

				ctx.strokeStyle = '#e5e7eb';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(x + CELL_WIDTH + 0.5, 0.5);
				ctx.lineTo(x + CELL_WIDTH + 0.5, COLUMN_HEADER_HEIGHT + 0.5);
				ctx.stroke();
			}
			ctx.restore();

			// bottom border
			ctx.strokeStyle = '#d1d5db';
			ctx.beginPath();
			ctx.moveTo(0.5, COLUMN_HEADER_HEIGHT + 0.5);
			ctx.lineTo(containerWidth + 0.5, COLUMN_HEADER_HEIGHT + 0.5);
			ctx.stroke();
		}

		// Row headers
		if (rowHeadCanvas) {
			const ctx = setupCtx(rowHeadCanvas, ROW_HEADER_WIDTH, containerHeight);
			ctx.clearRect(0, 0, ROW_HEADER_WIDTH, containerHeight);
			ctx.fillStyle = '#f9fafb';
			ctx.fillRect(0, 0, ROW_HEADER_WIDTH, containerHeight);

			const offsetY = -(scrollTop % CELL_HEIGHT);
			ctx.save();
			ctx.translate(0, offsetY);

			// selection highlight in row header (exactly aligned; no +/-1 fudge)
			const selR = getSelection();
			if (selR) {
				const { r1, r2 } = selR;
				const topRow = Math.max(r1, startIndexRow);
				const botRow = Math.min(r2, endIndexRow - 1);
				if (topRow <= botRow) {
					const y0 = (topRow - startIndexRow) * CELL_HEIGHT;
					const y1 = (botRow - startIndexRow + 1) * CELL_HEIGHT;
					ctx.fillStyle = 'rgba(59,130,246,0.15)';
					ctx.fillRect(0, y0, ROW_HEADER_WIDTH, y1 - y0);
				}
			}

			// lines + numbers
			ctx.font = '600 12px Inter, system-ui, sans-serif';
			ctx.textBaseline = 'middle';
			ctx.fillStyle = '#475569';
			for (let r = startIndexRow; r <= endIndexRow; r++) {
				const y = (r - startIndexRow) * CELL_HEIGHT;
				ctx.fillText(String(r + 1), 8, y + CELL_HEIGHT / 2);

				ctx.strokeStyle = '#e5e7eb';
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(0.5, y + CELL_HEIGHT + 0.5);
				ctx.lineTo(ROW_HEADER_WIDTH + 0.5, y + CELL_HEIGHT + 0.5);
				ctx.stroke();
			}
			ctx.restore();

			// right border
			ctx.strokeStyle = '#d1d5db';
			ctx.beginPath();
			ctx.moveTo(ROW_HEADER_WIDTH + 0.5, 0.5);
			ctx.lineTo(ROW_HEADER_WIDTH + 0.5, containerHeight + 0.5);
			ctx.stroke();
		}
	}

	function drawGrid() {
		if (!gridCanvas) return;
		const ctx = setupCtx(gridCanvas, containerWidth, containerHeight);
		ctx.clearRect(0, 0, containerWidth, containerHeight);
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, containerWidth, containerHeight);

		const offsetX = -(scrollLeft % CELL_WIDTH);
		const offsetY = -(scrollTop % CELL_HEIGHT);

		ctx.save();
		ctx.translate(offsetX, offsetY);

		// grid lines
		ctx.strokeStyle = '#e5e7eb';
		ctx.lineWidth = 1;
		for (let c = startIndexCol; c <= endIndexCol; c++) {
			const x = (c - startIndexCol) * CELL_WIDTH + 0.5;
			ctx.beginPath();
			ctx.moveTo(x, 0.5);
			ctx.lineTo(x, visibleRowCount * CELL_HEIGHT + 0.5);
			ctx.stroke();
		}
		for (let r = startIndexRow; r <= endIndexRow; r++) {
			const y = (r - startIndexRow) * CELL_HEIGHT + 0.5;
			ctx.beginPath();
			ctx.moveTo(0.5, y);
			ctx.lineTo(visibleColCount * CELL_WIDTH + 0.5, y);
			ctx.stroke();
		}

		// text
		ctx.font = '12px Inter, system-ui, sans-serif';
		ctx.fillStyle = '#111827';
		ctx.textBaseline = 'middle';
		const padX = 8;
		for (let r = startIndexRow; r < endIndexRow; r++) {
			for (let c = startIndexCol; c < endIndexCol; c++) {
				const x = (c - startIndexCol) * CELL_WIDTH;
				const y = (r - startIndexRow) * CELL_HEIGHT;
				const value = readCell(r, c);
				if (value !== '' && value != null) {
					ctx.save();
					ctx.beginPath();
					ctx.rect(x + 1, y + 1, CELL_WIDTH - 2, CELL_HEIGHT - 2);
					ctx.clip();
					ctx.fillText(String(value), x + padX, y + CELL_HEIGHT / 2);
					ctx.restore();
				}
			}
		}

		// selection overlay
		const sel = getSelection();
		if (sel) {
			const { r1, r2, c1, c2 } = sel;
			// Visible bounds in cell indices
			const vC1 = Math.max(c1, startIndexCol);
			const vC2 = Math.min(c2, endIndexCol - 1);
			const vR1 = Math.max(r1, startIndexRow);
			const vR2 = Math.min(r2, endIndexRow - 1);

			// If any part is visible, paint the fill clipped to viewport
			if (vC1 <= vC2 && vR1 <= vR2) {
				const x0 = (vC1 - startIndexCol) * CELL_WIDTH;
				const x1 = (vC2 - startIndexCol + 1) * CELL_WIDTH;
				const y0 = (vR1 - startIndexRow) * CELL_HEIGHT;
				const y1 = (vR2 - startIndexRow + 1) * CELL_HEIGHT;
				ctx.fillStyle = 'rgba(59,130,246,0.12)';
				ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
			}

			// Draw the thick border **only on real edges** that are actually visible
			ctx.strokeStyle = '#3b82f6';
			ctx.lineWidth = 2; // draw on integer coords for crispness
			const viewW = visibleColCount * CELL_WIDTH;
			const viewH = visibleRowCount * CELL_HEIGHT;
			const selX0 = (c1 - startIndexCol) * CELL_WIDTH;
			const selX1 = (c2 + 1 - startIndexCol) * CELL_WIDTH;
			const selY0 = (r1 - startIndexRow) * CELL_HEIGHT;
			const selY1 = (r2 + 1 - startIndexRow) * CELL_HEIGHT;

			// Top edge visible?
			if (r1 >= startIndexRow) {
				const a = Math.max(selX0, 0);
				const b = Math.min(selX1, viewW);
				if (a < b) {
					ctx.beginPath();
					ctx.moveTo(a, selY0);
					ctx.lineTo(b, selY0);
					ctx.stroke();
				}
			}
			// Bottom edge visible?
			if (r2 < endIndexRow - 1) {
				const a = Math.max(selX0, 0);
				const b = Math.min(selX1, viewW);
				if (a < b) {
					ctx.beginPath();
					ctx.moveTo(a, selY1);
					ctx.lineTo(b, selY1);
					ctx.stroke();
				}
			}
			// Left edge visible?
			if (c1 >= startIndexCol) {
				const a = Math.max(selY0, 0);
				const b = Math.min(selY1, viewH);
				if (a < b) {
					ctx.beginPath();
					ctx.moveTo(selX0, a);
					ctx.lineTo(selX0, b);
					ctx.stroke();
				}
			}
			// Right edge visible?
			if (c2 < endIndexCol - 1) {
				const a = Math.max(selY0, 0);
				const b = Math.min(selY1, viewH);
				if (a < b) {
					ctx.beginPath();
					ctx.moveTo(selX1, a);
					ctx.lineTo(selX1, b);
					ctx.stroke();
				}
			}
		}

		ctx.restore();
	}

	// keyboard: enter to edit; type to start editing; arrows to move selection
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
		const nav = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], PageUp: [-visibleRowCount + 1, 0], PageDown: [visibleRowCount - 1, 0], Home: [0, -lastActiveCol], End: [0, sheet.columns.length] };
		if (e.key in nav) {
			const [dr, dc] = nav[e.key];
			moveFocusBy(dr, dc);
			e.preventDefault();
		}
	}
	function moveFocusBy(dr, dc) {
		let r = Math.min(Math.max(lastActiveRow + dr, 0), sheet.rowLength - 1);
		let c = Math.min(Math.max(lastActiveCol + dc, 0), sheet.columns.length - 1);
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
	$effect(() => {
		anchorRow; anchorCol; focusRow; focusCol; // depend on raw selection drivers
		scrollTop; scrollLeft;
		containerWidth; containerHeight;
		startIndexRow; startIndexCol; endIndexRow; endIndexCol;
		sheetVersion;
		drawHeaders();
		drawGrid();
	});

	function addRows() {
		sheet = sheet.addRows ? sheet.addRows() : sheet;
		sheetVersion++;
	}
</script>

<style>
	.canvas { display: block; touch-action: none; }
	.editor { box-sizing: border-box; }
</style>

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
				class="editor absolute z-20 border-2 border-blue-500 outline-none bg-white px-2 text-sm"
				bind:this={inputEl}
				style="left: {editor.col * CELL_WIDTH - scrollLeft}px; top: {editor.row * CELL_HEIGHT - scrollTop}px; width: {CELL_WIDTH}px; height: {CELL_HEIGHT}px;"
				value={editor.value}
				oninput={(e) => (editor.value = e.currentTarget.value)}
				onkeydown={onEditorKeyDown}
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
		<div class="text-sm text-gray-500">rows: {sheet.rowLength}, cols: {sheet.columns.length}</div>
	</div>
</div>
