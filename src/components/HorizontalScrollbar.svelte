<script>
	let { totalWidth = 0, containerWidth = 0, scrollLeft = 0, onUpdate } = $props();

	let trackElement = $state(null);
	let isDragging = $state(false);
	let dragStartOffsetX = 0;
	let dragStartScrollLeft = 0;

	const scrollbarVisible = $derived(totalWidth > containerWidth);
	const trackWidth = $derived(containerWidth - 24);

	const thumbWidth = $derived(
		scrollbarVisible ? Math.max(20, (containerWidth / totalWidth) * trackWidth) : 0
	);
	const maxScrollLeft = $derived(totalWidth - containerWidth);
	const thumbPosition = $derived(
		scrollbarVisible && maxScrollLeft > 0
			? (scrollLeft / maxScrollLeft) * (trackWidth - thumbWidth)
			: 0
	);

	function handleThumbMouseDown(event) {
		if (event.button !== 0) return;
		isDragging = true;
		dragStartOffsetX = event.clientX;
		dragStartScrollLeft = scrollLeft;
		window.addEventListener('mousemove', handleThumbMouseMove);
		window.addEventListener('mouseup', handleThumbMouseUp);
		event.preventDefault();
		event.stopPropagation();
	}

	function handleThumbMouseMove(event) {
		if (!isDragging) return;

		const deltaX = event.clientX - dragStartOffsetX;
		const scrollableTrackWidth = trackWidth - thumbWidth;
		if (scrollableTrackWidth <= 0) return;

		const trackToContentRatio = maxScrollLeft / scrollableTrackWidth;
		const newScrollLeft = dragStartScrollLeft + deltaX * trackToContentRatio;

		if (onUpdate) {
			onUpdate(Math.max(0, Math.min(newScrollLeft, maxScrollLeft)));
		}
	}

	function handleThumbMouseUp() {
		isDragging = false;
		window.removeEventListener('mousemove', handleThumbMouseMove);
		window.removeEventListener('mouseup', handleThumbMouseUp);
	}

	function handleTrackClick(event) {
		if (event.target !== trackElement) return;

		const clickX = event.clientX - trackElement.getBoundingClientRect().left;
		const direction = clickX < thumbPosition ? -1 : 1;

		const newScrollLeft = scrollLeft + direction * containerWidth;
		if (onUpdate) {
			onUpdate(Math.max(0, Math.min(newScrollLeft, maxScrollLeft)));
		}
	}

	function scrollLeftBy() {
		const newScrollLeft = scrollLeft - 40;
		if (onUpdate) {
			onUpdate(Math.max(0, newScrollLeft));
		}
	}

	function scrollRightBy() {
		const newScrollLeft = scrollLeft + 40;
		if (onUpdate) {
			onUpdate(Math.min(newScrollLeft, maxScrollLeft));
		}
	}
</script>

{#if scrollbarVisible}
	<div
		class="flex h-3 w-full select-none"
		style="border-top: 1px solid var(--rs-scrollbar-border); background: var(--rs-scrollbar-track);"
	>
		<div
			class="relative flex-grow"
			bind:this={trackElement}
			onmousedown={handleTrackClick}
			role="button"
			aria-label="Scroll track"
			tabindex="0"
		>
			<div
				class="absolute h-full rounded-full opacity-80"
				style="background: var(--rs-scrollbar-thumb);"
				onmouseenter={(e) => (e.currentTarget.style.background = `var(--rs-scrollbar-thumb-hover)`)}
				onmouseleave={(e) => (e.currentTarget.style.background = `var(--rs-scrollbar-thumb)`)}
				style:width="{thumbWidth}px"
				style:left="{thumbPosition}px"
				onmousedown={handleThumbMouseDown}
				role="button"
				aria-label="Scroll thumb"
				tabindex="0"
			></div>
		</div>
		<button
			class="flex h-3 w-3 flex-shrink-0 items-center justify-center"
			style="border-left: 1px solid var(--rs-scrollbar-border); background: var(--rs-scrollbar-button-bg);"
			onmouseenter={(e) =>
				(e.currentTarget.style.background = `var(--rs-scrollbar-button-hover-bg)`)}
			onmouseleave={(e) => (e.currentTarget.style.background = `var(--rs-scrollbar-button-bg)`)}
			onclick={scrollLeftBy}
			title="Scroll left"
			aria-label="Scroll left"
		>
			<svg
				class="h-2 w-2"
				style="color: var(--rs-scrollbar-icon);"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				xmlns="http://www.w3.org/2000/svg"
				><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"
				></path></svg
			>
		</button>
		<button
			class="flex h-3 w-3 flex-shrink-0 items-center justify-center"
			style="border-left: 1px solid var(--rs-scrollbar-border); background: var(--rs-scrollbar-button-bg);"
			onmouseenter={(e) =>
				(e.currentTarget.style.background = `var(--rs-scrollbar-button-hover-bg)`)}
			onmouseleave={(e) => (e.currentTarget.style.background = `var(--rs-scrollbar-button-bg)`)}
			onclick={scrollRightBy}
			title="Scroll right"
			aria-label="Scroll right"
		>
			<svg
				class="h-2 w-2"
				style="color: var(--rs-scrollbar-icon);"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
				xmlns="http://www.w3.org/2000/svg"
				><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"
				></path></svg
			>
		</button>
	</div>
{/if}
