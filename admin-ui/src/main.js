import { mount } from 'svelte';
import App from './App.svelte';
import './style.css';
import './themes.css';
import { initializeTheme } from './theme.js';

initializeTheme();
mount(App, { target: document.getElementById('app') });
