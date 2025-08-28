<script>
	import Radsheet from '../components/Radsheet/index.svelte';
	let themeOption = $state('dark');
	function toggleTheme() {
		themeOption = themeOption === 'dark' ? 'light' : 'dark';
	}

	// Server-streamed data controls
	let sheetRef;
	let isLoading = $state(false);
	let rowsLoaded = $state(0);
	let targetRows = $state(200000);

	async function loadServerData() {
		if (!sheetRef || !sheetRef.setData) return;
		isLoading = true;
		rowsLoaded = 0;
		const res = await fetch(`/api/data?rows=${targetRows}&cols=50`);
		if (!res.body) {
			isLoading = false;
			return;
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let batch = [];
		const BATCH_ROWS = 10000;

		function flushBatch() {
			if (batch.length === 0) return;
			sheetRef.setData(batch, rowsLoaded, 0);
			rowsLoaded += batch.length;
			batch = [];
		}

		function pump() {
			return reader.read().then(({ done, value }) => {
				if (done) {
					if (buf) {
						try {
							batch.push(JSON.parse(buf));
						} catch {}
						buf = '';
					}
					flushBatch();
					isLoading = false;
					return;
				}
				const chunk = decoder.decode(value, { stream: true });
				buf += chunk;
				let idx;
				while ((idx = buf.indexOf('\n')) !== -1) {
					const line = buf.slice(0, idx);
					buf = buf.slice(idx + 1);
					if (line) {
						try {
							batch.push(JSON.parse(line));
						} catch {}
						if (batch.length >= BATCH_ROWS) {
							flushBatch();
						}
					}
				}
				return new Promise((resolve) => requestAnimationFrame(() => resolve(pump())));
			});
		}

		await pump();
	}
</script>

<main class="flex h-screen w-full flex-col items-center justify-center">
	<div class="mb-3 flex w-11/12 items-center justify-end gap-3">
		<span class="text-sm">Theme: {themeOption}</span>
		<button class="rounded border px-3 py-1 text-sm" onclick={toggleTheme}>
			Toggle Light/Dark
		</button>
		<button class="rounded border px-3 py-1 text-sm" onclick={loadServerData} disabled={isLoading}>
			{isLoading ? `Loading ${rowsLoaded}/{targetRows}…` : 'Load Server Data'}
		</button>
	</div>
	<div class="h-100 w-11/12">
		<Radsheet bind:this={sheetRef} theme={themeOption} editable={true} />
	</div>
</main>
