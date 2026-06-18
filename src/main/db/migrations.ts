// Production migration list. Uses Vite's ?raw imports, which are valid only
// inside the Electron main bundle. Test scripts under tsx must build their own
// migration list via fs.readFileSync instead — this file should not be
// imported from any tsx-driven entry point.

import initialSchema from './migrations/001_initial.sql?raw';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const PROD_MIGRATIONS: Migration[] = [
  { version: 1, name: '001_initial', sql: initialSchema },
];
