import { describe, it, expect, beforeEach } from 'vitest';
import { ChunkCodec } from '../../../../src/domain/codec/ChunkCodec.js';
import { GlobalStringTable } from '../../../../src/domain/strings/GlobalStringTable.js';
import { createDenseChunk, createSparseChunk } from '../../../../src/domain/chunk/ChunkFactory.js';
import { concatUint8 } from '../../../../src/domain/codec/RLEVarint.js';

describe('ChunkCodec', () => {
	let stringTable;

	beforeEach(() => {
		stringTable = new GlobalStringTable();
		stringTable.loadFromList(['hello', 'world', 'test']);
	});

	describe('Dense Chunk Encoding/Decoding', () => {
		it('encodes and decodes an empty dense chunk', () => {
			const dense = createDenseChunk();
			const encoded = ChunkCodec.encodeDenseChunk(dense, stringTable);
			const decoded = ChunkCodec.decodeDenseChunk(encoded, stringTable);

			expect(decoded.kind).toBe('dense');
			expect(decoded.nonEmptyCellCount).toBe(0);
			expect(decoded.isDirty).toBe(false);
		});

		it('encodes and decodes a dense chunk with numbers', () => {
			const dense = createDenseChunk();
			dense.nonEmptyCellCount = 2;
			dense.tagByLocalIndex[0] = 1; // number
			dense.numberByLocalIndex[0] = 42.5;
			dense.tagByLocalIndex[100] = 1; // number
			dense.numberByLocalIndex[100] = -123;

			const encoded = ChunkCodec.encodeDenseChunk(dense, stringTable);
			const decoded = ChunkCodec.decodeDenseChunk(encoded, stringTable);

			expect(decoded.kind).toBe('dense');
			expect(decoded.nonEmptyCellCount).toBe(2);
			expect(decoded.tagByLocalIndex[0]).toBe(1);
			expect(decoded.numberByLocalIndex[0]).toBe(42.5);
			expect(decoded.tagByLocalIndex[100]).toBe(1);
			expect(decoded.numberByLocalIndex[100]).toBe(-123);
		});

		it('encodes and decodes a dense chunk with booleans', () => {
			const dense = createDenseChunk();
			dense.nonEmptyCellCount = 2;
			dense.tagByLocalIndex[0] = 3; // boolean
			dense.numberByLocalIndex[0] = 1; // true
			dense.tagByLocalIndex[50] = 3; // boolean
			dense.numberByLocalIndex[50] = 0; // false

			const encoded = ChunkCodec.encodeDenseChunk(dense, stringTable);
			const decoded = ChunkCodec.decodeDenseChunk(encoded, stringTable);

			expect(decoded.tagByLocalIndex[0]).toBe(3);
			expect(decoded.numberByLocalIndex[0]).toBe(1);
			expect(decoded.tagByLocalIndex[50]).toBe(3);
			expect(decoded.numberByLocalIndex[50]).toBe(0);
		});

		it('encodes and decodes a dense chunk with strings', () => {
			const dense = createDenseChunk();
			dense.nonEmptyCellCount = 2;
			dense.tagByLocalIndex[0] = 2; // string
			dense.stringIdByLocalIndex[0] = 0; // 'hello'
			dense.tagByLocalIndex[200] = 2; // string
			dense.stringIdByLocalIndex[200] = 1; // 'world'

			const encoded = ChunkCodec.encodeDenseChunk(dense, stringTable);
			const decoded = ChunkCodec.decodeDenseChunk(encoded, stringTable);

			expect(decoded.tagByLocalIndex[0]).toBe(2);
			expect(decoded.stringIdByLocalIndex[0]).toBe(0);
			expect(decoded.tagByLocalIndex[200]).toBe(2);
			expect(decoded.stringIdByLocalIndex[200]).toBe(1);
		});

		it('encodes and decodes a dense chunk with mixed types', () => {
			const dense = createDenseChunk();
			dense.nonEmptyCellCount = 3;
			dense.tagByLocalIndex[0] = 1; // number
			dense.numberByLocalIndex[0] = 42;
			dense.tagByLocalIndex[100] = 3; // boolean
			dense.numberByLocalIndex[100] = 1;
			dense.tagByLocalIndex[200] = 2; // string
			dense.stringIdByLocalIndex[200] = 0;

			const encoded = ChunkCodec.encodeDenseChunk(dense, stringTable);
			const decoded = ChunkCodec.decodeDenseChunk(encoded, stringTable);

			expect(decoded.nonEmptyCellCount).toBe(3);
			expect(decoded.tagByLocalIndex[0]).toBe(1);
			expect(decoded.numberByLocalIndex[0]).toBe(42);
			expect(decoded.tagByLocalIndex[100]).toBe(3);
			expect(decoded.numberByLocalIndex[100]).toBe(1);
			expect(decoded.tagByLocalIndex[200]).toBe(2);
			expect(decoded.stringIdByLocalIndex[200]).toBe(0);
		});

		it('throws error for invalid dense chunk header', () => {
			const invalidHeader = new Uint8Array([0x45, 0x01]); // Wrong type byte
			expect(() => ChunkCodec.decodeDenseChunk(invalidHeader, stringTable)).toThrow(
				'Invalid dense chunk header'
			);
		});
	});

	describe('Sparse Chunk Encoding/Decoding', () => {
		it('encodes and decodes an empty sparse chunk', () => {
			const sparse = createSparseChunk();
			const encoded = ChunkCodec.encodeSparseChunk(sparse, stringTable);
			const decoded = ChunkCodec.decodeSparseChunk(encoded, stringTable);

			expect(decoded.kind).toBe('sparse');
			expect(decoded.nonEmptyCellCount).toBe(0);
			expect(decoded.isDirty).toBe(false);
		});

		it('encodes and decodes a sparse chunk with numbers', () => {
			const sparse = createSparseChunk();
			sparse.nonEmptyCellCount = 2;
			sparse.localIndexToValue.set(0, 42.5);
			sparse.localIndexToValue.set(100, -123);

			const encoded = ChunkCodec.encodeSparseChunk(sparse, stringTable);
			const decoded = ChunkCodec.decodeSparseChunk(encoded, stringTable);

			expect(decoded.nonEmptyCellCount).toBe(2);
			expect(decoded.localIndexToValue.get(0)).toBe(42.5);
			expect(decoded.localIndexToValue.get(100)).toBe(-123);
		});

		it('encodes and decodes a sparse chunk with booleans', () => {
			const sparse = createSparseChunk();
			sparse.nonEmptyCellCount = 2;
			sparse.localIndexToValue.set(0, true);
			sparse.localIndexToValue.set(50, false);

			const encoded = ChunkCodec.encodeSparseChunk(sparse, stringTable);
			const decoded = ChunkCodec.decodeSparseChunk(encoded, stringTable);

			expect(decoded.nonEmptyCellCount).toBe(2);
			expect(decoded.localIndexToValue.get(0)).toBe(true);
			expect(decoded.localIndexToValue.get(50)).toBe(false);
		});

		it('encodes and decodes a sparse chunk with strings', () => {
			const sparse = createSparseChunk();
			sparse.nonEmptyCellCount = 2;
			sparse.localIndexToValue.set(0, 'hello');
			sparse.localIndexToValue.set(200, 'world');

			const encoded = ChunkCodec.encodeSparseChunk(sparse, stringTable);
			const decoded = ChunkCodec.decodeSparseChunk(encoded, stringTable);

			expect(decoded.nonEmptyCellCount).toBe(2);
			expect(decoded.localIndexToValue.get(0)).toBe('hello');
			expect(decoded.localIndexToValue.get(200)).toBe('world');
		});

		it('encodes and decodes a sparse chunk with mixed types', () => {
			const sparse = createSparseChunk();
			sparse.nonEmptyCellCount = 3;
			sparse.localIndexToValue.set(0, 42);
			sparse.localIndexToValue.set(100, true);
			sparse.localIndexToValue.set(200, 'hello');

			const encoded = ChunkCodec.encodeSparseChunk(sparse, stringTable);
			const decoded = ChunkCodec.decodeSparseChunk(encoded, stringTable);

			expect(decoded.nonEmptyCellCount).toBe(3);
			expect(decoded.localIndexToValue.get(0)).toBe(42);
			expect(decoded.localIndexToValue.get(100)).toBe(true);
			expect(decoded.localIndexToValue.get(200)).toBe('hello');
		});

		it('throws error for invalid sparse chunk header', () => {
			const invalidHeader = new Uint8Array([0x54, 0x01]); // Wrong type byte
			expect(() => ChunkCodec.decodeSparseChunk(invalidHeader, stringTable)).toThrow(
				'Invalid sparse chunk header'
			);
		});

		it('throws error for unknown value tag in sparse chunk', () => {
			const header = [0x53, 0x01]; // 'S', version 1
			const entryCount = [1]; // 1 entry
			const invalidTag = [0, 99]; // delta=0, tag=99 (invalid)
			const encoded = concatUint8([
				Uint8Array.from(header),
				Uint8Array.from(entryCount),
				Uint8Array.from(invalidTag)
			]);

			expect(() => ChunkCodec.decodeSparseChunk(encoded, stringTable)).toThrow();
		});
	});

	describe('Generic Chunk Encoding/Decoding', () => {
		it('encodes and decodes dense chunks via generic method', () => {
			const dense = createDenseChunk();
			dense.nonEmptyCellCount = 1;
			dense.tagByLocalIndex[0] = 1;
			dense.numberByLocalIndex[0] = 42;

			const encoded = ChunkCodec.encodeChunk(dense, stringTable);
			const decoded = ChunkCodec.decodeChunk(encoded, stringTable);

			expect(decoded.kind).toBe('dense');
			expect(decoded.nonEmptyCellCount).toBe(1);
		});

		it('encodes and decodes sparse chunks via generic method', () => {
			const sparse = createSparseChunk();
			sparse.nonEmptyCellCount = 1;
			sparse.localIndexToValue.set(0, 'hello');

			const encoded = ChunkCodec.encodeChunk(sparse, stringTable);
			const decoded = ChunkCodec.decodeChunk(encoded, stringTable);

			expect(decoded.kind).toBe('sparse');
			expect(decoded.nonEmptyCellCount).toBe(1);
		});

		it('throws error for unknown chunk type', () => {
			const unknownType = new Uint8Array([0x55]); // Unknown type byte
			expect(() => ChunkCodec.decodeChunk(unknownType, stringTable)).toThrow('Unknown chunk type');
		});
	});
});
