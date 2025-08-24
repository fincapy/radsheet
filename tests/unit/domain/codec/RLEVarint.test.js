import { describe, it, expect } from 'vitest';
import {
	rleEncodeUint8,
	rleDecodeUint8,
	writeVarintUnsigned,
	readVarintUnsigned,
	concatUint8,
	float64ArrayToBytes,
	bytesToFloat64Array
} from '../../../../src/domain/codec/RLEVarint.js';

describe('RLEVarint Codec', () => {
	describe('Run-Length Encoding (RLE)', () => {
		it('handles an empty array', () => {
			const input = new Uint8Array([]);
			const encoded = rleEncodeUint8(input);
			expect(encoded).toEqual(new Uint8Array([]));
			const decoded = rleDecodeUint8(encoded, 0);
			expect(decoded).toEqual(input);
		});

		it('encodes and decodes an array with no repeating runs', () => {
			const input = new Uint8Array([1, 2, 3, 4, 5]);
			const encoded = rleEncodeUint8(input);
			// Expected: run of 1, value 1; run of 1, value 2; etc.
			expect(encoded).toEqual(new Uint8Array([1, 1, 1, 2, 1, 3, 1, 4, 1, 5]));
			const decoded = rleDecodeUint8(encoded, 5);
			expect(decoded).toEqual(input);
		});

		it('encodes and decodes an array with multiple runs', () => {
			const input = new Uint8Array([5, 5, 5, 5, 2, 2, 9, 9, 9]);
			const encoded = rleEncodeUint8(input);
			expect(encoded).toEqual(new Uint8Array([4, 5, 2, 2, 3, 9]));
			const decoded = rleDecodeUint8(encoded, 9);
			expect(decoded).toEqual(input);
		});

		it('handles runs longer than 255', () => {
			const input = new Uint8Array(300).fill(7);
			const encoded = rleEncodeUint8(input);
			// Should be split into a run of 255 and a run of 45
			expect(encoded).toEqual(new Uint8Array([255, 7, 45, 7]));
			const decoded = rleDecodeUint8(encoded, 300);
			expect(decoded).toEqual(input);
		});
	});

	describe('Varint Encoding', () => {
		it('encodes and decodes single-byte values', () => {
			const values = [0, 1, 10, 127];
			for (const value of values) {
				const encoded = [];
				writeVarintUnsigned(value, encoded);
				expect(encoded.length).toBe(1);
				const [decoded, newIndex] = readVarintUnsigned(encoded, 0);
				expect(decoded).toBe(value);
				expect(newIndex).toBe(1);
			}
		});

		it('encodes and decodes multi-byte values', () => {
			const values = [128, 255, 300, 16383, 16384];
			for (const value of values) {
				const encoded = [];
				writeVarintUnsigned(value, encoded);
				expect(encoded.length).toBeGreaterThan(1);
				const [decoded, newIndex] = readVarintUnsigned(encoded, 0);
				expect(decoded).toBe(value);
				expect(newIndex).toBe(encoded.length);
			}
		});
	});

	it('concatUint8 correctly concatenates arrays', () => {
		const chunk1 = new Uint8Array([1, 2]);
		const chunk2 = new Uint8Array([]);
		const chunk3 = new Uint8Array([3, 4, 5]);
		const result = concatUint8([chunk1, chunk2, chunk3]);
		expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
	});

	it('float64ArrayToBytes and bytesToFloat64Array perform a round trip correctly', () => {
		const input = new Float64Array([0, 1.5, -3.14159, Number.MAX_VALUE]);
		const bytes = float64ArrayToBytes(input);
		expect(bytes.length).toBe(input.length * 8);
		const output = bytesToFloat64Array(bytes, 0, input.length);
		expect(output).toEqual(input);
	});
});
