<script>
  import { onDestroy } from 'svelte';
  import { getImage } from './api.js';

  export let picture = null;
  export let compact = false;
  let canvas;
  let loading = false;
  let error = '';
  let revision = 0;
  async function draw(target, value) {
    const current = ++revision;
    error = '';
    const context = target.getContext('2d');
    context.clearRect(0, 0, 500, 350);
    if (!value?.layers?.length) return;
    loading = true;
    try {
      const layers = await Promise.all(value.layers.map(async ({ layer }) => ({ image: await getImage(layer[0]), x: layer[1], y: layer[2] })));
      if (current !== revision) return;
      for (const layer of layers) context.drawImage(layer.image, layer.x, layer.y);
    } catch (e) {
      if (current === revision) error = e.message;
    } finally {
      if (current === revision) loading = false;
    }
  }
  $: if (canvas) draw(canvas, picture);
  onDestroy(() => revision++);
</script>

<div class:compact class="postcard-art" aria-busy={loading}>
  <canvas bind:this={canvas} width="500" height="350" aria-label="明信片图层合成预览"></canvas>
  {#if loading}<div class="art-message">正在收集沿途风景…</div>{/if}
  {#if error}<div class="art-message art-error">{error}<small>请确认服务器配置了对应的 APK 图片资源。</small></div>{/if}
  {#if !picture}<div class="art-message">选择一张明信片，看看沿途的风景。</div>{/if}
</div>
