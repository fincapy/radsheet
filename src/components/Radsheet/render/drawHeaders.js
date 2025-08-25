import { setupCanvas2d } from '../canvas-utils.js';

/**
 * Draws the column and row headers, including selection highlights and grid lines.
 *
 * Inputs are provided via a single object to keep the function signature stable
 * and easy to evolve as rendering needs change.
 */
export function drawHeaders(opts) {
	const {
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
		getSelection,
		getColWidth,
		colLeft,
		getHoverResizeCol
	} = opts;

	// Column headers
	if (colHeadCanvas) {
		const ctx = setupCanvas2d(colHeadCanvas, containerWidth, COLUMN_HEADER_HEIGHT);
		ctx.clearRect(0, 0, containerWidth, COLUMN_HEADER_HEIGHT);
		ctx.fillStyle = '#f9fafb';
		ctx.fillRect(0, 0, containerWidth, COLUMN_HEADER_HEIGHT);
		const firstLeft = colLeft ? colLeft(startIndexCol) : startIndexCol * CELL_WIDTH;
		const offsetX = firstLeft - scrollLeft;
		ctx.save();
		ctx.translate(offsetX, 0);

		// selection highlight in header (exactly aligned)
		const selH = getSelection();
		if (selH) {
			const { c1, c2 } = selH;
			const leftCol = Math.max(c1, startIndexCol);
			const rightCol = Math.min(c2, endIndexCol - 1);
			if (leftCol <= rightCol) {
				const base = colLeft ? colLeft(startIndexCol) : startIndexCol * CELL_WIDTH;
				const x0 = (colLeft ? colLeft(leftCol) : leftCol * CELL_WIDTH) - base;
				const x1 =
					(colLeft
						? colLeft(rightCol) + (getColWidth ? getColWidth(rightCol) : CELL_WIDTH)
						: (rightCol + 1) * CELL_WIDTH) - base;
				ctx.fillStyle = 'rgba(59,130,246,0.15)';
				ctx.fillRect(x0, 0, x1 - x0, COLUMN_HEADER_HEIGHT);
			}
		}

		// grid lines + labels
		ctx.font = '600 12px Inter, system-ui, sans-serif';
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'center';
		for (let c = startIndexCol; c < endIndexCol; c++) {
			const base = colLeft ? colLeft(startIndexCol) : startIndexCol * CELL_WIDTH;
			const x = (colLeft ? colLeft(c) : c * CELL_WIDTH) - base;
			const w = getColWidth ? getColWidth(c) : CELL_WIDTH;
			ctx.fillStyle = '#475569';
			const label = columns[c] ?? String(c);
			ctx.fillText(label, x + w / 2, COLUMN_HEADER_HEIGHT / 2);

			ctx.strokeStyle = '#e5e7eb';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(x + w + 0.5, 0.5);
			ctx.lineTo(x + w + 0.5, COLUMN_HEADER_HEIGHT + 0.5);
			ctx.stroke();
		}

		// Hover resize indicator (subtle) on the edge under cursor
		const hoverCol = getHoverResizeCol ? getHoverResizeCol() : null;
		if (hoverCol != null && hoverCol >= startIndexCol && hoverCol < endIndexCol) {
			const base = colLeft ? colLeft(startIndexCol) : startIndexCol * CELL_WIDTH;
			const xEdge =
				(colLeft ? colLeft(hoverCol) + getColWidth(hoverCol) : (hoverCol + 1) * CELL_WIDTH) - base;
			ctx.save();
			const yTop = 4.5;
			const yBot = COLUMN_HEADER_HEIGHT - 4.5;
			// soft glow behind
			ctx.strokeStyle = 'rgba(59,130,246,0.12)';
			ctx.lineWidth = 6;
			ctx.beginPath();
			ctx.moveTo(xEdge + 0.5, yTop);
			ctx.lineTo(xEdge + 0.5, yBot);
			ctx.stroke();
			// crisp center line
			ctx.strokeStyle = '#3b82f6';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(xEdge + 0.5, yTop);
			ctx.lineTo(xEdge + 0.5, yBot);
			ctx.stroke();
			ctx.restore();
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
		const ctx = setupCanvas2d(rowHeadCanvas, ROW_HEADER_WIDTH, containerHeight);
		ctx.clearRect(0, 0, ROW_HEADER_WIDTH, containerHeight);
		ctx.fillStyle = '#f9fafb';
		ctx.fillRect(0, 0, ROW_HEADER_WIDTH, containerHeight);

		const offsetY = -(scrollTop % CELL_HEIGHT);
		ctx.save();
		ctx.translate(0, offsetY);

		// selection highlight in row header (exactly aligned)
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
		ctx.textAlign = 'center';
		ctx.fillStyle = '#475569';
		for (let r = startIndexRow; r < endIndexRow; r++) {
			const y = (r - startIndexRow) * CELL_HEIGHT;
			ctx.fillText(String(r + 1), ROW_HEADER_WIDTH / 2, y + CELL_HEIGHT / 2);

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
