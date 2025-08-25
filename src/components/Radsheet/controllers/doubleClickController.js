// Double-click controller
// Encapsulates dblclick behavior for grid and headers.

export function createDoubleClickController({ getters, methods, controllers, refs }) {
	/**
	 * Double click on the main grid should open the editor at the clicked cell.
	 */
	function onGridDblClick(e) {
		const canvas = refs.getGridCanvas();
		if (!canvas) return;
		const { x, y } = methods.localXY(canvas, e);
		const { row, col } = methods.pointToCell(x, y);
		controllers.editor.openEditorAt(row, col);
	}

	/**
	 * Fallback: double clicking on any canvas (e.g., headers) opens the editor at current focus
	 * if the editor is not already open.
	 */
	function onAnyDblClick(e) {
		const target = e.target;
		if (
			target &&
			target.tagName &&
			typeof target.tagName === 'string' &&
			target.tagName.toLowerCase() === 'canvas'
		) {
			// If on column header near an edge, auto-fit that column
			if (target === refs.getColHeadCanvas()) {
				const { x } = methods.localXY(target, e);
				const hitCol = methods.getColEdgeNearX ? methods.getColEdgeNearX(x, 5) : null;
				if (hitCol != null && methods.autoFitColumn) {
					methods.autoFitColumn(hitCol);
					return;
				}
			}
			// If on row header near an edge, auto-fit that row
			if (target === refs.getRowHeadCanvas()) {
				const { y } = methods.localXY(target, e);
				const hitRow = methods.getRowEdgeNearY ? methods.getRowEdgeNearY(y, 5) : null;
				if (hitRow != null && methods.autoFitRow) {
					methods.autoFitRow(hitRow);
					return;
				}
			}
			if (!controllers.editor.isEditorOpen()) {
				controllers.editor.openEditorAt(getters.getLastActiveRow(), getters.getLastActiveCol());
			}
		}
	}

	return {
		onGridDblClick,
		onAnyDblClick
	};
}
