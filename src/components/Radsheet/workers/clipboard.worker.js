// Shared helpers duplicated minimally to avoid module loading constraints in worker bundling
function parseCell(s) {
	if (s == null) return null;
	const trimmed = String(s).trim();
	if (trimmed === '') return null;
	if (trimmed === 'TRUE') return true;
	if (trimmed === 'FALSE') return false;
	const num = Number(trimmed);
	if (Number.isFinite(num) && String(num) === trimmed) return num;
	return s;
}

self.addEventListener('message', (e) => {
	const { id, type, payload } = e.data || {};
	if (type === 'parseTSVChunked') {
		const { tsv, chunkRows = 500 } = payload;
		const rawLines = tsv.split(/\r?\n/);
		const lines =
			rawLines.length > 0 && rawLines[rawLines.length - 1] === ''
				? rawLines.slice(0, -1)
				: rawLines;
		let totalCols = 0;
		for (let i = 0; i < lines.length; i++) {
			const cols = lines[i].split('\t').length;
			if (cols > totalCols) totalCols = cols;
		}
		postMessage({ id, type: 'init', totalRows: lines.length, totalCols });
		for (let rowOffset = 0; rowOffset < lines.length; rowOffset += chunkRows) {
			const slice = lines.slice(rowOffset, rowOffset + chunkRows);
			const values = slice.map((line) => line.split('\t').map(parseCell));
			postMessage({ id, type: 'chunk', rowOffset, values });
		}
		postMessage({ id, type: 'done' });
	}

	// Streaming serialization: main thread sends row chunks of values[][]
	else if (type === 'serializeInit') {
		self.__ser = self.__ser || new Map();
		self.__ser.set(id, { lines: [] });
		postMessage({ id, type: 'ready' });
	} else if (type === 'serializeAppend') {
		if (!self.__ser || !self.__ser.has(id)) return;
		const { values } = payload; // CellValue[][]
		const state = self.__ser.get(id);
		for (let i = 0; i < values.length; i++) {
			const row = values[i];
			const cells = new Array(row.length);
			for (let j = 0; j < row.length; j++) {
				const v = row[j];
				if (v == null) cells[j] = '';
				else if (typeof v === 'number') cells[j] = String(v);
				else if (typeof v === 'boolean') cells[j] = v ? 'TRUE' : 'FALSE';
				else cells[j] = String(v);
			}
			state.lines.push(cells.join('\t'));
		}
		postMessage({ id, type: 'progress', appended: values.length });
	} else if (type === 'serializeFinish') {
		if (!self.__ser || !self.__ser.has(id)) return;
		const state = self.__ser.get(id);
		const tsv = state.lines.join('\n');
		self.__ser.delete(id);
		postMessage({ id, type: 'result', tsv });
	}
});
