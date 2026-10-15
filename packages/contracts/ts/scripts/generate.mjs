// Generates src/generated.ts from ../schema/contracts.schema.json. `--check` fails if it is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { compile } from 'json-schema-to-typescript';

const schemaUrl = new URL('../../schema/contracts.schema.json', import.meta.url);
const outUrl = new URL('../src/generated.ts', import.meta.url);
const schema = JSON.parse(readFileSync(schemaUrl, 'utf8'));
// The bundle has no root type; emit every definition.
const root = { ...schema, title: 'ParkRightContracts', type: 'object', additionalProperties: false, properties: {} };
const ts = await compile(root, 'ParkRightContracts', {
  bannerComment: '/* Generated from packages/contracts/schema/contracts.schema.json — do not edit. Run `npm run contracts:generate`. */',
  unreachableDefinitions: true,
  additionalProperties: false,
  style: { singleQuote: true, printWidth: 120 },
});
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(outUrl, 'utf8'); } catch {}
  if (current !== ts) {
    console.error('src/generated.ts is out of date — run `npm run contracts:generate`');
    process.exit(1);
  }
} else {
  writeFileSync(outUrl, ts);
  console.log('wrote src/generated.ts');
}
