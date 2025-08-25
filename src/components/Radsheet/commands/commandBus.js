export function createCommandBus({ getters, setters, controllers }) {
	function dispatch(action) {
		const { type, payload } = action;

		switch (type) {
			// Selection Commands
			case 'MoveFocusBy':
				controllers.selection.moveFocusBy(payload.dr, payload.dc);
				break;
			case 'ExtendSelectionBy':
				controllers.selection.extendSelectionBy(payload.key);
				break;
			case 'ExtendSelectionToEdge':
				controllers.selection.extendSelectionToEdge(payload.key);
				break;
			case 'MoveFocusPage': {
				const visibleRows = Math.floor(
					getters.getContainerHeight() / getters.getConstants().CELL_HEIGHT
				);
				const dr = payload.direction === 'up' ? -visibleRows + 1 : visibleRows - 1;
				controllers.selection.moveFocusBy(dr, 0);
				break;
			}
			case 'MoveFocusHome':
				controllers.selection.moveFocusBy(0, -getters.getLastActiveCol());
				break;
			case 'MoveFocusEnd':
				controllers.selection.moveFocusBy(0, getters.getColumnsLength() - 1);
				break;

			// Editor Commands
			case 'OpenEditorAtFocus':
				controllers.editor.openEditorAt(getters.getLastActiveRow(), getters.getLastActiveCol());
				break;
			case 'OpenEditorAndType':
				controllers.editor.openEditorAt(
					getters.getLastActiveRow(),
					getters.getLastActiveCol(),
					payload.key
				);
				break;
			case 'CommitEditor':
				controllers.editor.commitEditor(payload.save);
				break;
			case 'CommitEditorAndMove':
				controllers.editor.commitEditor(true);
				controllers.selection.moveFocusBy(payload.dr, payload.dc);
				break;
			case 'UpdateEditorValue':
				controllers.editor.updateEditorValue(payload.value);
				break;
			case 'CopySelection':
				controllers.selection.handleCopy();
				break;
			case 'PasteFromClipboard':
				controllers.selection.handlePaste(payload.text);
				break;

			default:
				console.warn('Unknown command type:', type);
		}

		// After every command, redraw
		setters.triggerRedraw();
	}

	// Expose a getter for the keymap handler to check editor state
	function isEditorOpen() {
		return controllers.editor.isEditorOpen();
	}

	return {
		dispatch,
		isEditorOpen
	};
}
