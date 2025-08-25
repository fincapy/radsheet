/**
 * Canvas utilities used by the Radsheet renderers.
 *
 * We keep this small and focused so draw routines can stay pure-ish and testable.
 */

/**
 * Prepares a 2D canvas for crisp rendering on HiDPI displays.
 * - Sets backing store size based on devicePixelRatio
 * - Sets CSS size to requested logical width/height
 * - Returns a 2D rendering context with a scaling transform applied
 */
export function setupCanvas2d(canvas, cssWidth, cssHeight) {
	const dpr = Math.max(1, window.devicePixelRatio || 1);
	canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
	canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
	canvas.style.width = cssWidth + 'px';
	canvas.style.height = cssHeight + 'px';
	const ctx = canvas.getContext('2d');
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	return ctx;
}
