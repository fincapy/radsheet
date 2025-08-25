/** Clipboard TSV utilities shared by domain, UI, and worker. */

/**
 * @param {any} value
 * @returns {string}
 */
export function serializeCell(value) {
	if (value == null) return '';
	if (typeof value === 'number') return String(value);
	if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
	return String(value);
}

/**
 * @param {string} s
 * @returns {string|number|boolean|null}
 */
export function parseCell(s) {
	if (s == null) return null;
	const trimmed = String(s).trim();
	if (trimmed === '') return null;
	if (trimmed === 'TRUE') return true;
	if (trimmed === 'FALSE') return false;
	const num = Number(trimmed);
	if (Number.isFinite(num) && String(num) === trimmed) return num;
	return s;
}

/**
 * @param {Array<Array<any>>} values2D
 * @returns {string}
 */
export function serialize2DToTSV(values2D) {
	const lines = [];
	for (let i = 0; i < values2D.length; i++) {
		const row = values2D[i];
		const cells = new Array(row.length);
		for (let j = 0; j < row.length; j++) {
			cells[j] = serializeCell(row[j]);
		}
		lines.push(cells.join('\t'));
	}
	return lines.join('\n');
}

/**
 * @param {string} tsv
 * @returns {Array<Array<any>>}
 */
export function parseTSVTo2D(tsv) {
	if (!tsv) return [];
	const rawLines = tsv.split(/\r?\n/);
	const lines =
		rawLines.length > 0 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
	const out = new Array(lines.length);
	for (let i = 0; i < lines.length; i++) {
		const cols = lines[i].split('\t');
		const row = new Array(cols.length);
		for (let j = 0; j < cols.length; j++) row[j] = parseCell(cols[j]);
		out[i] = row;
	}
	return out;
}

/**
 * Generator that yields parsed chunks of TSV by rows.
 * @param {string} tsv
 * @param {number} chunkRows
 */
export function* parseTSVChunks(tsv, chunkRows = 500) {
	const rawLines = tsv.split(/\r?\n/);
	const lines =
		rawLines.length > 0 && rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
	for (let rowOffset = 0; rowOffset < lines.length; rowOffset += chunkRows) {
		const slice = lines.slice(rowOffset, rowOffset + chunkRows);
		const values = slice.map((line) => line.split('\t').map(parseCell));
		yield { rowOffset, values };
	}
}

/**
 * Appends rows to an accumulating TSV lines array.
 * @param {string[]} lines
 * @param {Array<Array<any>>} values
 */
export function appendValuesToTSVLines(lines, values) {
	for (let i = 0; i < values.length; i++) {
		const row = values[i];
		const cells = new Array(row.length);
		for (let j = 0; j < row.length; j++) cells[j] = serializeCell(row[j]);
		lines.push(cells.join('\t'));
	}
}
