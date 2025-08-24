import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalStringTable } from '../../../../src/domain/strings/GlobalStringTable.js';

describe('GlobalStringTable', () => {
	let table;

	beforeEach(() => {
		table = new GlobalStringTable();
	});

	it('assigns a new ID for a new string', () => {
		expect(table.getIdForString('hello')).toBe(0);
		expect(table.getIdForString('world')).toBe(1);
	});

	it('returns an existing ID for a known string', () => {
		const id1 = table.getIdForString('hello');
		const id2 = table.getIdForString('hello');
		expect(id1).toBe(0);
		expect(id2).toBe(0);
		expect(table.stringById.length).toBe(1);
	});

	it('retrieves the correct string by ID', () => {
		table.getIdForString('hello');
		table.getIdForString('world');
		expect(table.getStringById(0)).toBe('hello');
		expect(table.getStringById(1)).toBe('world');
	});

	it('tracks unpersisted changes', () => {
		expect(table.hasUnpersistedChanges).toBe(false);
		table.getIdForString('new string');
		expect(table.hasUnpersistedChanges).toBe(true);
	});

	it('loads from a list and resets state', () => {
		const list = ['a', 'b', 'c'];
		table.loadFromList(list);
		expect(table.stringById).toEqual(list);
		expect(table.idByString.get('b')).toBe(1);
		expect(table.hasUnpersistedChanges).toBe(false);
		expect(table.getIdForString('d')).toBe(3);
		expect(table.hasUnpersistedChanges).toBe(true);
	});
});

describe('GlobalStringTable Edge Cases', () => {
	it('handles getStringById with invalid id', () => {
		const table = new GlobalStringTable();
		expect(table.getStringById(0)).toBeUndefined();
		expect(table.getStringById(-1)).toBeUndefined();
		expect(table.getStringById(100)).toBeUndefined();
	});

	it('handles loadFromList with empty array', () => {
		const table = new GlobalStringTable();
		table.loadFromList([]);
		expect(table.stringById).toEqual([]);
		expect(table.idByString.size).toBe(0);
		expect(table.hasUnpersistedChanges).toBe(false);
	});

	it('handles duplicate strings in loadFromList', () => {
		const table = new GlobalStringTable();
		table.loadFromList(['a', 'b', 'a', 'c']);
		expect(table.stringById).toEqual(['a', 'b', 'a', 'c']);
		// The implementation maps each string to its last occurrence index
		expect(table.idByString.get('a')).toBe(2); // Last occurrence overwrites first
		expect(table.idByString.get('b')).toBe(1);
		expect(table.idByString.get('c')).toBe(3);
	});
});
