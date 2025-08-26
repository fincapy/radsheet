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
	const dpr = window.devicePixelRatio || 1;

	canvas.style.width = cssWidth + 'px';
	canvas.style.height = cssHeight + 'px';

	canvas.width = Math.round(cssWidth * dpr);
	canvas.height = Math.round(cssHeight * dpr);

	const ctx = canvas.getContext('2d');
	ctx.setTransform(1, 0, 0, 1, 0, 0); // reset
	ctx.scale(dpr, dpr);

	return ctx;
}
