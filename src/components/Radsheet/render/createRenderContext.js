// Centralizes assembly of parameters for draw functions.

export function createRenderContext(env) {
	// env supplies live closures/values from the component
	const api = {
		getGridParams() {
			return {
				gridCanvas: env.gridCanvas(),
				containerWidth: env.containerWidth(),
				containerHeight: env.containerHeight(),
				CELL_WIDTH: env.CELL_WIDTH,
				CELL_HEIGHT: env.CELL_HEIGHT,
				startIndexCol: env.startIndexCol(),
				endIndexCol: env.endIndexCol(),
				startIndexRow: env.startIndexRow(),
				endIndexRow: env.endIndexRow(),
				visibleRowCount: env.visibleRowCount(),
				visibleColCount: env.visibleColCount(),
				scrollLeft: env.scrollLeft(),
				scrollTop: env.scrollTop(),
				readCell: env.readCell,
				getSelection: env.getSelection,
				anchorRow: env.anchorRow(),
				anchorCol: env.anchorCol(),
				isSelectionCopied: env.isSelectionCopied(),
				getColWidth: env.getColWidth,
				colLeft: env.colLeft,
				getRowHeight: env.getRowHeight,
				rowTop: env.rowTop,
				theme: env.theme ? env.theme() : undefined
			};
		},
		getHeaderParams() {
			return {
				colHeadCanvas: env.colHeadCanvas(),
				rowHeadCanvas: env.rowHeadCanvas(),
				containerWidth: env.containerWidth(),
				containerHeight: env.containerHeight(),
				COLUMN_HEADER_HEIGHT: env.COLUMN_HEADER_HEIGHT,
				ROW_HEADER_WIDTH: env.ROW_HEADER_WIDTH,
				CELL_WIDTH: env.CELL_WIDTH,
				CELL_HEIGHT: env.CELL_HEIGHT,
				columns: typeof env.columns === 'function' ? env.columns() : env.columns,
				scrollLeft: env.scrollLeft(),
				scrollTop: env.scrollTop(),
				startIndexCol: env.startIndexCol(),
				endIndexCol: env.endIndexCol(),
				startIndexRow: env.startIndexRow(),
				endIndexRow: env.endIndexRow(),
				getSelection: env.getSelection,
				getColWidth: env.getColWidth,
				colLeft: env.colLeft,
				getHoverResizeCol: env.getHoverResizeCol,
				getRowHeight: env.getRowHeight,
				rowTop: env.rowTop,
				getHoverResizeRow: env.getHoverResizeRow,
				theme: env.theme ? env.theme() : undefined
			};
		}
	};

	return api;
}
