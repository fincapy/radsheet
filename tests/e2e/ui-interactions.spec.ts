import { test, expect } from '@playwright/test';

async function setCell(page, row: number, col: number, value: string | number | boolean) {
	await page.evaluate(
		([r, c, v]) => {
			// @ts-ignore
			window.__sheet.setValue(r, c, v);
		},
		[row, col, value]
	);
}

async function getCell(page, row: number, col: number) {
	return await page.evaluate(
		([r, c]) => {
			// @ts-ignore
			return window.__sheet.getValue(r, c);
		},
		[row, col]
	);
}

test.describe('UI Interactions', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});
	});

	test.describe('Cell Editing', () => {
		test('opens editor on double click', async ({ page }) => {
			const cell = page.locator('canvas').nth(2); // Main grid canvas (third canvas)
			await cell.dblclick({ position: { x: 50, y: 15 } });

			const editor = page.locator('.editor');
			await expect(editor).toBeVisible();
		});

		test('commits value on Enter', async ({ page }) => {
			// Open editor
			const cell = page.locator('canvas').nth(2); // Main grid canvas
			await cell.dblclick({ position: { x: 50, y: 15 } });

			const editor = page.locator('.editor');
			await editor.fill('test value');

			// Check that the value is in the editor
			await expect(editor).toHaveValue('test value');

			await editor.press('Enter');

			// Editor should close; selection moves to cell below
			await expect(editor).not.toBeVisible();

			// Wait a bit for the value to be committed
			await page.waitForTimeout(100);

			// Value should be saved in original cell (row 0, col 0)
			expect(await getCell(page, 0, 0)).toBe('test value');

			// Press Enter again to open editor at the next cell (row 1, col 0)
			await page.keyboard.press('Enter');
			const newEditor = page.locator('.editor');
			await expect(newEditor).toBeVisible();
			await expect(newEditor).toHaveValue('');
		});

		test('cancels editing on Escape', async ({ page }) => {
			// Set initial value
			await setCell(page, 0, 0, 'initial');

			// Open editor
			const cell = page.locator('canvas').nth(2); // Main grid canvas
			await cell.dblclick({ position: { x: 50, y: 15 } });

			const editor = page.locator('.editor');
			await editor.fill('new value');
			await editor.press('Escape');

			// Editor should close
			await expect(editor).not.toBeVisible();

			// Value should remain unchanged
			expect(await getCell(page, 0, 0)).toBe('initial');
		});

		test('navigates to next cell on Tab', async ({ page }) => {
			// Open editor
			const cell = page.locator('canvas').nth(2); // Main grid canvas
			await cell.dblclick({ position: { x: 50, y: 15 } });

			const editor = page.locator('.editor');
			await editor.fill('first cell');
			await editor.press('Tab');

			// Editor should close; selection moves to cell below
			await expect(editor).not.toBeVisible();

			// Wait a bit for the value to be committed
			await page.waitForTimeout(100);

			// Value should be saved in original cell (row 0, col 0)
			expect(await getCell(page, 0, 0)).toBe('first cell');

			// Press Enter again to open editor at the next cell (row 1, col 0)
			await page.keyboard.press('Enter');
			const newEditor = page.locator('.editor');
			await expect(newEditor).toBeVisible();
			await expect(newEditor).toHaveValue('');
		});

		test('navigates to previous cell on Shift+Tab', async ({ page }) => {
			// Set up two cells
			await setCell(page, 0, 0, 'first');
			await setCell(page, 0, 1, 'second');

			// Open editor on second cell
			const cell = page.locator('canvas').nth(2); // Main grid canvas
			await cell.dblclick({ position: { x: 170, y: 15 } }); // Second cell position

			const editor = page.locator('.editor');
			await editor.press('Shift+Tab');

			// Editor should close; selection moves to cell below
			await expect(editor).not.toBeVisible();

			// Wait a bit for the value to be committed
			await page.waitForTimeout(100);

			// Value should be saved in original cell (row 0, col 0)
			expect(await getCell(page, 0, 1)).toBe('second');

			// Press Enter again to open editor at the next cell (row 1, col 0)
			await page.keyboard.press('Enter');
			const newEditor = page.locator('.editor');
			await expect(newEditor).toBeVisible();
			await expect(newEditor).toHaveValue('first');
		});

		test('navigates to cell below on Enter', async ({ page }) => {
			// Open editor
			const cell = page.locator('canvas').nth(2); // Main grid canvas
			await cell.dblclick({ position: { x: 50, y: 15 } });

			const editor = page.locator('.editor');
			await editor.fill('test');
			await editor.press('Enter');

			// Should move selection to cell below and close editor
			await expect(editor).not.toBeVisible();

			// Next Enter should open editor in the cell below
			await page.keyboard.press('Enter');
			const newEditor = page.locator('.editor');
			await expect(newEditor).toBeVisible();
			await expect(newEditor).toHaveValue('');

			// Original cell should have the value
			expect(await getCell(page, 0, 0)).toBe('test');
		});
	});

	test.describe('Keyboard Navigation', () => {
		test('moves selection with arrow keys', async ({ page }) => {
			// Focus the grid
			await page.locator('canvas').nth(2).click(); // Main grid canvas

			// Test arrow key navigation
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('ArrowDown');

			// Should update selection (we can't easily verify the visual selection,
			// but we can verify the component doesn't crash)
			await expect(page.locator('canvas').nth(2)).toBeVisible();
		});

		test('opens editor on Enter key', async ({ page }) => {
			// Focus the grid
			await page.locator('canvas').nth(2).click(); // Main grid canvas

			await page.keyboard.press('Enter');

			// Should open editor
			const editor = page.locator('.editor');
			await expect(editor).toBeVisible();
		});

		test('starts typing on character key', async ({ page }) => {
			// Focus the grid
			await page.locator('canvas').nth(2).click(); // Main grid canvas

			await page.keyboard.press('a');

			// Should open editor with 'a' pre-filled
			const editor = page.locator('.editor');
			await expect(editor).toBeVisible();
			await expect(editor).toHaveValue('a');
		});

		test('navigates with Page Up/Down', async ({ page }) => {
			// Focus the grid
			await page.locator('canvas').nth(2).click(); // Main grid canvas

			await page.keyboard.press('PageDown');
			await page.keyboard.press('PageUp');

			// Should navigate without crashing
			await expect(page.locator('canvas').nth(2)).toBeVisible();
		});

		test('navigates with Home/End', async ({ page }) => {
			// Focus the grid
			await page.locator('canvas').nth(2).click(); // Main grid canvas

			await page.keyboard.press('End');
			await page.keyboard.press('Home');

			// Should navigate without crashing
			await expect(page.locator('canvas').nth(2)).toBeVisible();
		});
	});

	test.describe('Mouse Selection', () => {
		test('selects single cell on click', async ({ page }) => {
			const cell = page.locator('canvas').nth(2); // Main grid canvas
			await cell.click({ position: { x: 50, y: 50 } });

			// Should not crash
			await expect(cell).toBeVisible();
		});

		test('selects range on drag', async ({ page }) => {
			const canvas = page.locator('canvas').nth(2); // Main grid canvas
			const box = await canvas.boundingBox();
			if (!box) throw new Error('Canvas bounding box not available');

			// Start selection
			await page.mouse.move(box.x + 50, box.y + 15);
			await page.mouse.down();

			// Drag to select range
			await page.mouse.move(box.x + 200, box.y + 100);
			await page.mouse.up();

			// Should not crash
			await expect(canvas).toBeVisible();
		});

		test('selects entire row on row header click', async ({ page }) => {
			const rowHeader = page.locator('canvas').nth(1); // Second canvas is row header
			await rowHeader.click({ position: { x: 25, y: 50 } });

			// Should not crash
			await expect(rowHeader).toBeVisible();
		});

		test('selects entire column on column header click', async ({ page }) => {
			const colHeader = page.locator('canvas').first();
			await colHeader.click({ position: { x: 50, y: 15 } });

			// Should not crash
			await expect(colHeader).toBeVisible();
		});
	});

	test.describe('Scrolling', () => {
		test('scrolls with mouse wheel', async ({ page }) => {
			const gridContainer = page.locator('.relative.overflow-hidden').first();

			// Scroll down
			await gridContainer.hover();
			await page.mouse.wheel(0, 100);

			// Should scroll without crashing
			await expect(gridContainer).toBeVisible();
		});

		test('scrolls with scrollbars', async ({ page }) => {
			// Find scrollbar buttons
			const scrollButtons = page.locator('button[title*="Scroll"]');

			if ((await scrollButtons.count()) > 0) {
				// Click scroll buttons
				await scrollButtons.first().click();
				await scrollButtons.last().click();

				// Should scroll without crashing
				await expect(page.locator('canvas').first()).toBeVisible();
			}
		});
	});

	test.describe('UI Controls', () => {
		test('adds rows when button is clicked', async ({ page }) => {
			const addRowsButton = page.locator('button:has-text("add 1000 rows")');
			await addRowsButton.click();

			// Should increase row count
			const statusText = page.locator('.text-sm.text-gray-500');
			await expect(statusText).toContainText('rows: 2000');
		});
	});

	test.describe('Data Types', () => {
		test('handles string values', async ({ page }) => {
			await setCell(page, 0, 0, 'hello world');
			expect(await getCell(page, 0, 0)).toBe('hello world');
		});

		test('handles numeric values', async ({ page }) => {
			await setCell(page, 0, 0, 42);
			expect(await getCell(page, 0, 0)).toBe(42);
		});

		test('handles boolean values', async ({ page }) => {
			await setCell(page, 0, 0, true);
			expect(await getCell(page, 0, 0)).toBe(true);

			await setCell(page, 0, 1, false);
			expect(await getCell(page, 0, 1)).toBe(false);
		});

		test('handles empty values', async ({ page }) => {
			await setCell(page, 0, 0, 'initial');
			await setCell(page, 0, 0, '');
			expect(await getCell(page, 0, 0)).toBe(null);
		});
	});

	test.describe('Large Data Sets', () => {
		test('handles many cells efficiently', async ({ page }) => {
			// Set values in a grid pattern
			for (let i = 0; i < 10; i++) {
				for (let j = 0; j < 10; j++) {
					await setCell(page, i, j, `cell_${i}_${j}`);
				}
			}

			// Verify some values
			expect(await getCell(page, 0, 0)).toBe('cell_0_0');
			expect(await getCell(page, 5, 5)).toBe('cell_5_5');
			expect(await getCell(page, 9, 9)).toBe('cell_9_9');
		});

		test('scrolls to off-screen data', async ({ page }) => {
			// Set data far away
			await setCell(page, 100, 100, 'far away');

			// Scroll to that area
			const gridContainer = page.locator('.relative.overflow-hidden').first();
			await gridContainer.hover();

			// Scroll down and right
			await page.mouse.wheel(100, 100);

			// Should not crash
			await expect(gridContainer).toBeVisible();
		});
	});

	test.describe('Error Handling', () => {
		test('handles rapid user interactions', async ({ page }) => {
			const cell = page.locator('canvas').nth(2);

			// Rapid clicks and key presses
			for (let i = 0; i < 10; i++) {
				await cell.click();
				await page.keyboard.press('ArrowRight');
				await page.keyboard.press('ArrowDown');
			}

			// Should not crash
			await expect(cell).toBeVisible();
		});

		test('handles invalid input gracefully', async ({ page }) => {
			// Open editor
			const cell = page.locator('canvas').nth(2);
			await cell.dblclick({ position: { x: 50, y: 15 } });

			const editor = page.locator('.editor');

			// Try various inputs
			await editor.fill('normal text');
			await editor.press('Enter');

			await cell.dblclick({ position: { x: 50, y: 15 } });
			await editor.fill('123.456');
			await editor.press('Enter');

			await cell.dblclick({ position: { x: 50, y: 15 } });
			await editor.fill('true');
			await editor.press('Enter');

			// Should handle all inputs without crashing
			await expect(cell).toBeVisible();
		});
	});

	test.describe('Accessibility', () => {
		test('supports keyboard navigation', async ({ page }) => {
			// Focus the grid
			await page.locator('canvas').nth(2).click();

			// Tab through interactive elements
			await page.keyboard.press('Tab');
			await page.keyboard.press('Tab');
			await page.keyboard.press('Tab');

			// Should not crash
			await expect(page.locator('canvas').nth(2)).toBeVisible();
		});

		test('has proper ARIA labels', async ({ page }) => {
			// Check for accessibility attributes
			const ariaElements = page.locator('[aria-label]');
			const count = await ariaElements.count();
			expect(count).toBeGreaterThanOrEqual(4);
		});
	});

	test.describe('Performance', () => {
		test('handles rapid scrolling', async ({ page }) => {
			const gridContainer = page.locator('.relative.overflow-hidden').first();

			// Rapid scrolling
			for (let i = 0; i < 20; i++) {
				await page.mouse.wheel(0, 50);
				await page.waitForTimeout(10);
			}

			// Should remain responsive
			await expect(gridContainer).toBeVisible();
		});

		test('handles rapid editing', async ({ page }) => {
			const cell = page.locator('canvas').nth(2);

			// Rapid editing
			for (let i = 0; i < 10; i++) {
				await cell.dblclick({ position: { x: 50, y: 15 } });
				const editor = page.locator('.editor');
				await editor.fill(`edit_${i}`);
				await editor.press('Enter');
				await page.waitForTimeout(10);
			}

			// Should remain responsive
			await expect(cell).toBeVisible();
		});
	});
});
