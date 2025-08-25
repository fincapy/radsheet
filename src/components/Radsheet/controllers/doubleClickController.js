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
