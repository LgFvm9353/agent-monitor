import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM + CJS (共享)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    outExtension({ format }) {
      return {
        js: format === 'esm' ? '.mjs' : '.cjs',
      };
    },
    dts: true,
    sourcemap: true,
    clean: false,
    minify: true,
    treeshake: true,
    splitting: false,
    define: {
      SDK_VERSION: JSON.stringify('0.1.0'),
    },
    // 保持类名可读（调试用），但压缩内部代码
    keepNames: true,
  },
  // IIFE（浏览器直接使用）
  {
    entry: { 'index.iife': 'src/index.ts' },
    format: ['iife'],
    outExtension() {
      return { js: '.js' };
    },
    globalName: 'AgentHarnessMonitor',
    sourcemap: true,
    clean: false,
    minify: true,
    treeshake: true,
    define: {
      SDK_VERSION: JSON.stringify('0.1.0'),
    },
    keepNames: true,
  },
]);
