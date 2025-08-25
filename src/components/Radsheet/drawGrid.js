import { setupCanvas2d } from './canvas-utils.js';

/**
 * Draws the main grid: background, grid lines, cell text, and selection overlay.
 *
 * This is intentionally parameterized so it can be reused in tests and so
 * `Radsheet.svelte` remains the orchestrator of state, not rendering details.
 */
export function drawGrid(opts) {
	const {
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
		isSelectionCopied = false
	} = opts;

	if (!gridCanvas) return;
	const ctx = setupCanvas2d(gridCanvas, containerWidth, containerHeight);
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

		// Draw the thick border only on visible edges
		ctx.strokeStyle = '#3b82f6';
		ctx.lineWidth = 2;

		// Set line dash for dotted border when copied
		if (isSelectionCopied) {
			ctx.setLineDash([4, 4]);
		} else {
			ctx.setLineDash([]);
		}
		const viewW = visibleColCount * CELL_WIDTH;
		const viewH = visibleRowCount * CELL_HEIGHT;
		const selX0 = (c1 - startIndexCol) * CELL_WIDTH;
		const selX1 = (c2 + 1 - startIndexCol) * CELL_WIDTH;
		const selY0 = (r1 - startIndexRow) * CELL_HEIGHT;
		const selY1 = (r2 + 1 - startIndexRow) * CELL_HEIGHT;
		const isTopAtBoundary = selY0 <= 0;
		const isLeftAtBoundary = selX0 <= 0;
		const isRightAtBoundary = selX1 >= viewW;
		const isBottomAtBoundary = selY1 >= viewH;

		// Top edge visible?
		if (r1 >= startIndexRow) {
			const a = Math.max(selX0, 0);
			const b = Math.min(selX1, viewW);
			if (a < b) {
				if (isTopAtBoundary) {
					ctx.fillStyle = ctx.strokeStyle;
					ctx.fillRect(a, 0, b - a, 2);
				} else {
					ctx.beginPath();
					ctx.moveTo(a, selY0);
					ctx.lineTo(b, selY0);
					ctx.stroke();
				}
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
				if (isLeftAtBoundary) {
					ctx.fillStyle = ctx.strokeStyle;
					ctx.fillRect(0, a, 2, b - a);
				} else {
					ctx.beginPath();
					ctx.moveTo(selX0, a);
					ctx.lineTo(selX0, b);
					ctx.stroke();
				}
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

		// Anchor cell highlight box (originally clicked cell)
		if (r1 !== r2 || c1 !== c2) {
			const ax = (anchorCol - startIndexCol) * CELL_WIDTH;
			const ay = (anchorRow - startIndexRow) * CELL_HEIGHT;
			ctx.save();
			ctx.strokeStyle = '#3b82f6';
			ctx.lineWidth = 2;
			ctx.setLineDash([]);
			ctx.strokeRect(ax + 1, ay + 1, CELL_WIDTH - 2, CELL_HEIGHT - 2);
			ctx.restore();
		}
	}

	ctx.restore();
}
