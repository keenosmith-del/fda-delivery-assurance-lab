import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const { PORT = '3000' } = loadEnv(mode, '..', '');
  const proxy = { '/api': `http://127.0.0.1:${PORT}` };
  return { esbuild: { jsx: 'automatic' }, server: { proxy }, preview: { proxy } };
});
