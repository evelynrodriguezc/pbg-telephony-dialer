/**
 * Envía data/webhooks.jsonl al servidor por HTTP, un evento cada DELAY ms,
 * para ver el estado cambiar en vivo en http://localhost:3000.
 * En "process.restart" se detiene y espera Enter: ahí matas y relanzas el
 * servidor (npm start), presionas Enter, y verás que el estado volvió igual.
 * Si el servidor no responde, reintenta hasta 30 s antes de rendirse.
 *
 *   node scripts/feed.js            # contra localhost:3000, 1500 ms entre eventos
 *   DELAY=500 node scripts/feed.js
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const URL = process.env.URL ?? 'http://localhost:3000';
const DELAY = Number(process.env.DELAY ?? 1500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitEnter = (msg) => new Promise((r) => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(msg, () => { rl.close(); r(); }); });

async function post(line) {
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(`${URL}/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: line });
      return await res.json();
    } catch {
      if (i === 0) process.stdout.write('  (servidor no responde, esperando...)');
      await sleep(1000);
    }
  }
  throw new Error('servidor no volvió en 30 s');
}
const lines = fs.readFileSync(path.resolve('data/webhooks.jsonl'), 'utf8').split('\n').filter(Boolean);

for (const line of lines) {
  const ev = JSON.parse(line);
  if (ev.event === 'process.restart') {
    await waitEnter(`seq ${ev.seq}  process.restart  -> mata el servidor (Ctrl+C) y vuelve a correr npm start. Luego presiona Enter aquí... `);
    continue;
  }
  const out = await post(line);
  console.log(`seq ${String(ev.seq).padEnd(3)} ${ev.event.padEnd(22)} ${(ev.call_control_id ?? '-').padEnd(6)} -> ${out.applied ? 'aplicado' : 'ignorado: ' + out.reason}`);
  await sleep(DELAY);
}
console.log('Feed completo. Abre', URL);
