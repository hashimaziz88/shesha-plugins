#!/usr/bin/env node
// The green:quick heartbeat as a program (§4.3.7): typecheck + gates only — no test, no
// gates:mutate. session-start spawns it with a 20 s cap and reports `exit 0` / `exit <n>`
// / `not measured (timeout)`; it is never a verdict on timeout. --json prints {exit,...}.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runAll } from '../run-gates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const asJson = process.argv.includes('--json');

const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit'], { cwd: root, encoding: 'utf8' }).status;

let gates = 0;
try {
  const out = /** @type {{worst:string}} */ (await runAll());
  gates = out.worst === 'pass' ? 0 : 1;
} catch { gates = 1; }

const exit = (tsc === 0 && gates === 0) ? 0 : 1;
if (asJson) console.log(JSON.stringify({ exit, typecheck: tsc, gates }));
else console.log(`green-quick: typecheck ${tsc} · gates ${gates} -> exit ${exit}`);
process.exit(exit);
