export function createSelectionController({ getters, setters, controllers }) {
	/**
	 * Computes the normalized selection range from the current anchor and focus.
	 * This is a pure getter but co-located for clarity.
	 */
	function getSelection() {
		const anchorRow = getters.getAnchorRow();
		const focusRow = getters.getFocusRow();
		const anchorCol = getters.getAnchorCol();
		const focusCol = getters.getFocusCol();

		if (anchorRow == null || focusRow == null) return null;

		const r1 = Math.max(0, Math.min(anchorRow, focusRow));
		const r2 = Math.min(getters.getSheetNumRows() - 1, Math.max(anchorRow, focusRow));
		const c1 = Math.max(0, Math.min(anchorCol, focusCol));
		const c2 = Math.min(getters.getColumnsLength() - 1, Math.max(anchorCol, focusCol));
		return { r1, r2, c1, c2 };
	}

	/**
	 * Sets the selection to a single cell, clearing any previous selection.
	 * Used when opening the editor or committing an edit.
	 */
	function setCell(r, c) {
		setters.setAnchorRow(r);
		setters.setFocusRow(r);
		setters.setLastActiveRow(r);
		setters.setAnchorCol(c);
		setters.setFocusCol(c);
		setters.setLastActiveCol(c);
		setters.setIsSelectionCopied(false);
	}

	/**
	 * Moves the focus cell, collapsing any existing selection.
	 */
	function moveFocusBy(dr, dc) {
		const r = Math.min(Math.max(getters.getLastActiveRow() + dr, 0), getters.getSheetNumRows() - 1);
		const c = Math.min(
			Math.max(getters.getLastActiveCol() + dc, 0),
			getters.getColumnsLength() - 1
		);
		setCell(r, c);
		controllers.viewport.scrollCellIntoView(r, c);
	}

	/**
	 * Extends the current selection by one cell in the given direction.
	 */
	function extendSelectionBy(key) {
		// If no selection exists, create one with current cell as anchor
		if (getters.getAnchorRow() === null || getters.getAnchorCol() === null) {
			setters.setAnchorRow(getters.getLastActiveRow());
			setters.setAnchorCol(getters.getLastActiveCol());
		}

		const nav = {
			ArrowUp: [-1, 0],
			ArrowDown: [1, 0],
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1]
		};

		const [dr, dc] = nav[key];
		const newFocusRow = Math.min(
			Math.max(getters.getFocusRow() + dr, 0),
			getters.getSheetNumRows() - 1
		);
		const newFocusCol = Math.min(
			Math.max(getters.getFocusCol() + dc, 0),
			getters.getColumnsLength() - 1
		);

		setters.setFocusRow(newFocusRow);
		setters.setFocusCol(newFocusCol);
		setters.setLastActiveRow(newFocusRow);
		setters.setLastActiveCol(newFocusCol);

		controllers.viewport.scrollCellIntoView(newFocusRow, newFocusCol);
	}

	/**
	 * Extends the selection to the edge of the data in the given direction.
	 */
	function extendSelectionToEdge(key) {
		// If no selection exists, create one with current cell as anchor
		if (getters.getAnchorRow() === null || getters.getAnchorCol() === null) {
			setters.setAnchorRow(getters.getLastActiveRow());
			setters.setAnchorCol(getters.getLastActiveCol());
		}

		let newFocusRow = getters.getFocusRow();
		let newFocusCol = getters.getFocusCol();

		switch (key) {
			case 'ArrowUp':
				newFocusRow = 0;
				break;
			case 'ArrowDown':
				newFocusRow = getters.getSheetNumRows() - 1;
				break;
			case 'ArrowLeft':
				newFocusCol = 0;
				break;
			case 'ArrowRight':
				newFocusCol = getters.getColumnsLength() - 1;
				break;
		}

		setters.setFocusRow(newFocusRow);
		setters.setFocusCol(newFocusCol);
		setters.setLastActiveRow(newFocusRow);
		setters.setLastActiveCol(newFocusCol);

		controllers.viewport.scrollCellIntoView(newFocusRow, newFocusCol);
	}

	function handleCopy() {
		const sel = getSelection();
		if (sel) {
			setters.setIsSelectionCopied(true);
		}
	}

	return {
		getSelection,
		setCell,
		moveFocusBy,
		extendSelectionBy,
		extendSelectionToEdge,
		handleCopy
	};
}
