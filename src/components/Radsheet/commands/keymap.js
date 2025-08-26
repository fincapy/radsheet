function getKeyDef(e) {
	let def = [];
	if (e.ctrlKey) def.push('Ctrl');
	if (e.metaKey) def.push('Meta');
	if (e.altKey) def.push('Alt');
	if (e.shiftKey) def.push('Shift');
	def.push(e.key);
	return def.join('+');
}

export function createKeymapHandler(keymap, commandBus) {
	return function handleKeyDown(e) {
		if (commandBus.isEditorOpen()) {
			const editorDef = getKeyDef(e);
			const editorAction = keymap.editing[editorDef];
			if (editorAction) {
				e.preventDefault();
				e.stopPropagation();
				commandBus.dispatch(editorAction);
			}
			return; // Let other keys be handled by the input
		}

		const normalDef = getKeyDef(e);
		const normalAction = keymap.normal[normalDef];
		if (normalAction) {
			e.preventDefault();
			commandBus.dispatch(normalAction);
			return;
		}

		// Fallback for single-character typing to open editor
		if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			commandBus.dispatch({ type: 'OpenEditorAndType', payload: { key: e.key } });
		}
	};
}

export const keymap = {
	normal: {
		Enter: { type: 'OpenEditorAtFocus' },
		ArrowUp: { type: 'MoveFocusBy', payload: { dr: -1, dc: 0 } },
		ArrowDown: { type: 'MoveFocusBy', payload: { dr: 1, dc: 0 } },
		ArrowLeft: { type: 'MoveFocusBy', payload: { dr: 0, dc: -1 } },
		ArrowRight: { type: 'MoveFocusBy', payload: { dr: 0, dc: 1 } },
		'Shift+ArrowUp': { type: 'ExtendSelectionBy', payload: { key: 'ArrowUp' } },
		'Shift+ArrowDown': { type: 'ExtendSelectionBy', payload: { key: 'ArrowDown' } },
		'Shift+ArrowLeft': { type: 'ExtendSelectionBy', payload: { key: 'ArrowLeft' } },
		'Shift+ArrowRight': { type: 'ExtendSelectionBy', payload: { key: 'ArrowRight' } },
		'Ctrl+Shift+ArrowUp': { type: 'ExtendSelectionToEdge', payload: { key: 'ArrowUp' } },
		'Ctrl+Shift+ArrowDown': { type: 'ExtendSelectionToEdge', payload: { key: 'ArrowDown' } },
		'Ctrl+Shift+ArrowLeft': { type: 'ExtendSelectionToEdge', payload: { key: 'ArrowLeft' } },
		'Ctrl+Shift+ArrowRight': { type: 'ExtendSelectionToEdge', payload: { key: 'ArrowRight' } },
		PageUp: { type: 'MoveFocusPage', payload: { direction: 'up' } },
		PageDown: { type: 'MoveFocusPage', payload: { direction: 'down' } },
		Home: { type: 'MoveFocusHome' },
		End: { type: 'MoveFocusEnd' },
		'Ctrl+c': { type: 'CopySelection' },
		'Meta+c': { type: 'CopySelection' },
		'Ctrl+z': { type: 'Undo' },
		'Meta+z': { type: 'Undo' },
		'Ctrl+Shift+z': { type: 'Redo' },
		'Meta+Shift+z': { type: 'Redo' },
		'Ctrl+y': { type: 'Redo' },
		'Meta+y': { type: 'Redo' },
		Delete: { type: 'DeleteSelection' },
		Backspace: { type: 'DeleteSelection' }
	},
	editing: {
		Enter: { type: 'CommitEditorAndMove', payload: { dr: 1, dc: 0 } },
		'Shift+Enter': { type: 'CommitEditorAndMove', payload: { dr: -1, dc: 0 } },
		ArrowUp: { type: 'CommitEditorAndMove', payload: { dr: -1, dc: 0 } },
		ArrowDown: { type: 'CommitEditorAndMove', payload: { dr: 1, dc: 0 } },
		ArrowLeft: { type: 'CommitEditorAndMove', payload: { dr: 0, dc: -1 } },
		ArrowRight: { type: 'CommitEditorAndMove', payload: { dr: 0, dc: 1 } },
		Escape: { type: 'CommitEditor', payload: { save: false } },
		Tab: { type: 'CommitEditorAndMove', payload: { dr: 0, dc: 1 } },
		'Shift+Tab': { type: 'CommitEditorAndMove', payload: { dr: 0, dc: -1 } }
	}
};
