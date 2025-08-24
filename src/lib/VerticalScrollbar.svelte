<script>
	let { scrollTop = 0, totalHeight = 0, viewportHeight = 0, onUpdate } = $props();

	let trackElement = $state(null);
	let isDragging = $state(false);
	let dragStartOffsetY = 0;
	let dragStartScrollTop = 0;

	const scrollbarVisible = $derived(totalHeight > viewportHeight);
	// Fall back to viewportHeight in environments where clientHeight is 0 (e.g., JSDOM)
	const trackHeight = $derived(
		trackElement && trackElement.clientHeight > 0 ? trackElement.clientHeight : viewportHeight
	);
	const thumbHeight = $derived(
		scrollbarVisible ? Math.max(20, (viewportHeight / totalHeight) * trackHeight) : 0
	);
	const maxScrollTop = $derived(totalHeight - viewportHeight);
	const thumbPosition = $derived(
		scrollbarVisible && maxScrollTop > 0
			? (scrollTop / maxScrollTop) * (trackHeight - thumbHeight)
			: 0
	);

	function handleThumbMouseDown(event) {
		if (event.button !== 0) return;
		isDragging = true;
		dragStartOffsetY = event.clientY;
		dragStartScrollTop = scrollTop;
		window.addEventListener('mousemove', handleThumbMouseMove);
		window.addEventListener('mouseup', handleThumbMouseUp);
		event.preventDefault();
		event.stopPropagation();
	}

	function handleThumbMouseMove(event) {
		if (!isDragging) return;

		const deltaY = event.clientY - dragStartOffsetY;
		const scrollableTrackHeight = trackHeight - thumbHeight;
		if (scrollableTrackHeight <= 0) return;

		const trackToContentRatio = maxScrollTop / scrollableTrackHeight;
		const newScrollTop = dragStartScrollTop + deltaY * trackToContentRatio;

		if (onUpdate) {
			onUpdate(Math.max(0, Math.min(newScrollTop, maxScrollTop)));
		}
	}

	function handleThumbMouseUp() {
		isDragging = false;
		window.removeEventListener('mousemove', handleThumbMouseMove);
		window.removeEventListener('mouseup', handleThumbMouseUp);
	}

	function handleTrackClick(event) {
		if (event.target !== trackElement) return;

		const clickY = event.clientY - trackElement.getBoundingClientRect().top;
		const direction = clickY < thumbPosition ? -1 : 1;

		const newScrollTop = scrollTop + direction * viewportHeight;
		if (onUpdate) {
			onUpdate(Math.max(0, Math.min(newScrollTop, maxScrollTop)));
		}
	}

	function scrollUp() {
		const newScrollTop = scrollTop - 40;
		if (onUpdate) {
			onUpdate(Math.max(0, newScrollTop));
		}
	}

	function scrollDown() {
		const newScrollTop = scrollTop + 40;
		if (onUpdate) {
			onUpdate(Math.min(newScrollTop, maxScrollTop));
		}
	}
</script>

{#if scrollbarVisible}
	<div class="flex h-full w-3 flex-col border-l border-gray-300 bg-gray-100">
		<div
			class="relative flex-grow"
			bind:this={trackElement}
			onmousedown={handleTrackClick}
			role="button"
			aria-label="Scroll track"
			tabindex="0"
		>
			<div
				class="absolute w-full cursor-pointer rounded-full bg-gray-400 opacity-80 hover:bg-gray-500 {isDragging
					? '!bg-gray-600'
					: ''}"
				style:height="{thumbHeight}px"
				style:top="{thumbPosition}px"
				onmousedown={handleThumbMouseDown}
				role="button"
				aria-label="Scroll thumb"
				tabindex="0"
			></div>
		</div>
		<button
			class="flex h-3 w-3 flex-shrink-0 items-center justify-center border-t border-gray-300 bg-gray-50 hover:bg-gray-200"
			onclick={scrollUp}
			title="Scroll up"
			aria-label="Scroll up"
		>
			<svg
				class="h-2 w-2 text-gray-600"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				xmlns="http://www.w3.org/2000/svg"
				><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"
				></path></svg
			>
		</button>
		<button
			class="flex h-3 w-3 flex-shrink-0 items-center justify-center border-t border-gray-300 bg-gray-50 hover:bg-gray-200"
			onclick={scrollDown}
			title="Scroll down"
			aria-label="Scroll down"
		>
			<svg
				class="h-2 w-2 text-gray-600"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				xmlns="http://www.w3.org/2000/svg"
				><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"
				></path></svg
			>
		</button>
	</div>
{/if}
