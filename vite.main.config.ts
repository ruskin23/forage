import { defineConfig } from 'vite';
import path from 'node:path';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    rollupOptions: {
      external: [
        'better-sqlite3',
        'dotenv',
        '@openai/agents',
        '@openai/agents-core',
        /^@unified-latex\//,
        'embedded-postgres',
        'fast-xml-parser',
        'postgres',
        'tar',
      ],
    },
  },
});
