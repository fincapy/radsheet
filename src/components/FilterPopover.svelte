<script>
	let {
		values, // { value: any, checked: boolean }[]
		onApply,
		onClear,
		onClose
	} = $props();

	let searchTerm = $state('');

	const filteredValues = $derived(
		values.filter((v) => String(v.value).toLowerCase().includes(searchTerm.toLowerCase()))
	);

	function handleToggleAll(e) {
		const isChecked = e.currentTarget.checked;
		for (const item of values) {
			item.checked = isChecked;
		}
	}

	const allChecked = $derived(values.every((v) => v.checked));
	const isIndeterminate = $derived(!allChecked && values.some((v) => v.checked));
</script>

<svelte:window on:keydown.escape={onClose} />

<div
	class="fixed z-50 flex w-64 flex-col rounded-lg border bg-white shadow-xl"
	style="background: var(--rs-popover-bg); color: var(--rs-popover-text); border: 1px solid var(--rs-popover-border);"
	role="dialog"
	aria-modal="true"
	onwheel={(e) => e.stopPropagation()}
>
	<div class="border-b p-2" style="border-color: var(--rs-popover-border);">
		<input
			type="text"
			placeholder="Search values..."
			bind:value={searchTerm}
			class="w-full rounded border px-2 py-1 text-sm"
			style="background: var(--rs-editor-bg); color: var(--rs-editor-text); border-color: var(--rs-popover-border);"
		/>
	</div>

	<div
		class="max-h-60 flex-1 overflow-y-auto"
		onwheel={(e) => e.stopPropagation()}
		style="
			scrollbar-color: var(--rs-scrollbar-thumb) var(--rs-scrollbar-track);
			scrollbar-width: thin;
		"
	>
		<label class="flex w-full items-center px-3 py-2 text-sm font-medium">
			<input
				type="checkbox"
				class="mr-2"
				checked={allChecked}
				indeterminate={isIndeterminate}
				onchange={handleToggleAll}
			/>
			(Select All)
		</label>
		{#each filteredValues as item}
			<label class="flex w-full items-center px-3 py-1.5 text-sm">
				<input type="checkbox" class="mr-2" bind:checked={item.checked} />
				<span class="truncate">{item.value === null ? '(Blanks)' : item.value}</span>
			</label>
		{/each}
	</div>

	<div class="flex justify-end border-t p-2" style="border-color: var(--rs-popover-border);">
		<button
			onclick={onClear}
			class="rounded px-3 py-1 text-sm hover:bg-gray-100"
			style="color: var(--rs-popover-muted-text); --hover-bg: var(--rs-popover-hover-bg);"
		>
			Clear
		</button>
		<button
			onclick={() => onApply(values)}
			class="ml-2 rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
			style="background: var(--rs-selection-stroke); color: white;"
		>
			Apply
		</button>
	</div>
	}
</div>

<div class="fixed inset-0 z-40" onclick={onClose}></div>
