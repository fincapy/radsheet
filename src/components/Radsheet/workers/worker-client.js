// @ts-ignore
import ClipboardWorker from './clipboard.worker.js?worker';

let worker = null;
function getWorker() {
	if (!worker) worker = new ClipboardWorker();
	return worker;
}

/**
 * @param {string} tsv
 * @param {{onInit: (totalRows: number, totalCols: number) => void, onChunk: (rowOffset: number, values: any[][]) => void, onDone: () => void}} callbacks
 */
export function parseTSVChunked(tsv, { onInit, onChunk, onDone }) {
	const worker = getWorker();
	const id = Date.now() + '-' + Math.random().toString(36).slice(2);

	const handler = (ev) => {
		const msg = ev.data;
		if (!msg || msg.id !== id) return;
		if (msg.type === 'init') {
			onInit(msg.totalRows, msg.totalCols);
		} else if (msg.type === 'chunk') {
			onChunk(msg.rowOffset, msg.values);
		} else if (msg.type === 'done') {
			worker.removeEventListener('message', handler);
			onDone();
		}
	};
	worker.addEventListener('message', handler);
	worker.postMessage({ id, type: 'parseTSVChunked', payload: { tsv } });
}

/**
 * @param {function(number, number): any} readCell
 * @param {number} r1
 * @param {number} c1
 * @param {number} r2
 * @param {number} c2
 * @returns {Promise<string>}
 */
export function serializeRangeToTSVAsync(readCell, r1, c1, r2, c2) {
	const worker = getWorker();
	const id = Date.now() + '-' + Math.random().toString(36).slice(2);

	return new Promise((resolve) => {
		const handler = (ev) => {
			const msg = ev.data;
			if (!msg || msg.id !== id) return;
			if (msg.type === 'result') {
				worker.removeEventListener('message', handler);
				resolve(msg.tsv);
			}
		};
		worker.addEventListener('message', handler);
		worker.postMessage({ id, type: 'serializeInit' });

		// Stream out rows in chunks
		const CHUNK_ROWS = 500;
		for (let start = r1; start <= r2; start += CHUNK_ROWS) {
			const end = Math.min(r2, start + CHUNK_ROWS - 1);
			const values = [];
			for (let r = start; r <= end; r++) {
				const row = [];
				for (let c = c1; c <= c2; c++) row.push(readCell(r, c));
				values.push(row);
			}
			worker.postMessage({ id, type: 'serializeAppend', payload: { values } });
		}
		worker.postMessage({ id, type: 'serializeFinish' });
	});
}
