import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/global-gossip/',
  plugins: [react()],
  server: {
    port: 8924,
    host: true, // Listen on all addresses
  },
});

