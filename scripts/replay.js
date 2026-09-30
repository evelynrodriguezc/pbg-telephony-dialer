/**
 * Alimenta data/webhooks.jsonl al store en el orden en que llegan.
 * Cuando aparece "process.restart" tira el proceso lógico: descarta el store en
 * memoria y vuelve a abrirlo desde disco (snapshot + log). Luego compara.
 */
import fs from 'node:fs';
import path from 'node:path';
import { EventStore } from '../src/store.js';
import { loadReputation, lineWarnings } from '../src/reputation.js';

const dir = path.resolve(process.env.DATA_DIR ?? 'runtime-replay');
fs.rmSync(dir, { recursive: true, force: true });

const reputation = loadReputation(path.resolve('data/number_reputation.csv'));
let store = new EventStore(dir, { snapshotEvery: 3, reputation });
const lines = fs.readFileSync(path.resolve('data/webhooks.jsonl'), 'utf8').split('\n').filter(Boolean);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('seq', 4), pad('event', 22), pad('id', 6), pad('accepted', 9), pad('applied', 8), 'reason');
for (const line of lines) {
  const ev = JSON.parse(line);
  if (ev.event === 'process.restart') {
    const before = JSON.stringify(store.state);
    store = null; // "muere" el proceso
    const { store: reopened, report } = EventStore.open(dir, { snapshotEvery: 3, reputation });
    store = reopened;
    const same = JSON.stringify(store.state) === before;
    console.log(pad(ev.seq, 4), pad('process.restart', 22), pad('-', 6), pad('-', 9), pad('-', 8),
      `recovered fromSnapshot=${report.fromSnapshot} replayed=${report.replayed} skipped=${report.skipped} stateIdentical=${same}`);
    continue;
  }
  const r = store.ingest(ev);
  const flag = store.state.legs[ev.call_control_id]?.reputationFlag;
  const note = ev.event === 'client_leg.initiated' && flag ? `  [línea ${flag.line} quemada: ${flag.label}, ${flag.calls24h}/24h; usar ${flag.recommendedLine}]` : '';
  console.log(pad(ev.seq, 4), pad(ev.event, 22), pad(ev.call_control_id ?? '-', 6), pad(r.accepted, 9), pad(r.applied, 8), r.reason + note);
}

// Segunda pasada: reenviar TODO el feed otra vez (reintentos del proveedor).
let dupes = 0;
for (const line of lines) {
  const ev = JSON.parse(line);
  if (ev.event === 'process.restart') continue;
  if (!store.ingest(ev).accepted) dupes += 1;
}
console.log(`\nReenvío completo del feed: ${dupes} eventos descartados por clave repetida, estado sin cambios.`);

console.log('\nESTADO FINAL');
console.log(JSON.stringify({ ...store.state, warnings: lineWarnings(store.state, reputation) }, null, 2));
