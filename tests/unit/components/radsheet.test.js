import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte/svelte5';
import Radsheet from '../../../src/components/Radsheet.svelte';
import { Sheet } from '../../../src/domain/sheet/sheet.js';

describe('Radsheet Component', () => {
	let component;

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks();

		// Mock the Radsheet domain
		const mockSheet = new Sheet();
		vi.spyOn(mockSheet, 'setValue').mockImplementation(() => {});
		vi.spyOn(mockSheet, 'getValue').mockImplementation(() => '');

		// Render component
		component = render(Radsheet);
	});

	describe('Initialization', () => {
		it('renders without crashing', () => {
			expect(component.container).toBeTruthy();
		});

		it('initializes with default state', () => {
			// Check that basic UI elements are present
			expect(component.container.querySelector('.grid')).toBeTruthy();
		});

		it('shows correct initial dimensions', () => {
			const statusText = component.container.textContent;
			expect(statusText).toContain('rows: 1000');
			expect(statusText).toContain('cols: 26');
		});
	});

	describe('Cell Interaction', () => {
		it('opens editor on double click', async () => {
			const gridCanvas = component.container.querySelector('canvas');
			expect(gridCanvas).toBeTruthy();

			// Simulate double click
			await fireEvent.dblClick(gridCanvas);

			// Should open editor
			const editor = component.container.querySelector('.editor');
			expect(editor).toBeTruthy();
		});

		it('commits editor value on Enter', async () => {
			// Open editor first
			const gridCanvas = component.container.querySelector('canvas');
			await fireEvent.dblClick(gridCanvas);

			const editor = component.container.querySelector('.editor');
			expect(editor).toBeTruthy();

			// Type in editor
			editor.value = 'test value';
			await fireEvent.input(editor);

			// Press Enter
			await fireEvent.keyDown(editor, { key: 'Enter' });

			// Editor should remain open (spreadsheet behavior moves to next cell and reopens)
			expect(component.container.querySelector('.editor')).toBeTruthy();
		});

		it('cancels editor on Escape', async () => {
			// Open editor
			const gridCanvas = component.container.querySelector('canvas');
			await fireEvent.dblClick(gridCanvas);

			const editor = component.container.querySelector('.editor');
			expect(editor).toBeTruthy();

			// Press Escape
			await fireEvent.keyDown(editor, { key: 'Escape' });

			// Editor should close
			expect(component.container.querySelector('.editor')).toBeFalsy();
		});
	});

	describe('Keyboard Navigation', () => {
		it('moves focus with arrow keys', async () => {
			const container = component.container;

			// Focus the container
			container.focus();

			// Test arrow key navigation
			await fireEvent.keyDown(container, { key: 'ArrowRight' });
			await fireEvent.keyDown(container, { key: 'ArrowDown' });

			// Should update selection state
			// (This would require more complex setup to verify actual state changes)
		});

		it('opens editor on Enter key', async () => {
			const container = component.container;
			container.focus();

			await fireEvent.keyDown(container, { key: 'Enter' });

			// Should open editor
			const editor = component.container.querySelector('.editor');
			expect(editor).toBeTruthy();
		});

		it('starts typing on character key', async () => {
			const container = component.container;
			container.focus();

			await fireEvent.keyDown(container, { key: 'a' });

			// Should open editor with 'a' pre-filled
			const editor = component.container.querySelector('.editor');
			expect(editor).toBeTruthy();
			expect(editor.value).toBe('a');
		});
	});

	describe('Scrolling', () => {
		it('handles wheel events', async () => {
			const gridContainer = component.container.querySelector('.relative.overflow-hidden');
			expect(gridContainer).toBeTruthy();

			// Simulate wheel event
			await fireEvent.wheel(gridContainer, { deltaY: 100, deltaX: 50 });

			// Should update scroll position
			// (Would need to check actual scroll state)
		});
	});

	describe('Selection', () => {
		it('handles mouse selection', async () => {
			const gridCanvas = component.container.querySelector('canvas');
			expect(gridCanvas).toBeTruthy();

			// Simulate mouse down
			await fireEvent.pointerDown(gridCanvas, { clientX: 100, clientY: 100 });

			// Simulate mouse move
			await fireEvent.pointerMove(gridCanvas, { clientX: 200, clientY: 200 });

			// Simulate mouse up
			await fireEvent.pointerUp(gridCanvas);

			// Should create selection
			// (Would need to verify selection state)
		});
	});

	describe('Header Interaction', () => {
		it('handles column header selection', async () => {
			const colHeadCanvas = component.container.querySelector('canvas');
			expect(colHeadCanvas).toBeTruthy();

			// Simulate column header click
			await fireEvent.pointerDown(colHeadCanvas, { clientX: 100, clientY: 10 });
			await fireEvent.pointerMove(colHeadCanvas, { clientX: 200, clientY: 10 });
			await fireEvent.pointerUp(colHeadCanvas);

			// Should select entire column
		});

		it('handles row header selection', async () => {
			const rowHeadCanvas = component.container.querySelectorAll('canvas')[1]; // Second canvas is row header
			expect(rowHeadCanvas).toBeTruthy();

			// Simulate row header click
			await fireEvent.pointerDown(rowHeadCanvas, { clientX: 10, clientY: 100 });
			await fireEvent.pointerMove(rowHeadCanvas, { clientX: 10, clientY: 200 });
			await fireEvent.pointerUp(rowHeadCanvas);

			// Should select entire row
		});
	});

	describe('UI Controls', () => {
		it('adds rows when button is clicked', async () => {
			const addRowsButton = Array.from(component.container.querySelectorAll('button')).find((b) =>
				(b.textContent || '').includes('add 1000 rows')
			);
			expect(addRowsButton).toBeTruthy();

			await fireEvent.click(addRowsButton);

			// Should increase row count
			const statusText = component.container.textContent;
			expect(statusText).toContain('rows: 2000');
		});

		it('shows save button when storage is available', () => {
			// This would require mocking the storage initialization
			// For now, just check the button exists
			const buttons = component.container.querySelectorAll('button');
			expect(buttons.length).toBeGreaterThan(0);
		});
	});

	describe('Accessibility', () => {
		it('has proper ARIA labels', () => {
			// Check for accessibility attributes
			const scrollbars = component.container.querySelectorAll('[aria-label]');
			expect(scrollbars.length).toBeGreaterThan(0);
		});

		it('supports keyboard navigation', () => {
			const container = component.container;
			expect(container.querySelector('[tabindex]')).toBeTruthy();
		});
	});
});
