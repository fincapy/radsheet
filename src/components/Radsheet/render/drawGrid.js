import { setupCanvas2d } from '../canvas-utils.js';

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
		isSelectionCopied = false,
		getColWidth,
		colLeft,
		getRowHeight,
		rowTop
	} = opts;

	if (!gridCanvas) return;
	const ctx = setupCanvas2d(gridCanvas, containerWidth, containerHeight);
	ctx.clearRect(0, 0, containerWidth, containerHeight);
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, containerWidth, containerHeight);

	const baseLeft = colLeft ? colLeft(startIndexCol) : startIndexCol * CELL_WIDTH;
	const offsetX = baseLeft - scrollLeft;
	const baseTop = rowTop ? rowTop(startIndexRow) : startIndexRow * CELL_HEIGHT;
	const offsetY = baseTop - scrollTop;

	ctx.save();
	ctx.translate(offsetX, offsetY);

	// grid lines
	ctx.strokeStyle = '#e5e7eb';
	ctx.lineWidth = 1;
	const viewportWidthPx = (() => {
		if (!getColWidth) return visibleColCount * CELL_WIDTH;
		let sum = 0;
		for (let k = startIndexCol; k < endIndexCol; k++) sum += getColWidth(k);
		return sum;
	})();
	for (let c = startIndexCol; c <= endIndexCol; c++) {
		const x = (colLeft ? colLeft(c) : c * CELL_WIDTH) - baseLeft + 0.5;
		ctx.beginPath();
		ctx.moveTo(x, 0.5);
		ctx.lineTo(x, visibleRowCount * CELL_HEIGHT + 0.5);
		ctx.stroke();
	}
	for (let r = startIndexRow; r <= endIndexRow; r++) {
		const y = (rowTop ? rowTop(r) : r * CELL_HEIGHT) - baseTop + 0.5;
		ctx.beginPath();
		ctx.moveTo(0.5, y);
		ctx.lineTo(viewportWidthPx + 0.5, y);
		ctx.stroke();
	}

	// text
	ctx.font = '12px Inter, system-ui, sans-serif';
	ctx.fillStyle = '#111827';
	ctx.textBaseline = 'middle';
	const padX = 8;
	for (let r = startIndexRow; r < endIndexRow; r++) {
		for (let c = startIndexCol; c < endIndexCol; c++) {
			const x = (colLeft ? colLeft(c) : c * CELL_WIDTH) - baseLeft;
			const y = (rowTop ? rowTop(r) : r * CELL_HEIGHT) - baseTop;
			const value = readCell(r, c);
			if (value !== '' && value != null) {
				ctx.save();
				ctx.beginPath();
				const w = getColWidth ? getColWidth(c) : CELL_WIDTH;
				const h = getRowHeight ? getRowHeight(r) : CELL_HEIGHT;
				ctx.rect(x + 1, y + 1, w - 2, h - 2);
				ctx.clip();
				ctx.fillText(
					String(value),
					x + padX,
					y + (getRowHeight ? getRowHeight(r) : CELL_HEIGHT) / 2
				);
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

		// Precompute anchor cell rect in local space
		const anchorX0 = (colLeft ? colLeft(anchorCol) : anchorCol * CELL_WIDTH) - baseLeft;
		const anchorX1 =
			(colLeft
				? colLeft(anchorCol) + (getColWidth ? getColWidth(anchorCol) : CELL_WIDTH)
				: (anchorCol + 1) * CELL_WIDTH) - baseLeft;
		const anchorY0 = (rowTop ? rowTop(anchorRow) : anchorRow * CELL_HEIGHT) - baseTop;
		const anchorY1 =
			(rowTop
				? rowTop(anchorRow) + (getRowHeight ? getRowHeight(anchorRow) : CELL_HEIGHT)
				: (anchorRow + 1) * CELL_HEIGHT) - baseTop;

		// If any part is visible, paint the fill clipped to viewport, excluding the anchor cell area
		if (vC1 <= vC2 && vR1 <= vR2) {
			const x0 = (colLeft ? colLeft(vC1) : vC1 * CELL_WIDTH) - baseLeft;
			const x1 =
				(colLeft
					? colLeft(vC2) + (getColWidth ? getColWidth(vC2) : CELL_WIDTH)
					: (vC2 + 1) * CELL_WIDTH) - baseLeft;
			const y0 = (rowTop ? rowTop(vR1) : vR1 * CELL_HEIGHT) - baseTop;
			const y1 =
				(rowTop
					? rowTop(vR2) + (getRowHeight ? getRowHeight(vR2) : CELL_HEIGHT)
					: (vR2 + 1) * CELL_HEIGHT) - baseTop;
			// Skip fill entirely when selection is a single cell (hole would remove all fill anyway)
			if (!(r1 === r2 && c1 === c2)) {
				ctx.save();
				ctx.beginPath();
				// Outer selection rect
				ctx.rect(x0, y0, x1 - x0, y1 - y0);
				// Inner hole: anchor cell rect
				ctx.rect(anchorX0, anchorY0, anchorX1 - anchorX0, anchorY1 - anchorY0);
				ctx.fillStyle = 'rgba(59,130,246,0.12)';
				// Use even-odd rule to exclude the inner rect
				ctx.fill('evenodd');
				ctx.restore();
			}
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
		const viewW = viewportWidthPx;
		const viewH = (() => {
			if (!getRowHeight) return visibleRowCount * CELL_HEIGHT;
			let sum = 0;
			for (let k = startIndexRow; k < endIndexRow; k++) sum += getRowHeight(k);
			return sum;
		})();
		// Local-space y coordinate of the viewport bottom after translation.
		// Using this avoids stepwise jumps when the viewport crosses row boundaries.
		const viewportBottomLocalY = containerHeight + scrollTop - baseTop;
		// Local-space x coordinate of the viewport right after translation.
		// Using this avoids stepwise jumps when the viewport crosses column boundaries.
		const viewportRightLocalX = containerWidth + scrollLeft - baseLeft;
		const selX0 = (colLeft ? colLeft(c1) : c1 * CELL_WIDTH) - baseLeft;
		const selX1 =
			(colLeft
				? colLeft(c2) + (getColWidth ? getColWidth(c2) : CELL_WIDTH)
				: (c2 + 1) * CELL_WIDTH) - baseLeft;
		const selY0 = (rowTop ? rowTop(r1) : r1 * CELL_HEIGHT) - baseTop;
		const selY1 =
			(rowTop
				? rowTop(r2) + (getRowHeight ? getRowHeight(r2) : CELL_HEIGHT)
				: (r2 + 1) * CELL_HEIGHT) - baseTop;
		const isTopAtBoundary = selY0 <= 0;
		const isLeftAtBoundary = selX0 <= 0;
		const isRightAtBoundary = selX1 >= viewportRightLocalX - 1; // tolerate 1px underflow
		const isBottomAtBoundary = selY1 >= viewportBottomLocalY;
		const anchorOnTop = anchorRow === r1;
		const anchorOnBottom = anchorRow === r2;
		const anchorOnLeft = anchorCol === c1;
		const anchorOnRight = anchorCol === c2;

		// Draw selection outer edges only when selection spans more than one cell
		if (!(r1 === r2 && c1 === c2)) {
			// Top edge visible?
			if (r1 >= startIndexRow) {
				const a = Math.max(selX0, 0);
				const b = Math.min(selX1, viewportRightLocalX);
				if (a < b) {
					if (isTopAtBoundary) {
						ctx.fillStyle = ctx.strokeStyle;
						if (anchorOnTop) {
							const s1 = Math.min(anchorX0, b);
							const s2 = Math.max(anchorX1, a);
							if (a < s1) ctx.fillRect(a, 0, s1 - a, 2);
							if (s2 < b) ctx.fillRect(s2, 0, b - s2, 2);
						} else {
							ctx.fillRect(a, 0, b - a, 2);
						}
					} else {
						if (anchorOnTop) {
							const s1 = Math.min(anchorX0, b);
							const s2 = Math.max(anchorX1, a);
							if (a < s1) {
								ctx.beginPath();
								ctx.moveTo(a, selY0);
								ctx.lineTo(s1, selY0);
								ctx.stroke();
							}
							if (s2 < b) {
								ctx.beginPath();
								ctx.moveTo(s2, selY0);
								ctx.lineTo(b, selY0);
								ctx.stroke();
							}
						} else {
							ctx.beginPath();
							ctx.moveTo(a, selY0);
							ctx.lineTo(b, selY0);
							ctx.stroke();
						}
					}
				}
			}
			// Bottom edge visible fully within viewport (not at bottom boundary)
			if (r2 < endIndexRow - 1) {
				const a = Math.max(selX0, 0);
				const b = Math.min(selX1, viewportRightLocalX);
				if (a < b) {
					if (anchorOnBottom) {
						const s1 = Math.min(anchorX0, b);
						const s2 = Math.max(anchorX1, a);
						if (a < s1) {
							ctx.beginPath();
							ctx.moveTo(a, selY1);
							ctx.lineTo(s1, selY1);
							ctx.stroke();
						}
						if (s2 < b) {
							ctx.beginPath();
							ctx.moveTo(s2, selY1);
							ctx.lineTo(b, selY1);
							ctx.stroke();
						}
					} else {
						ctx.beginPath();
						ctx.moveTo(a, selY1);
						ctx.lineTo(b, selY1);
						ctx.stroke();
					}
				}
			}
			// If bottom edge coincides with viewport boundary, draw a filled strip to avoid clipping
			else if (r2 === endIndexRow - 1 && isBottomAtBoundary) {
				const a = Math.max(selX0, 0);
				const b = Math.min(selX1, viewportRightLocalX);
				if (a < b) {
					ctx.fillStyle = ctx.strokeStyle;
					if (anchorOnBottom) {
						const s1 = Math.min(anchorX0, b);
						const s2 = Math.max(anchorX1, a);
						if (a < s1) ctx.fillRect(a, viewportBottomLocalY - 2, s1 - a, 2);
						if (s2 < b) ctx.fillRect(s2, viewportBottomLocalY - 2, b - s2, 2);
					} else {
						ctx.fillRect(a, viewportBottomLocalY - 2, b - a, 2);
					}
				}
			}
			// Left edge visible?
			if (c1 >= startIndexCol) {
				const a = Math.max(selY0, 0);
				const b = Math.min(selY1, viewportBottomLocalY);
				if (a < b) {
					if (isLeftAtBoundary) {
						ctx.fillStyle = ctx.strokeStyle;
						if (anchorOnLeft) {
							const s1 = Math.min(anchorY0, b);
							const s2 = Math.max(anchorY1, a);
							if (a < s1) ctx.fillRect(0, a, 2, s1 - a);
							if (s2 < b) ctx.fillRect(0, s2, 2, b - s2);
						} else {
							ctx.fillRect(0, a, 2, b - a);
						}
					} else {
						if (anchorOnLeft) {
							const s1 = Math.min(anchorY0, b);
							const s2 = Math.max(anchorY1, a);
							if (a < s1) {
								ctx.beginPath();
								ctx.moveTo(selX0, a);
								ctx.lineTo(selX0, s1);
								ctx.stroke();
							}
							if (s2 < b) {
								ctx.beginPath();
								ctx.moveTo(selX0, s2);
								ctx.lineTo(selX0, b);
								ctx.stroke();
							}
						} else {
							ctx.beginPath();
							ctx.moveTo(selX0, a);
							ctx.lineTo(selX0, b);
							ctx.stroke();
						}
					}
				}
			}
			// Right edge visible?
			if (c2 < endIndexCol - 1) {
				const a = Math.max(selY0, 0);
				const b = Math.min(selY1, viewportBottomLocalY);
				if (a < b) {
					if (anchorOnRight) {
						const s1 = Math.min(anchorY0, b);
						const s2 = Math.max(anchorY1, a);
						if (a < s1) {
							ctx.beginPath();
							ctx.moveTo(selX1, a);
							ctx.lineTo(selX1, s1);
							ctx.stroke();
						}
						if (s2 < b) {
							ctx.beginPath();
							ctx.moveTo(selX1, s2);
							ctx.lineTo(selX1, b);
							ctx.stroke();
						}
					} else {
						ctx.beginPath();
						ctx.moveTo(selX1, a);
						ctx.lineTo(selX1, b);
						ctx.stroke();
					}
				}
			}
			// If right edge coincides with viewport boundary, draw a filled strip to avoid clipping
			else if (c2 === endIndexCol - 1 && isRightAtBoundary) {
				const a = Math.max(selY0, 0);
				const b = Math.min(selY1, viewportBottomLocalY);
				if (a < b) {
					ctx.fillStyle = ctx.strokeStyle;
					if (anchorOnRight) {
						const s1 = Math.min(anchorY0, b);
						const s2 = Math.max(anchorY1, a);
						if (a < s1) ctx.fillRect(viewportRightLocalX - 2, a, 2, s1 - a);
						if (s2 < b) ctx.fillRect(viewportRightLocalX - 2, s2, 2, b - s2);
					} else {
						ctx.fillRect(viewportRightLocalX - 2, a, 2, b - a);
					}
				}
			}
		}

		// Anchor cell highlight box (originally clicked cell), always outline only
		{
			ctx.save();
			ctx.strokeStyle = '#3b82f6';
			ctx.lineWidth = 2;
			ctx.setLineDash([]);
			ctx.strokeRect(anchorX0, anchorY0, anchorX1 - anchorX0, anchorY1 - anchorY0);
			ctx.restore();
		}
	}

	ctx.restore();
}
