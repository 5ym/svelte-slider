<script lang="ts">
	import Slider from './lib/Slider.svelte';

	const image =
		'https://4.bp.blogspot.com/-4xxTe_qeV1E/Vd7FkNUlwjI/AAAAAAAAxFc/8u9MNKtg7gg/s800/syachiku.png';
	const slides = [1, 2, 3, 4, 5];
</script>

<Slider>
	{#each slides as n (n)}
		<a href="#{n}"><img src={image} alt={`スライド ${n}`} /></a>
	{/each}
</Slider>

<style>
	img {
		width: 100%;
	}
</style>
