/**
 * Envía data/webhooks.jsonl al servidor por HTTP.
 *
 * Modo manual (por defecto): antes de cada evento dice qué va a mandar y
 * espera Enter. Tú marcas el ritmo. En "process.restart" te pide matar y
 * relanzar el servidor antes de seguir.
 *
 * Modo automático: DELAY=1500 node scripts/feed.js  (ms entre eventos).
 *
 * Si el servidor no responde, reintenta hasta 30 s antes de rendirse.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const URL = process.env.URL ?? 'http://localhost:3000';
const DELAY = process.env.DELAY ? Number(process.env.DELAY) : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const waitEnter = (msg) => new Promise((r) => rl.question(msg, () => r()));

const DESCRIBE = {
  'agent_leg.answered': (e) => `el agente contesta su línea ${e.from}`,
  'client_leg.initiated': (e) => `sale llamada ${e.call_control_id} al cliente ${e.client_id} (${e.to})`,
  'client_leg.answered': (e) => `${e.call_control_id}: el cliente contesta${e.duplicate ? '  <- REPETIDO' : ''}`,
  'client_leg.hangup': (e) => `${e.call_control_id}: el cliente cuelga`,
  'sip.failure': (e) => `${e.call_control_id}: falla SIP ${e.code} ${e.message}`,
  'inbound.ringing': (e) => `ENTRA llamada ${e.call_control_id} desde ${e.from}`,
  'lookup.result': (e) => `búsqueda del número ${e.phone}: ${e.matches.length} leads (${e.matches.join(', ')})`,
};

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
console.log(DELAY ? `Modo automático, ${DELAY} ms entre eventos.\n` : 'Modo manual: Enter manda el siguiente evento.\n');

for (const line of lines) {
  const ev = JSON.parse(line);
  if (ev.event === 'process.restart') {
    await waitEnter(`\n--- REINICIO: mata el servidor (Ctrl+C), corre npm start, refresca el navegador. Luego Enter aquí... `);
    console.log();
    continue;
  }
  const desc = DESCRIBE[ev.event]?.(ev) ?? ev.event;
  if (DELAY) { console.log(`seq ${ev.seq}: ${desc}`); await sleep(DELAY); }
  else await waitEnter(`seq ${String(ev.seq).padEnd(2)} -> ${desc}  [Enter] `);
  const out = await post(line);
  console.log(`        ${out.applied ? 'aplicado' : 'IGNORADO (' + out.reason + ')'}`);
}
console.log('\nFeed completo.');
rl.close();
