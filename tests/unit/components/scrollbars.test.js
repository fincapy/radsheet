import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte/svelte5';
import VerticalScrollbar from '../../../src/lib/VerticalScrollbar.svelte';
import HorizontalScrollbar from '../../../src/lib/HorizontalScrollbar.svelte';

describe('VerticalScrollbar', () => {
	let component;
	let onUpdateMock;

	beforeEach(() => {
		onUpdateMock = vi.fn();
		component = render(VerticalScrollbar, {
			props: {
				scrollTop: 0,
				totalHeight: 1000,
				viewportHeight: 400,
				onUpdate: onUpdateMock
			}
		});
	});

	describe('Rendering', () => {
		it('shows scrollbar when content is larger than viewport', () => {
			const scrollbar = component.container.querySelector('.flex.h-full.w-3');
			expect(scrollbar).toBeTruthy();
		});

		it('hides scrollbar when content fits in viewport', () => {
			component = render(VerticalScrollbar, {
				props: {
					scrollTop: 0,
					totalHeight: 300,
					viewportHeight: 400,
					onUpdate: onUpdateMock
				}
			});

			const scrollbar = component.container.querySelector('.flex.h-full.w-3');
			expect(scrollbar).toBeFalsy();
		});

		it('calculates thumb height correctly', () => {
			// With 1000 total height and 400 viewport, thumb should be 40% of track
			const thumb = component.container.querySelector('.absolute.w-full');
			expect(thumb).toBeTruthy();

			// Check that thumb height is set
			const style = thumb.style.height;
			expect(style).toBeTruthy();
			expect(style).toMatch(/^\d+px$/);
		});

		it('calculates thumb position correctly', () => {
			// At scrollTop 0, thumb should be at top
			let thumb = component.container.querySelector('.absolute.w-full');
			let topPosition = parseInt(thumb.style.top);
			expect(topPosition).toBe(0);

			// Update to scrollTop 300
			component = render(VerticalScrollbar, {
				props: {
					scrollTop: 300,
					totalHeight: 1000,
					viewportHeight: 400,
					onUpdate: onUpdateMock
				}
			});

			thumb = component.container.querySelector('.absolute.w-full');
			topPosition = parseInt(thumb.style.top);
			expect(topPosition).toBeGreaterThan(0);
		});
	});

	describe('Thumb Dragging', () => {
		it('starts dragging on mouse down', async () => {
			const thumb = component.container.querySelector('.absolute.w-full');
			expect(thumb).toBeTruthy();

			await fireEvent.mouseDown(thumb, { button: 0, clientY: 100 });

			// Should add dragging class
			expect(thumb.className).toContain('!bg-gray-600');
		});

		it('updates scroll position on drag', async () => {
			const thumb = component.container.querySelector('.absolute.w-full');

			// Start drag
			await fireEvent.mouseDown(thumb, { button: 0, clientY: 100 });

			// Move mouse
			await fireEvent.mouseMove(window, { clientY: 200 });

			// Should call onUpdate
			expect(onUpdateMock).toHaveBeenCalled();
		});

		it('stops dragging on mouse up', async () => {
			const thumb = component.container.querySelector('.absolute.w-full');

			// Start drag
			await fireEvent.mouseDown(thumb, { button: 0, clientY: 100 });
			expect(thumb.className).toContain('!bg-gray-600');

			// Stop drag
			await fireEvent.mouseUp(window);

			// Should remove dragging class
			expect(thumb.className).not.toContain('!bg-gray-600');
		});

		it('ignores right mouse button', async () => {
			const thumb = component.container.querySelector('.absolute.w-full');

			await fireEvent.mouseDown(thumb, { button: 2, clientY: 100 });

			// Should not start dragging
			expect(thumb.className).not.toContain('!bg-gray-600');
		});
	});

	describe('Track Clicking', () => {
		it('scrolls up when clicking above thumb', async () => {
			// Start with non-zero scroll so clicking above attempts to go negative
			component = render(VerticalScrollbar, {
				props: {
					scrollTop: 400,
					totalHeight: 1000,
					viewportHeight: 400,
					onUpdate: onUpdateMock
				}
			});
			const track = component.container.querySelector('.relative.flex-grow');
			expect(track).toBeTruthy();

			// Click above thumb position
			await fireEvent.mouseDown(track, { clientY: 50 });

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollTop = onUpdateMock.mock.calls[0][0];
			expect(newScrollTop).toBeLessThan(400);
		});

		it('scrolls down when clicking below thumb', async () => {
			const track = component.container.querySelector('.relative.flex-grow');

			// Click below thumb position
			await fireEvent.mouseDown(track, { clientY: 200 });

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollTop = onUpdateMock.mock.calls[0][0];
			expect(newScrollTop).toBeGreaterThan(0); // Should scroll down
		});
	});

	describe('Arrow Buttons', () => {
		it('scrolls up when up button is clicked', async () => {
			const upButton = component.container.querySelector('button[title="Scroll up"]');
			expect(upButton).toBeTruthy();

			await fireEvent.click(upButton);

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollTop = onUpdateMock.mock.calls[0][0];
			expect(newScrollTop).toBe(0); // Clamped at top
		});

		it('scrolls down when down button is clicked', async () => {
			const downButton = component.container.querySelector('button[title="Scroll down"]');
			expect(downButton).toBeTruthy();

			await fireEvent.click(downButton);

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollTop = onUpdateMock.mock.calls[0][0];
			expect(newScrollTop).toBe(40); // Should scroll down by 40px
		});
	});

	describe('Boundary Conditions', () => {
		it('clamps scroll position to minimum', async () => {
			const upButton = component.container.querySelector('button[title="Scroll up"]');

			// Try to scroll up from position 0
			await fireEvent.click(upButton);

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollTop = onUpdateMock.mock.calls[0][0];
			expect(newScrollTop).toBe(0); // Should clamp to 0
		});

		it('clamps scroll position to maximum', async () => {
			// Set scroll to maximum
			component = render(VerticalScrollbar, {
				props: {
					scrollTop: 600, // max scroll for 1000 total - 400 viewport
					totalHeight: 1000,
					viewportHeight: 400,
					onUpdate: onUpdateMock
				}
			});

			const downButton = component.container.querySelector('button[title="Scroll down"]');

			// Try to scroll down from maximum position
			await fireEvent.click(downButton);

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollTop = onUpdateMock.mock.calls[0][0];
			expect(newScrollTop).toBe(600); // Should clamp to maximum
		});
	});

	describe('Accessibility', () => {
		it('has proper ARIA labels', () => {
			const track = component.container.querySelector('[aria-label="Scroll track"]');
			const thumb = component.container.querySelector('[aria-label="Scroll thumb"]');
			const upButton = component.container.querySelector('[aria-label="Scroll up"]');
			const downButton = component.container.querySelector('[aria-label="Scroll down"]');

			expect(track).toBeTruthy();
			expect(thumb).toBeTruthy();
			expect(upButton).toBeTruthy();
			expect(downButton).toBeTruthy();
		});

		it('supports keyboard navigation', () => {
			const track = component.container.querySelector('[tabindex="0"]');
			const thumb = component.container.querySelector('[tabindex="0"]');

			expect(track).toBeTruthy();
			expect(thumb).toBeTruthy();
		});
	});
});

describe('HorizontalScrollbar', () => {
	let component;
	let onUpdateMock;

	beforeEach(() => {
		onUpdateMock = vi.fn();
		component = render(HorizontalScrollbar, {
			props: {
				scrollLeft: 0,
				totalWidth: 2000,
				containerWidth: 800,
				onUpdate: onUpdateMock
			}
		});
	});

	describe('Rendering', () => {
		it('shows scrollbar when content is wider than container', () => {
			const scrollbar = component.container.querySelector('.flex.h-3.w-full');
			expect(scrollbar).toBeTruthy();
		});

		it('hides scrollbar when content fits in container', () => {
			component = render(HorizontalScrollbar, {
				props: {
					scrollLeft: 0,
					totalWidth: 600,
					containerWidth: 800,
					onUpdate: onUpdateMock
				}
			});

			const scrollbar = component.container.querySelector('.flex.h-3.w-full');
			expect(scrollbar).toBeFalsy();
		});

		it('calculates thumb width correctly', () => {
			// With 2000 total width and 800 container, thumb should be 40% of track
			const thumb = component.container.querySelector('.absolute.h-full');
			expect(thumb).toBeTruthy();

			const style = thumb.style.width;
			expect(style).toBeTruthy();
			expect(style).toMatch(/^\d+px$/);
		});

		it('calculates thumb position correctly', () => {
			// At scrollLeft 0, thumb should be at left
			let thumb = component.container.querySelector('.absolute.h-full');
			let leftPosition = parseInt(thumb.style.left);
			expect(leftPosition).toBe(0);

			// Update to scrollLeft 400
			component = render(HorizontalScrollbar, {
				props: {
					scrollLeft: 400,
					totalWidth: 2000,
					containerWidth: 800,
					onUpdate: onUpdateMock
				}
			});

			thumb = component.container.querySelector('.absolute.h-full');
			leftPosition = parseInt(thumb.style.left);
			expect(leftPosition).toBeGreaterThan(0);
		});
	});

	describe('Thumb Dragging', () => {
		it('starts dragging on mouse down', async () => {
			const thumb = component.container.querySelector('.absolute.h-full');
			expect(thumb).toBeTruthy();

			await fireEvent.mouseDown(thumb, { button: 0, clientX: 100 });

			// Should add dragging class
			expect(thumb.className).toContain('!bg-gray-600');
		});

		it('updates scroll position on drag', async () => {
			const thumb = component.container.querySelector('.absolute.h-full');

			// Start drag
			await fireEvent.mouseDown(thumb, { button: 0, clientX: 100 });

			// Move mouse
			await fireEvent.mouseMove(window, { clientX: 200 });

			// Should call onUpdate
			expect(onUpdateMock).toHaveBeenCalled();
		});

		it('stops dragging on mouse up', async () => {
			const thumb = component.container.querySelector('.absolute.h-full');

			// Start drag
			await fireEvent.mouseDown(thumb, { button: 0, clientX: 100 });
			expect(thumb.className).toContain('!bg-gray-600');

			// Stop drag
			await fireEvent.mouseUp(window);

			// Should remove dragging class
			expect(thumb.className).not.toContain('!bg-gray-600');
		});
	});

	describe('Track Clicking', () => {
		it('scrolls left when clicking left of thumb', async () => {
			// Start with non-zero scroll
			component = render(HorizontalScrollbar, {
				props: {
					scrollLeft: 800,
					totalWidth: 2000,
					containerWidth: 800,
					onUpdate: onUpdateMock
				}
			});
			const track = component.container.querySelector('.relative.flex-grow');
			expect(track).toBeTruthy();

			// Click left of thumb position
			await fireEvent.mouseDown(track, { clientX: 50 });

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollLeft = onUpdateMock.mock.calls[0][0];
			expect(newScrollLeft).toBeLessThan(800);
		});

		it('scrolls right when clicking right of thumb', async () => {
			const track = component.container.querySelector('.relative.flex-grow');

			// Click right of thumb position
			await fireEvent.mouseDown(track, { clientX: 200 });

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollLeft = onUpdateMock.mock.calls[0][0];
			expect(newScrollLeft).toBeGreaterThan(0); // Should scroll right
		});
	});

	describe('Arrow Buttons', () => {
		it('scrolls left when left button is clicked', async () => {
			const leftButton = component.container.querySelector('button[title="Scroll left"]');
			expect(leftButton).toBeTruthy();

			await fireEvent.click(leftButton);

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollLeft = onUpdateMock.mock.calls[0][0];
			expect(newScrollLeft).toBe(0); // Clamped at left edge
		});

		it('scrolls right when right button is clicked', async () => {
			const rightButton = component.container.querySelector('button[title="Scroll right"]');
			expect(rightButton).toBeTruthy();

			await fireEvent.click(rightButton);

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollLeft = onUpdateMock.mock.calls[0][0];
			expect(newScrollLeft).toBe(40); // Should scroll right by 40px
		});
	});

	describe('Boundary Conditions', () => {
		it('clamps scroll position to minimum', async () => {
			const leftButton = component.container.querySelector('button[title="Scroll left"]');

			// Try to scroll left from position 0
			await fireEvent.click(leftButton);

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollLeft = onUpdateMock.mock.calls[0][0];
			expect(newScrollLeft).toBe(0); // Should clamp to 0
		});

		it('clamps scroll position to maximum', async () => {
			// Set scroll to maximum
			component = render(HorizontalScrollbar, {
				props: {
					scrollLeft: 1200, // max scroll for 2000 total - 800 container
					totalWidth: 2000,
					containerWidth: 800,
					onUpdate: onUpdateMock
				}
			});

			const rightButton = component.container.querySelector('button[title="Scroll right"]');

			// Try to scroll right from maximum position
			await fireEvent.click(rightButton);

			expect(onUpdateMock).toHaveBeenCalled();
			const newScrollLeft = onUpdateMock.mock.calls[0][0];
			expect(newScrollLeft).toBe(1200); // Should clamp to maximum
		});
	});

	describe('Accessibility', () => {
		it('has proper ARIA labels', () => {
			const track = component.container.querySelector('[aria-label="Scroll track"]');
			const thumb = component.container.querySelector('[aria-label="Scroll thumb"]');
			const leftButton = component.container.querySelector('[aria-label="Scroll left"]');
			const rightButton = component.container.querySelector('[aria-label="Scroll right"]');

			expect(track).toBeTruthy();
			expect(thumb).toBeTruthy();
			expect(leftButton).toBeTruthy();
			expect(rightButton).toBeTruthy();
		});

		it('supports keyboard navigation', () => {
			const track = component.container.querySelector('[tabindex="0"]');
			const thumb = component.container.querySelector('[tabindex="0"]');

			expect(track).toBeTruthy();
			expect(thumb).toBeTruthy();
		});
	});
});
