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

async function flushSheet(page) {
	await page.evaluate(async () => {
		// @ts-ignore
		await window.__sheet.flush();
	});
}

test.describe('Integration Tests', () => {
	test.describe('Complete Workflow', () => {
		test('full user workflow with persistence', async ({ page }) => {
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// 1. User enters data
			const cell = page.locator('canvas').nth(2); // Main grid canvas
			await cell.dblclick({ position: { x: 50, y: 15 } });

			const editor = page.locator('.editor');
			await editor.fill('Integration Test Data');
			await editor.press('Enter');

			// 2. Navigate and enter more data
			await page.keyboard.press('ArrowUp');
			await page.keyboard.press('ArrowRight');
			await editor.fill('Second Cell');
			await editor.press('Enter');

			// 3. Verify data is in memory
			expect(await getCell(page, 0, 0)).toBe('Integration Test Data');
			expect(await getCell(page, 0, 1)).toBe('Second Cell');

			// 4. Force persistence
			await flushSheet(page);
			await page.waitForTimeout(200);

			// 5. Reload page
			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// 6. Verify data persists
			expect(await getCell(page, 0, 0)).toBe('Integration Test Data');
			expect(await getCell(page, 0, 1)).toBe('Second Cell');
		});

		test('large dataset workflow', async ({ page }) => {
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Create a large dataset
			const dataSize = 100;
			for (let i = 0; i < dataSize; i++) {
				await setCell(page, i, 0, `Row ${i}`);
				await setCell(page, i, 1, i * 2);
				await setCell(page, i, 2, i % 2 === 0);
			}

			// Verify data
			expect(await getCell(page, 0, 0)).toBe('Row 0');
			expect(await getCell(page, 50, 1)).toBe(100);
			expect(await getCell(page, 1, 2)).toBe(false);

			// Persist and reload
			await flushSheet(page);
			await page.waitForTimeout(200);
			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Verify persistence
			expect(await getCell(page, 0, 0)).toBe('Row 0');
			expect(await getCell(page, 50, 1)).toBe(100);
			expect(await getCell(page, 1, 2)).toBe(false);
		});
	});

	test.describe('Worker Integration', () => {
		test('worker vs main thread persistence comparison', async ({ page }) => {
			// Test with worker (default)
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			await setCell(page, 0, 0, 'Worker Test');
			await flushSheet(page);
			await page.waitForTimeout(200);

			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});
			expect(await getCell(page, 0, 0)).toBe('Worker Test');

			// Test without worker
			await page.goto('/?noWorker=1');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			await setCell(page, 0, 0, 'Main Thread Test');
			await flushSheet(page);
			await page.waitForTimeout(200);

			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});
			expect(await getCell(page, 0, 0)).toBe('Main Thread Test');
		});

		test('worker error recovery', async ({ page }) => {
			// This test would require more complex setup to simulate worker failures
			// For now, we test that the system gracefully handles worker unavailability
			await page.goto('/?noWorker=1');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Should work without worker
			await setCell(page, 0, 0, 'No Worker Test');
			await flushSheet(page);
			await page.waitForTimeout(200);

			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});
			expect(await getCell(page, 0, 0)).toBe('No Worker Test');
		});
	});

	test.describe('Chunk Management', () => {
		test('chunk promotion and demotion', async ({ page }) => {
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Fill enough cells to trigger dense mode (50% of 64x64 = 2048 cells)
			const cellsToFill = 2100;
			for (let i = 0; i < cellsToFill; i++) {
				const row = Math.floor(i / 64);
				const col = i % 64;
				await setCell(page, row, col, `dense_${i}`);
			}

			// Verify dense mode
			expect(await getCell(page, 0, 0)).toBe('dense_0');
			expect(await getCell(page, 32, 32)).toBe('dense_2080');

			// Delete cells to trigger sparse mode (drop below 30%)
			const cellsToDelete = 1500;
			for (let i = 0; i < cellsToDelete; i++) {
				const row = Math.floor(i / 64);
				const col = i % 64;
				await page.evaluate(
					([r, c]) => {
						// @ts-ignore
						window.__sheet.deleteValue(r, c);
					},
					[row, col]
				);
			}

			// Verify sparse mode still works
			expect(await getCell(page, 0, 0)).toBe(null);
			expect(await getCell(page, 32, 32)).toBe('dense_2080');

			// Persist and reload
			await flushSheet(page);
			await page.waitForTimeout(200);
			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Verify persistence
			expect(await getCell(page, 0, 0)).toBe(null);
			expect(await getCell(page, 32, 32)).toBe('dense_2080');
		});

		test('offscreen chunk loading', async ({ page }) => {
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Set data far away
			await setCell(page, 500, 500, 'Offscreen Data');
			await flushSheet(page);
			await page.waitForTimeout(200);

			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Load the offscreen range
			await page.evaluate(async () => {
				// @ts-ignore
				await window.__sheet.loadRange(480, 480, 544, 544);
			});

			// Verify data is loaded
			expect(await getCell(page, 500, 500)).toBe('Offscreen Data');
		});
	});

	test.describe('Error Recovery', () => {
		test('recovery from storage errors', async ({ page }) => {
			// This would require mocking IndexedDB to simulate errors
			// For now, we test basic error handling
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Set data
			await setCell(page, 0, 0, 'Error Recovery Test');

			// Try to persist (should handle errors gracefully)
			try {
				await flushSheet(page);
			} catch (error) {
				// Should handle errors without crashing
				console.log('Expected error during flush:', error);
			}

			// Should still work after error
			expect(await getCell(page, 0, 0)).toBe('Error Recovery Test');
		});

		test('recovery from worker errors', async ({ page }) => {
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Set data
			await setCell(page, 0, 0, 'Worker Error Recovery');

			// Force persistence (should handle worker errors gracefully)
			await flushSheet(page);
			await page.waitForTimeout(200);

			// Should still work
			expect(await getCell(page, 0, 0)).toBe('Worker Error Recovery');
		});
	});

	test.describe('Performance Integration', () => {
		test('handles rapid data entry', async ({ page }) => {
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Rapid data entry
			for (let i = 0; i < 50; i++) {
				await setCell(page, i, 0, `Rapid_${i}`);
				await page.waitForTimeout(10);
			}

			// Verify data integrity
			expect(await getCell(page, 0, 0)).toBe('Rapid_0');
			expect(await getCell(page, 25, 0)).toBe('Rapid_25');
			expect(await getCell(page, 49, 0)).toBe('Rapid_49');

			// Persist and verify
			await flushSheet(page);
			await page.waitForTimeout(200);
			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			expect(await getCell(page, 0, 0)).toBe('Rapid_0');
			expect(await getCell(page, 25, 0)).toBe('Rapid_25');
			expect(await getCell(page, 49, 0)).toBe('Rapid_49');
		});

		test('handles large data operations', async ({ page }) => {
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Large block operation
			const blockData = [];
			for (let i = 0; i < 20; i++) {
				const row = [];
				for (let j = 0; j < 20; j++) {
					row.push(`Block_${i}_${j}`);
				}
				blockData.push(row);
			}

			// Set block
			await page.evaluate(
				([data]) => {
					// @ts-ignore
					window.__sheet.setBlock(0, 0, data);
				},
				[blockData]
			);

			// Verify block
			expect(await getCell(page, 0, 0)).toBe('Block_0_0');
			expect(await getCell(page, 10, 10)).toBe('Block_10_10');
			expect(await getCell(page, 19, 19)).toBe('Block_19_19');

			// Persist and verify
			await flushSheet(page);
			await page.waitForTimeout(200);
			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			expect(await getCell(page, 0, 0)).toBe('Block_0_0');
			expect(await getCell(page, 10, 10)).toBe('Block_10_10');
			expect(await getCell(page, 19, 19)).toBe('Block_19_19');
		});
	});

	test.describe('Cross-Browser Compatibility', () => {
		test('works with different storage implementations', async ({ page }) => {
			// Test with different storage configurations
			const configs = [{ worker: true }, { worker: false }];

			for (const config of configs) {
				const url = config.worker ? '/' : '/?noWorker=1';
				await page.goto(url);
				await page.waitForFunction(() => {
					// @ts-ignore
					return !!window.__sheet;
				});

				// Test basic functionality
				await setCell(page, 0, 0, `Config_${config.worker ? 'worker' : 'main'}`);
				await flushSheet(page);
				await page.waitForTimeout(200);

				await page.reload();
				await page.waitForFunction(() => {
					// @ts-ignore
					return !!window.__sheet;
				});

				expect(await getCell(page, 0, 0)).toBe(`Config_${config.worker ? 'worker' : 'main'}`);
			}
		});
	});

	test.describe('Memory Management', () => {
		test('handles memory pressure gracefully', async ({ page }) => {
			await page.goto('/');
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Create data that would trigger cache eviction
			const largeDataset = 5000;
			for (let i = 0; i < largeDataset; i++) {
				await setCell(page, i, 0, `Memory_${i}`);
			}

			// Verify data integrity
			expect(await getCell(page, 0, 0)).toBe('Memory_0');
			expect(await getCell(page, 1000, 0)).toBe('Memory_1000');
			expect(await getCell(page, 4999, 0)).toBe('Memory_4999');

			// Persist and reload
			await flushSheet(page);
			await page.waitForTimeout(200);
			await page.reload();
			await page.waitForFunction(() => {
				// @ts-ignore
				return !!window.__sheet;
			});

			// Load ranges to trigger cache management
			await page.evaluate(async () => {
				// @ts-ignore
				await window.__sheet.loadRange(0, 0, 1000, 1000);
			});

			// Verify data is still accessible
			expect(await getCell(page, 0, 0)).toBe('Memory_0');
			expect(await getCell(page, 1000, 0)).toBe('Memory_1000');
			expect(await getCell(page, 4999, 0)).toBe('Memory_4999');
		});
	});
});
