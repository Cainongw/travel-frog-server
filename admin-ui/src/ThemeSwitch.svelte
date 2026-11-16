<script>
  import { onMount } from 'svelte';
  import { createThemeController } from './theme.js';
  let preference = 'system';
  let controller;
  onMount(() => {
    controller = createThemeController({ onChange: value => { preference = value.preference; } });
    return () => controller.dispose();
  });
</script>

<label class="theme-switch">外观
  <select aria-label="外观主题" bind:value={preference} onchange={() => controller?.set(preference)}>
    <option value="system">跟随系统</option>
    <option value="light">浅色</option>
    <option value="dark">深色</option>
  </select>
</label>
