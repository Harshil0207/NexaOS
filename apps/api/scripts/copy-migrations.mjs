import { cpSync, rmSync } from 'node:fs';
rmSync('dist/drizzle', { recursive: true, force: true });
cpSync('drizzle', 'dist/drizzle', { recursive: true });
