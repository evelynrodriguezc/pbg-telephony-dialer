/**
 * Envía data/webhooks.jsonl al servidor por HTTP, un evento cada DELAY ms,
 * para ver el estado cambiar en vivo en http://localhost:3000.
 * En "process.restart" se detiene unos segundos: ahí puedes matar y relanzar
 * el servidor (npm start) y verás que el estado vuelve igual.
 *
 *   node scripts/feed.js            # contra localhost:3000, 1500 ms entre eventos
 *   DELAY=500 node scripts/feed.js
 */
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.URL ?? 'http://localhost:3000';
const DELAY = Number(process.env.DELAY ?? 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = fs.readFileSync(path.resolve('data/webhooks.jsonl'), 'utf8').split('\n').filter(Boolean);

for (const line of lines) {
  const ev = JSON.parse(line);
  if (ev.event === 'process.restart') {
    console.log(`seq ${ev.seq}  process.restart  -> pausa ${DELAY * 4} ms. Reinicia el servidor ahora si quieres mostrar la recuperación.`);
    await sleep(DELAY * 4);
    continue;
  }
  const res = await fetch(`${URL}/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: line });
  const out = await res.json();
  console.log(`seq ${String(ev.seq).padEnd(3)} ${ev.event.padEnd(22)} ${(ev.call_control_id ?? '-').padEnd(6)} -> ${out.applied ? 'aplicado' : 'ignorado: ' + out.reason}`);
  await sleep(DELAY);
}
console.log('Feed completo. Abre', URL);
