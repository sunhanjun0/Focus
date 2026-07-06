import fs from 'node:fs';
import path from 'node:path';

const assets = [
  ['src/db/schema.sql', 'dist/db/schema.sql'],
];

for (const [from, to] of assets) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}
