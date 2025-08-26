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

	function setRange(r1, c1, r2, c2) {
		setters.setAnchorRow(r1);
		setters.setAnchorCol(c1);
		setters.setFocusRow(r2);
		setters.setFocusCol(c2);
		setters.setLastActiveRow(r2);
		setters.setLastActiveCol(c2);
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
		if (!sel) return;

		const numCells = (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1);
		const LARGE_THRESHOLD = 10000;
		const useAsync = getters.serializeRangeToTSVAsync && numCells >= LARGE_THRESHOLD;

		const writeTSV = (tsv) => {
			let copied = false;
			if (
				typeof navigator !== 'undefined' &&
				navigator.clipboard &&
				navigator.clipboard.writeText
			) {
				navigator.clipboard.writeText(tsv).then(
					() => {
						setters.setIsSelectionCopied(true);
					},
					() => {
						copyViaTextarea(tsv);
					}
				);
				copied = true;
			}
			if (!copied) copyViaTextarea(tsv);
		};

		if (useAsync) {
			getters.serializeRangeToTSVAsync(sel.r1, sel.c1, sel.r2, sel.c2).then((tsv) => writeTSV(tsv));
			return;
		}

		const tsv = getters.serializeRangeToTSV
			? getters.serializeRangeToTSV(sel.r1, sel.c1, sel.r2, sel.c2)
			: '';
		writeTSV(tsv);

		function copyViaTextarea(text) {
			if (typeof document === 'undefined') return;
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.top = '-1000px';
			ta.style.left = '-1000px';
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			try {
				document.execCommand('copy');
				setters.setIsSelectionCopied(true);
			} catch (_) {
				// no-op
			} finally {
				document.body.removeChild(ta);
			}
		}
	}

	function handlePaste(text) {
		// If text not provided (e.g., invoked via keymap), try clipboard API
		const pasteInto = () => {
			const sel = getSelection();
			const r = sel ? sel.r1 : getters.getLastActiveRow();
			const c = sel ? sel.c1 : getters.getLastActiveCol();
			if (getters.deserializeTSV && typeof text === 'string') {
				const res = getters.deserializeTSV(r, c, text);
				if (res && res.rows > 0 && res.cols > 0) {
					const fr = r + res.rows - 1;
					const fc = c + res.cols - 1;
					setters.setAnchorRow(r);
					setters.setAnchorCol(c);
					setters.setFocusRow(fr);
					setters.setFocusCol(fc);
					setters.setLastActiveRow(fr);
					setters.setLastActiveCol(fc);
					setters.setIsSelectionCopied(false);
					controllers.viewport.scrollCellIntoView(fr, fc);
				}
			}
		};

		if (typeof text === 'string') {
			pasteInto();
			return;
		}

		if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
			navigator.clipboard.readText().then((clipText) => {
				text = clipText;
				pasteInto();
			});
		}
	}

	function deleteSelection(deleteToNull = true) {
		const sel = getSelection();
		if (!sel) {
			// single cell
			const r = getters.getLastActiveRow();
			const c = getters.getLastActiveCol();
			controllers.triggerRedraw();
			return (controllers.editor.updateEditorValue, void 0);
		}

		// Use domain transaction for block deletion via UI-level contract:
		// The `sheet` is not directly accessible here; deletion is exposed via methods.deleteSelection in command bus
	}

	return {
		getSelection,
		setCell,
		setRange,
		moveFocusBy,
		extendSelectionBy,
		extendSelectionToEdge,
		handleCopy,
		handlePaste
	};
}
