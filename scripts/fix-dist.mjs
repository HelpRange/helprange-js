// Marks dist/cjs as CommonJS and dist/esm as ESM, so Node picks the right loader for each build.
import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), JSON.stringify({ type: 'commonjs' }) + '\n');
writeFileSync(new URL('../dist/esm/package.json', import.meta.url), JSON.stringify({ type: 'module' }) + '\n');
