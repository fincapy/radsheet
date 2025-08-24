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

test.describe('Worker persistence', () => {
	test('persists and restores across reload (worker on)', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		await setCell(page, 0, 0, 'hello');
		await setCell(page, 10, 10, 'world');

		// Force a flush
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.flush();
		});

		// Simulate some time for background save UI
		await page.waitForTimeout(200);

		await page.reload();
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		expect(await getCell(page, 0, 0)).toBe('hello');
		expect(await getCell(page, 10, 10)).toBe('world');
	});

	test('persists and restores across reload (worker off)', async ({ page }) => {
		await page.goto('/?noWorker=1');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		await setCell(page, 1, 1, 'alpha');
		await setCell(page, 2, 2, 'beta');

		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.flush();
		});

		await page.waitForTimeout(200);

		await page.reload();
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		expect(await getCell(page, 1, 1)).toBe('alpha');
		expect(await getCell(page, 2, 2)).toBe('beta');
	});

	test('scroll loads and shows persisted offscreen chunks', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		// Write a cell far away
		await setCell(page, 512, 512, 'far');
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.flush();
		});

		await page.reload();
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		// Trigger loadRange explicitly for the offscreen area
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.loadRange(480, 480, 544, 544);
		});

		const v = await getCell(page, 512, 512);
		expect(v).toBe('far');
	});
});

test.describe('Performance tests', () => {
	test('dense chunk persistence performance (worker vs main thread)', async ({ page }) => {
		// Test with worker
		await page.goto('/');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		// Fill a dense chunk (64x64 = 4096 cells, need >50% to trigger dense mode)
		const startTime = Date.now();
		for (let i = 0; i < 2500; i++) {
			const row = Math.floor(i / 64);
			const col = i % 64;
			await setCell(page, row, col, `dense_${i}`);
		}
		const fillTime = Date.now() - startTime;

		// Measure flush time
		const flushStart = Date.now();
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.flush();
		});
		const workerFlushTime = Date.now() - flushStart;

		// Test without worker
		await page.goto('/?noWorker=1');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		// Fill same dense chunk
		const startTime2 = Date.now();
		for (let i = 0; i < 2500; i++) {
			const row = Math.floor(i / 64);
			const col = i % 64;
			await setCell(page, row, col, `dense_${i}`);
		}
		const fillTime2 = Date.now() - startTime2;

		// Measure flush time without worker
		const flushStart2 = Date.now();
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.flush();
		});
		const mainThreadFlushTime = Date.now() - flushStart2;

		console.log(`Dense chunk performance:
			Fill time (worker): ${fillTime}ms
			Flush time (worker): ${workerFlushTime}ms
			Fill time (main): ${fillTime2}ms
			Flush time (main): ${mainThreadFlushTime}ms
			Worker speedup: ${(mainThreadFlushTime / workerFlushTime).toFixed(2)}x`);

		// Both approaches should work - just verify they complete successfully
		expect(workerFlushTime).toBeGreaterThan(0);
		expect(mainThreadFlushTime).toBeGreaterThan(0);
	});

	test('sparse chunk persistence performance (worker vs main thread)', async ({ page }) => {
		// Test with worker
		await page.goto('/');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		// Fill a sparse chunk (scattered cells, <50% fill to stay sparse)
		const startTime = Date.now();
		for (let i = 0; i < 1000; i++) {
			const row = Math.floor(i / 10);
			const col = (i % 10) * 6; // Spread out to stay sparse
			await setCell(page, row, col, `sparse_${i}`);
		}
		const fillTime = Date.now() - startTime;

		// Measure flush time
		const flushStart = Date.now();
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.flush();
		});
		const workerFlushTime = Date.now() - flushStart;

		// Test without worker
		await page.goto('/?noWorker=1');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		// Fill same sparse pattern
		const startTime2 = Date.now();
		for (let i = 0; i < 1000; i++) {
			const row = Math.floor(i / 10);
			const col = (i % 10) * 6;
			await setCell(page, row, col, `sparse_${i}`);
		}
		const fillTime2 = Date.now() - startTime2;

		// Measure flush time without worker
		const flushStart2 = Date.now();
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.flush();
		});
		const mainThreadFlushTime = Date.now() - flushStart2;

		console.log(`Sparse chunk performance:
			Fill time (worker): ${fillTime}ms
			Flush time (worker): ${workerFlushTime}ms
			Fill time (main): ${fillTime2}ms
			Flush time (main): ${mainThreadFlushTime}ms
			Worker speedup: ${(mainThreadFlushTime / workerFlushTime).toFixed(2)}x`);

		// Both approaches should work - just verify they complete successfully
		expect(workerFlushTime).toBeGreaterThan(0);
		expect(mainThreadFlushTime).toBeGreaterThan(0);
	});

	test('loadRange performance (worker vs main thread)', async ({ page }) => {
		// Pre-populate with data
		await page.goto('/');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		// Create some data to load
		for (let i = 0; i < 500; i++) {
			const row = i * 2;
			const col = i * 2;
			await setCell(page, row, col, `load_${i}`);
		}
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.flush();
		});

		// Test loadRange with worker
		await page.reload();
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		const loadStart = Date.now();
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.loadRange(0, 0, 1000, 1000);
		});
		const workerLoadTime = Date.now() - loadStart;

		// Test loadRange without worker
		await page.goto('/?noWorker=1');
		await page.waitForFunction(() => {
			// @ts-ignore
			return !!window.__sheet;
		});

		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.loadRange(0, 0, 1000, 1000);
		});
		await page.waitForTimeout(100); // Let any background work complete

		const loadStart2 = Date.now();
		await page.evaluate(async () => {
			// @ts-ignore
			await window.__sheet.loadRange(0, 0, 1000, 1000);
		});
		const mainThreadLoadTime = Date.now() - loadStart2;

		console.log(`LoadRange performance:
			Load time (worker): ${workerLoadTime}ms
			Load time (main): ${mainThreadLoadTime}ms
			Worker speedup: ${(mainThreadLoadTime / workerLoadTime).toFixed(2)}x`);

		// Both approaches should work - just verify they complete successfully
		expect(workerLoadTime).toBeGreaterThan(0);
		expect(mainThreadLoadTime).toBeGreaterThan(0);
	});
});
