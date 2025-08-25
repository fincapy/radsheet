<script>
	const { editorState, commandBus, CELL_WIDTH, CELL_HEIGHT, scrollLeft, scrollTop } = $props();

	let inputEl = $state(null);

	$effect(() => {
		if (editorState.open && inputEl) {
			queueMicrotask(() => {
				inputEl.focus({ preventScroll: true });
				if (editorState.seedText == null) {
					inputEl.select(); // Replace existing by default
				} else {
					inputEl.setSelectionRange(editorState.value.length, editorState.value.length);
				}
			});
		}
	});
</script>

{#if editorState.open}
	<input
		class="editor absolute z-20 border-2 border-blue-500 bg-white px-2 text-sm outline-none"
		bind:this={inputEl}
		style="left: {editorState.col * CELL_WIDTH - scrollLeft}px; top: {editorState.row *
			CELL_HEIGHT -
			scrollTop}px; width: {CELL_WIDTH}px; height: {CELL_HEIGHT}px;"
		value={editorState.value}
		oninput={(e) =>
			commandBus.dispatch({ type: 'UpdateEditorValue', payload: { value: e.currentTarget.value } })}
		onkeydown={commandBus.handleKeyDown}
		onblur={() => commandBus.dispatch({ type: 'CommitEditor', payload: { save: true } })}
	/>
{/if}

<style>
	.editor {
		box-sizing: border-box;
	}
</style>
