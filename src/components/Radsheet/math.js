// Helpers: local pointer coordinates and pixel -> cell mappers

/** Convert global pointer event coordinates to local element coordinates */
export function localXY(el, e) {
	const r = el.getBoundingClientRect();
	return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Convert local XY coordinates in the grid canvas to a cell row and column */
export function pointToCell(x, y, scrollLeft, scrollTop, CELL_WIDTH, CELL_HEIGHT) {
	const col = Math.floor((x + scrollLeft) / CELL_WIDTH);
	const adjustedY = y + scrollTop;
	const row = Math.max(0, Math.floor(adjustedY / CELL_HEIGHT));
	return { row, col };
}

/** Convert an X coordinate in the column header canvas to a column index */
export function xToColInHeader(x, scrollLeft, CELL_WIDTH) {
	return Math.floor((x + scrollLeft) / CELL_WIDTH);
}

/** Convert a Y coordinate in the row header canvas to a row index */
export function yToRowInHeader(y, scrollTop, CELL_HEIGHT) {
	return Math.floor((y + scrollTop) / CELL_HEIGHT);
}
