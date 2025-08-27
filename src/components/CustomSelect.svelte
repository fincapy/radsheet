<script>
	let {
		value,
		options = [],
		placeholder = 'Select...',
		disabled = false,
		class: className = ''
	} = $props();

	let isOpen = $state(false);
	let selectedOption = $derived(options.find((opt) => opt.value === value));
	let displayText = $derived(selectedOption ? selectedOption.label : placeholder);
	let dropdownId = $state(`select-${Math.random().toString(36).substr(2, 9)}`);

	function handleSelect(option, event) {
		event?.preventDefault();
		event?.stopPropagation();
		value = option.value;
		// Use nextTick to ensure the state update happens after the current event cycle
		queueMicrotask(() => {
			isOpen = false;
		});
	}

	function handleKeydown(e) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			isOpen = !isOpen;
		} else if (e.key === 'Escape') {
			isOpen = false;
		}
	}

	function handleClickOutside(e) {
		if (e.target && !e.target.closest('[data-custom-select]')) {
			isOpen = false;
		}
	}

	function handleWindowPointerDown(e) {
		if (isOpen && e.target && !e.target.closest('[data-custom-select]')) {
			isOpen = false;
		}
	}

	function handleFocusOut(e) {
		// Close dropdown when focus moves outside the component
		if (isOpen && !e.currentTarget.contains(e.relatedTarget)) {
			isOpen = false;
		}
	}

	$effect(() => {
		if (isOpen) {
			// Use pointerdown instead of click to avoid conflicts with FilterPopover
			window.addEventListener('pointerdown', handleWindowPointerDown, true);
			return () => window.removeEventListener('pointerdown', handleWindowPointerDown, true);
		}
	});
</script>

<div
	data-custom-select
	class="relative {className}"
	role="combobox"
	aria-expanded={isOpen}
	aria-haspopup="listbox"
	aria-controls={dropdownId}
	tabindex={disabled ? -1 : 0}
	onkeydown={handleKeydown}
	onfocusout={handleFocusOut}
>
	<!-- Trigger button -->
	<button
		type="button"
		class="custom-select-trigger flex w-full cursor-pointer items-center justify-between rounded border px-2 py-1 text-sm transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
		style="background: var(--rs-editor-bg); color: var(--rs-editor-text); border-color: var(--rs-popover-border);"
		onclick={() => !disabled && (isOpen = !isOpen)}
		{disabled}
		aria-label="Select option"
	>
		<span class="truncate">{displayText}</span>
		<svg
			class="ml-2 h-4 w-4 transition-transform"
			style="color: var(--rs-icon-muted); transform: rotate({isOpen ? 180 : 0}deg);"
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
		</svg>
	</button>

	<!-- Dropdown -->
	{#if isOpen}
		<div
			id={dropdownId}
			class="absolute top-full right-0 left-0 z-50 mt-1 max-h-60 overflow-auto rounded border shadow-lg"
			style="background: var(--rs-popover-bg); border-color: var(--rs-popover-border);"
			role="listbox"
		>
			{#each options as option}
				<button
					type="button"
					class="custom-select-option flex w-full cursor-pointer items-center px-3 py-2 text-sm transition-colors"
					style="color: var(--rs-popover-text);"
					onclick={(e) => handleSelect(option, e)}
					role="option"
					aria-selected={option.value === value}
				>
					<span class="truncate">{option.label}</span>
					{#if option.value === value}
						<svg
							class="ml-auto h-4 w-4"
							style="color: var(--rs-popover-apply-button);"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							/>
						</svg>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.custom-select-trigger:focus {
		border-color: var(--rs-editor-border-focus);
		box-shadow: 0 0 0 2px var(--rs-editor-border-focus);
	}

	.custom-select-option:hover {
		background-color: var(--rs-popover-hover-bg);
	}
</style>
