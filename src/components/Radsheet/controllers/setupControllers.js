import { createViewportController } from './viewportController.js';
import { createSelectionController } from './selectionController.js';
import { createEditorController } from './editorController.js';
import { createCommandBus } from '../commands/commandBus.js';
import { createDragSelectionController } from './dragSelectionController.js';
import { createDoubleClickController } from './doubleClickController.js';

// Orchestrates controller creation with consistent wiring.
export function setupControllers({
	viewport: vp,
	selection: sel,
	editor: ed,
	methods,
	refs,
	constants
}) {
	const viewport = createViewportController({
		getters: {
			getScrollTop: vp.getters.getScrollTop,
			getScrollLeft: vp.getters.getScrollLeft,
			getContainerHeight: vp.getters.getContainerHeight,
			getContainerWidth: vp.getters.getContainerWidth,
			getTotalHeight: vp.getters.getTotalHeight,
			getTotalWidth: vp.getters.getTotalWidth,
			getConstants: vp.getters.getConstants,
			getColLeft: vp.getters.getColLeft,
			getColWidth: vp.getters.getColWidth
		},
		setters: {
			setScrollTop: vp.setters.setScrollTop,
			setScrollLeft: vp.setters.setScrollLeft
		}
	});

	const selection = createSelectionController({
		getters: {
			getAnchorRow: sel.getters.getAnchorRow,
			getAnchorCol: sel.getters.getAnchorCol,
			getFocusRow: sel.getters.getFocusRow,
			getFocusCol: sel.getters.getFocusCol,
			getLastActiveRow: sel.getters.getLastActiveRow,
			getLastActiveCol: sel.getters.getLastActiveCol,
			getSheetNumRows: sel.getters.getSheetNumRows,
			getColumnsLength: sel.getters.getColumnsLength,
			readCell: ed.readCell,
			serializeRangeToTSV: ed.serializeRangeToTSV,
			serializeRangeToTSVAsync: ed.serializeRangeToTSVAsync,
			deserializeTSV: (r, c, text) => {
				// Use editor setters to write block through domain
				if (ed.deserializeTSV) {
					const { rows, cols } = ed.deserializeTSV(r, c, text);
					// No-op here; UI redraw handled by outer triggerRedraws
					return { rows, cols };
				}
				return { rows: 0, cols: 0 };
			}
		},
		setters: {
			setAnchorRow: sel.setters.setAnchorRow,
			setAnchorCol: sel.setters.setAnchorCol,
			setFocusRow: sel.setters.setFocusRow,
			setFocusCol: sel.setters.setFocusCol,
			setLastActiveRow: sel.setters.setLastActiveRow,
			setLastActiveCol: sel.setters.setLastActiveCol,
			setIsSelectionCopied: sel.setters.setIsSelectionCopied
		},
		controllers: { viewport, triggerRedraw: methods.triggerRedraw }
	});

	const editor = createEditorController({
		editorState: ed.state,
		getters: {
			readCell: ed.readCell
		},
		setters: {
			writeCell: ed.writeCell
		},
		controllers: { viewport, selection }
	});

	const commandBus = createCommandBus({
		getters: {
			isEditorOpen: () => editor.isEditorOpen(),
			getLastActiveRow: sel.getters.getLastActiveRow,
			getLastActiveCol: sel.getters.getLastActiveCol,
			getContainerHeight: vp.getters.getContainerHeight,
			getConstants: vp.getters.getConstants,
			getColumnsLength: sel.getters.getColumnsLength
		},
		setters: {
			triggerRedraw: methods.triggerRedraw
		},
		controllers: { selection, editor }
	});

	const drag = createDragSelectionController({
		getters: {
			getSelecting: sel.getters.getSelecting,
			getDragMode: sel.getters.getDragMode,
			getNumRows: sel.getters.getNumRows,
			getColumnsLength: sel.getters.getColumnsLength,
			getContainerWidth: vp.getters.getContainerWidth,
			getContainerHeight: vp.getters.getContainerHeight,
			getScrollTop: vp.getters.getScrollTop,
			getScrollLeft: vp.getters.getScrollLeft,
			getLastActiveRow: sel.getters.getLastActiveRow,
			getLastActiveCol: sel.getters.getLastActiveCol,
			getAnchorRow: sel.getters.getAnchorRow,
			getAnchorCol: sel.getters.getAnchorCol
		},
		setters: {
			setSelecting: sel.setters.setSelecting,
			setDragMode: sel.setters.setDragMode,
			setAnchorRow: sel.setters.setAnchorRow,
			setAnchorCol: sel.setters.setAnchorCol,
			setFocusRow: sel.setters.setFocusRow,
			setFocusCol: sel.setters.setFocusCol,
			setLastActiveRow: sel.setters.setLastActiveRow,
			setLastActiveCol: sel.setters.setLastActiveCol,
			setIsSelectionCopied: sel.setters.setIsSelectionCopied
		},
		methods: {
			isEditorOpen: () => editor.isEditorOpen(),
			commitEditor: (save) => editor.commitEditor(save),
			drawHeaders: methods.drawHeaders,
			drawGrid: methods.drawGrid,
			getSelection: () => selection.getSelection(),
			clampScroll: viewport.clampScroll,
			localXY: methods.localXY,
			pointToCell: methods.pointToCell,
			xToColInHeader: methods.xToColInHeader,
			yToRowInHeader: methods.yToRowInHeader,
			getColEdgeNearX: methods.getColEdgeNearX,
			setColumnWidth: methods.setColumnWidth,
			getColLeft: methods.getColLeft,
			setHoverResizeCol: methods.setHoverResizeCol,
			getRowEdgeNearY: methods.getRowEdgeNearY,
			setRowHeight: methods.setRowHeight,
			getRowTop: methods.getRowTop
		},
		refs,
		constants
	});

	const dbl = createDoubleClickController({
		getters: {
			getLastActiveRow: sel.getters.getLastActiveRow,
			getLastActiveCol: sel.getters.getLastActiveCol
		},
		methods: {
			localXY: methods.localXY,
			pointToCell: methods.pointToCell,
			getColEdgeNearX: methods.getColEdgeNearX,
			autoFitColumn: methods.autoFitColumn,
			getRowEdgeNearY: methods.getRowEdgeNearY,
			autoFitRow: methods.autoFitRow
		},
		controllers: { editor },
		refs
	});

	return { viewport, selection, editor, commandBus, drag, dbl };
}
