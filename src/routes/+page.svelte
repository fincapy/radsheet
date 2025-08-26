<script>
	import Radsheet from '../components/Radsheet/index.svelte';
	let themeOption = $state('dark');
	function toggleTheme() {
		themeOption = themeOption === 'dark' ? 'light' : 'dark';
	}
	const data = $state([
		{ name: 'Alice', age: 25 },
		{ name: 'Bob', age: 30 },
		{ name: 'Charlie', age: 35 }
	]);
</script>

<main class="flex h-screen w-full flex-col items-center justify-center">
	<div class="mb-3 flex w-11/12 items-center justify-end gap-3">
		<span class="text-sm">Theme: {themeOption}</span>
		<button class="rounded border px-3 py-1 text-sm" onclick={toggleTheme}>
			Toggle Light/Dark
		</button>
	</div>
	<div class="h-100 w-11/12">
		<Radsheet theme={themeOption} {data} />
	</div>
</main>
