// src/components/Radsheet/controllers/viewportController.js

export function createViewportController({ getters, setters }) {
	/** Clamp scroll positions to content bounds. */
	function clampScroll(newTop, newLeft) {
		const maxScrollTop = Math.max(0, getters.getTotalHeight() - getters.getContainerHeight());
		const maxScrollLeft = Math.max(0, getters.getTotalWidth() - getters.getContainerWidth());
		const finalTop = Math.max(0, Math.min(newTop, maxScrollTop));
		const finalLeft = Math.max(0, Math.min(newLeft, maxScrollLeft));

		// Only update if values changed to avoid infinite loops with resize observer
		if (finalTop !== getters.getScrollTop()) {
			setters.setScrollTop(finalTop);
		}
		if (finalLeft !== getters.getScrollLeft()) {
			setters.setScrollLeft(finalLeft);
		}
	}

	/** Handle wheel scrolling inside the main grid. */
	// Coalesce wheel deltas to one state update per animation frame to reduce jank
	let __wheelAccumulatedDeltaX = 0;
	let __wheelAccumulatedDeltaY = 0;
	let __wheelRafScheduled = false;
	function onWheel(e) {
		e.preventDefault();
		__wheelAccumulatedDeltaY += e.deltaY;
		__wheelAccumulatedDeltaX += e.deltaX;
		if (__wheelRafScheduled) return;
		__wheelRafScheduled = true;
		requestAnimationFrame(() => {
			__wheelRafScheduled = false;
			const newTop = getters.getScrollTop() + __wheelAccumulatedDeltaY;
			const newLeft = getters.getScrollLeft() + __wheelAccumulatedDeltaX;
			__wheelAccumulatedDeltaX = 0;
			__wheelAccumulatedDeltaY = 0;
			clampScroll(newTop, newLeft);
		});
	}

	function scrollCellIntoView(r, c) {
		const { CELL_HEIGHT, CELL_WIDTH } = getters.getConstants();
		const cellTop = r * CELL_HEIGHT;
		const leftFn = getters.getColLeft;
		const widthFn = getters.getColWidth;
		const cellLeft = leftFn ? leftFn(c) : c * CELL_WIDTH;
		const cellBottom = cellTop + CELL_HEIGHT;
		const cellRight = cellLeft + (widthFn ? widthFn(c) : CELL_WIDTH);
		let newTop = getters.getScrollTop();
		let newLeft = getters.getScrollLeft();
		const containerHeight = getters.getContainerHeight();
		const containerWidth = getters.getContainerWidth();

		if (cellTop < getters.getScrollTop()) newTop = cellTop;
		else if (cellBottom > getters.getScrollTop() + containerHeight)
			newTop = cellBottom - containerHeight;
		if (cellLeft < getters.getScrollLeft()) newLeft = cellLeft;
		else if (cellRight > getters.getScrollLeft() + containerWidth)
			newLeft = cellRight - containerWidth;
		clampScroll(newTop, newLeft);
	}

	function setupResizeObserver(gridContainerEl) {
		const resizeObserver = new ResizeObserver(() => {
			// On resize, just re-clamp the current scroll positions.
			// This corrects cases where resizing the window would leave empty space.
			clampScroll(getters.getScrollTop(), getters.getScrollLeft());
		});

		if (gridContainerEl) {
			resizeObserver.observe(gridContainerEl);
		}

		return () => {
			resizeObserver.disconnect();
		};
	}

	return {
		onWheel,
		scrollCellIntoView,
		setupResizeObserver,
		clampScroll
	};
}
