<script>
	import { columns } from '../domain/sheet.svelte.js';
	let { rowIndex, colIndex, cellHeight, cellWidth, sheet } = $props();
	let inputActive = $state(false)
	let value = $state(null)

</script>

<div
    role="gridcell"
    tabindex="0"
	class="absolute box-border flex items-center justify-center border-r border-b border-gray-200 text-sm"
	ondblclick={() => inputActive = true}
	style="
        top: {rowIndex * cellHeight}px;
        left: {colIndex * cellWidth}px;
        height: {cellHeight}px;
        width: {cellWidth}px;
    "
>
    {#if inputActive}
        <input bind:value={value} type="text" class="w-full h-full" />
    {:else}
        {sheet.cells[`${columns[colIndex]}${rowIndex + 1}`]}
    {/if}
</div>
