<script>
	let {
		values,
		onApply,
		onClear,
		onClose,
		loading = false,
		loadedCount = 0,
		totalCount = 0,
		hasMore = false,
		onLoadMore = null,
		onSearch = null,
		initialCondition = null
	} = $props();

	let searchTerm = $state('');
	let activeTab = $state('values'); // 'values' | 'condition'
	let conditionOp = $state('contains');
	let conditionTerm = $state('');

	$effect(() => {
		if (initialCondition && initialCondition.op) {
			conditionOp = initialCondition.op;
			conditionTerm = initialCondition.term || '';
			activeTab = 'condition';
		}
	});

	$effect(() => {
		if (onSearch) onSearch(searchTerm);
	});

	let listEl = $state(null);
	let rootEl = $state(null);

	let armed = $state(false);
	function armOnPointerUp() {
		armed = true;
	}

	function handleWindowPointerDown(e) {
		if (!armed) return;
		if (rootEl && e && e.target && !rootEl.contains(e.target)) {
			onClose();
		}
	}

	function handleToggleAll(e) {
		const isChecked = e.currentTarget.checked;
		for (const item of values) item.checked = isChecked;
	}

	const allChecked = $derived(values.length > 0 && values.every((v) => v.checked));
	const isIndeterminate = $derived(!allChecked && values.some((v) => v.checked));
</script>

<svelte:window
	on:keydown.escape={onClose}
	on:pointerup|capture={armOnPointerUp}
	on:pointerdown|capture={handleWindowPointerDown}
/>

<div
	data-rs-filter-popover
	class="fixed z-50 flex w-72 flex-col rounded-lg border bg-white shadow-xl"
	style="background: var(--rs-popover-bg); color: var(--rs-popover-text); border: 1px solid var(--rs-popover-border); overscroll-behavior: none;"
	role="dialog"
	aria-modal="true"
	tabindex="-1"
	onwheel={(e) => e.stopPropagation()}
	bind:this={rootEl}
	onpointerdown={(e) => e.stopPropagation()}
>
	<div
		class="flex items-center justify-between border-b px-2 py-2"
		style="border-color: var(--rs-popover-border);"
	>
		<div
			class="inline-flex rounded bg-transparent p-0 text-xs"
			style="color: var(--rs-popover-muted-text);"
		>
			<button
				class="cursor-pointer px-2 py-1"
				aria-pressed={activeTab === 'values'}
				onclick={() => (activeTab = 'values')}
				style={`color: var(--rs-popover-text); ${activeTab === 'values' ? 'font-weight:600; text-decoration:underline;' : ''}`}
				>Values</button
			>
			<button
				class="cursor-pointer px-2 py-1"
				aria-pressed={activeTab === 'condition'}
				onclick={() => (activeTab = 'condition')}
				style={`color: var(--rs-popover-text); ${activeTab === 'condition' ? 'font-weight:600; text-decoration:underline;' : ''}`}
				>Condition</button
			>
		</div>
		<input
			type="text"
			placeholder="Search..."
			bind:value={searchTerm}
			class="ml-2 w-32 rounded border px-2 py-1 text-xs"
			style="background: var(--rs-editor-bg); color: var(--rs-editor-text); border-color: var(--rs-popover-border);"
		/>
	</div>

	{#if activeTab === 'values'}
		<div
			bind:this={listEl}
			class="max-h-60 flex-1 overflow-y-auto"
			onwheel={(e) => e.stopPropagation()}
			style="scrollbar-color: var(--rs-scrollbar-thumb) var(--rs-scrollbar-track); scrollbar-width: thin; overscroll-behavior: none;"
		>
			<label class="flex w-full items-center px-3 py-2 text-sm font-medium">
				<input
					type="checkbox"
					class="mr-2 accent-rose-500"
					checked={allChecked}
					indeterminate={isIndeterminate}
					onchange={handleToggleAll}
				/>
				(Select All)
			</label>

			{#each values as item}
				<label class="flex w-full items-center px-3 py-1.5 text-sm">
					<input type="checkbox" class="mr-2 accent-rose-500" bind:checked={item.checked} />
					<span class="truncate">{item.value === null ? '(Blanks)' : item.value}</span>
				</label>
			{/each}

			{#if hasMore}
				<div class="px-3 py-2 text-xs" style="color: var(--rs-popover-muted-text);">
					Not all values shown.
					{#if onLoadMore}
						<button
							class="ml-2 underline"
							onclick={onLoadMore}
							style="color: var(--rs-popover-text);">Load more…</button
						>
					{/if}
				</div>
			{/if}
		</div>
		<div class="flex justify-end border-t p-2" style="border-color: var(--rs-popover-border);">
			<button
				onclick={onClear}
				class="cursor-pointer rounded px-3 py-1 text-sm"
				style="color: var(--rs-popover-muted-text);">Clear</button
			>
			<button
				onclick={() => onApply(values)}
				class="ml-2 cursor-pointer rounded px-3 py-1 text-sm text-white"
				style="background: var(--rs-popover-apply-button);">Apply</button
			>
		</div>
	{/if}

	{#if activeTab === 'condition'}
		<div class="p-3 text-sm">
			<label class="mb-1 block text-xs" style="color: var(--rs-popover-muted-text);">
				Condition
				<select
					bind:value={conditionOp}
					class="mt-1 mb-2 w-full cursor-pointer rounded border px-2 py-1 text-sm"
					style="background: var(--rs-editor-bg); color: var(--rs-editor-text); border-color: var(--rs-popover-border);"
				>
					<option value="contains">Text contains</option>
					<option value="equals">Text equals</option>
					<option value="startsWith">Text starts with</option>
					<option value="endsWith">Text ends with</option>
					<option value="isBlank">Is blank</option>
					<option value="isNotBlank">Is not blank</option>
				</select>
			</label>
			{#if conditionOp !== 'isBlank' && conditionOp !== 'isNotBlank'}
				<input
					type="text"
					bind:value={conditionTerm}
					class="w-full rounded border px-2 py-1 text-sm"
					placeholder="Value"
					style="background: var(--rs-editor-bg); color: var(--rs-editor-text); border-color: var(--rs-popover-border);"
				/>
			{/if}
		</div>
		<div class="flex justify-end border-t p-2" style="border-color: var(--rs-popover-border);">
			<button
				onclick={onClear}
				class="cursor-pointer rounded px-3 py-1 text-sm"
				style="color: var(--rs-popover-muted-text);">Clear</button
			>
			<button
				onclick={() => onApply({ condition: { op: conditionOp, term: conditionTerm } })}
				class="ml-2 cursor-pointer rounded px-3 py-1 text-sm text-white"
				style="background: var(--rs-popover-apply-button);">Apply</button
			>
		</div>
	{/if}
</div>
