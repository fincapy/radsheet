import { Sheet } from '../../src/domain/sheet.js';
describe('Import test', () => {
	it('should import successfully', () => {
		expect(typeof Sheet).toBe('function');
	});
});
