import { describe, it, expect, beforeEach } from 'vitest';
import { Sheet } from '../../../../src/domain/sheet/sheet.js';
import { CELLS_PER_CHUNK } from '../../../../src/domain/constants/ChunkSizing.js';
import {
	PROMOTE_TO_DENSE_FILL_RATIO,
	DEMOTE_TO_SPARSE_FILL_RATIO
} from '../../../../src/domain/constants/PromotionPolicy.js';

describe('SheetAggregate (Comprehensive)', () => {
	let sheet;

	beforeEach(() => {
		sheet = new Sheet();
	});

	describe('Core Get/Set/Has/Delete', () => {
		it('sets and gets a numeric value', () => {
			sheet.setValue(10, 20, 123.45);
			expect(sheet.getValue(10, 20)).toBe(123.45);
			expect(sheet.hasValue(10, 20)).toBe(true);
		});

		it('sets and gets a string value', () => {
			sheet.setValue(0, 0, 'hello world');
			expect(sheet.getValue(0, 0)).toBe('hello world');
			expect(sheet.hasValue(0, 0)).toBe(true);
		});

		it('deletes a value', () => {
			sheet.setValue(5, 5, 'to be deleted');
			expect(sheet.hasValue(5, 5)).toBe(true);
			sheet.deleteValue(5, 5);
			expect(sheet.getValue(5, 5)).toBe(null);
			expect(sheet.hasValue(5, 5)).toBe(false);
		});

		it('returns null for empty cells', () => {
			expect(sheet.getValue(100, 100)).toBe(null);
			expect(sheet.hasValue(100, 100)).toBe(false);
		});
	});

	describe('Boolean Values', () => {
		it('sets and gets boolean values', () => {
			sheet.setValue(0, 0, true);
			sheet.setValue(0, 1, false);

			expect(sheet.getValue(0, 0)).toBe(true);
			expect(sheet.getValue(0, 1)).toBe(false);
			expect(sheet.hasValue(0, 0)).toBe(true);
			expect(sheet.hasValue(0, 1)).toBe(true);
		});

		it('handles boolean values in dense chunks', () => {
			const cellsToFill = Math.ceil(CELLS_PER_CHUNK * PROMOTE_TO_DENSE_FILL_RATIO);
			for (let i = 0; i < cellsToFill; i++) {
				sheet.setValue(0, i, `string${i}`);
			}
			sheet.setValue(0, cellsToFill, true);
			expect(sheet.getValue(0, cellsToFill)).toBe(true);
		});
	});

	describe('Chunk Promotion and Demotion', () => {
		it('promotes sparse chunk to dense when fill ratio is reached', () => {
			const cellsToFill = Math.ceil(CELLS_PER_CHUNK * PROMOTE_TO_DENSE_FILL_RATIO);
			for (let i = 0; i < cellsToFill; i++) {
				const row = Math.floor(i / 64);
				const col = i % 64;
				sheet.setValue(row, col, `string${i}`);
			}
			const chunk = sheet._getChunk(0, 0, false);
			expect(chunk.kind).toBe('dense');
		});

		it('demotes dense chunk to sparse when fill ratio drops', () => {
			const cellsToFillToPromote = Math.ceil(CELLS_PER_CHUNK * PROMOTE_TO_DENSE_FILL_RATIO);
			for (let i = 0; i < cellsToFillToPromote; i++) {
				sheet.setValue(Math.floor(i / 64), i % 64, `string${i}`);
			}
			let chunk = sheet._getChunk(0, 0, false);
			expect(chunk.kind).toBe('dense');

			const cellsToDelete =
				chunk.nonEmptyCellCount - Math.floor(CELLS_PER_CHUNK * DEMOTE_TO_SPARSE_FILL_RATIO);
			for (let i = 0; i < cellsToDelete; i++) {
				sheet.deleteValue(Math.floor(i / 64), i % 64);
			}

			chunk = sheet._getChunk(0, 0, false);
			expect(chunk.kind).toBe('sparse');
		});
	});

	describe('setBlock Method', () => {
		it('sets a 2D block of values', () => {
			const values2D = [
				['A1', 'B1', 'C1'],
				['A2', 'B2', 'C2']
			];
			const writeCount = sheet.setBlock(1, 2, values2D);
			expect(writeCount).toBe(6);
			expect(sheet.getValue(1, 2)).toBe('A1');
			expect(sheet.getValue(2, 4)).toBe('C2');
		});

		it('handles empty values in setBlock', () => {
			sheet.setValue(1, 3, 'should be deleted');
			const values2D = [['A1', '', null, undefined]];
			const writeCount = sheet.setBlock(1, 2, values2D);
			expect(writeCount).toBe(1);
			expect(sheet.getValue(1, 2)).toBe('A1');
			expect(sheet.hasValue(1, 3)).toBe(false);
			expect(sheet.hasValue(1, 4)).toBe(false);
		});
	});
});
