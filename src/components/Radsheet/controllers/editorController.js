export function createEditorController({ editorState, getters, setters, controllers }) {
	function openEditorAt(row, col, seedText = null) {
		const current = String(getters.readCell(row, col) ?? '');
		editorState.open = true;
		editorState.row = row;
		editorState.col = col;
		editorState.value = seedText != null ? seedText : current;
		editorState.seedText = seedText;

		controllers.viewport.scrollCellIntoView(row, col);
		controllers.selection.setCell(row, col);
	}

	function commitEditor(save) {
		if (!editorState.open) return;
		const { row, col, value } = editorState;
		editorState.open = false;

		if (save) {
			setters.writeCell(row, col, value);
		}
		controllers.selection.setCell(row, col);
	}

	function updateEditorValue(value) {
		if (editorState.open) {
			editorState.value = value;
		}
	}

	function isEditorOpen() {
		return editorState.open;
	}

	return {
		openEditorAt,
		commitEditor,
		updateEditorValue,
		isEditorOpen
	};
}
