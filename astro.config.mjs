// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  vite: {
      plugins: [tailwindcss()],
      server: {
        allowedHosts: ['64hljs-ip-37-15-53-53.tunnelmole.net']
      }
	},

  integrations: [react()]
});