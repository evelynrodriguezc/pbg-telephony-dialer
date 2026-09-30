/**
 * HTTP mínimo (sin dependencias).
 *   POST /webhooks  -> valida, persiste, responde 200 rápido. Body: evento JSON.
 *   GET  /          -> vista HTML del estado (línea del agente + piernas).
 *   GET  /state     -> estado completo (agentes, piernas, contadores, advertencias).
 *   GET  /health    -> ok + lastSeq.
 *   POST /dial      -> { agentId, to }: decide si se puede marcar desde la línea
 *                      del agente según reputación. Devuelve línea recomendada
 *                      si la actual está quemada. No marca nada (no hay proveedor).
 *
 * Firma opcional: si existe WEBHOOK_SECRET, el header x-signature debe ser
 * HMAC-SHA256(body). Sin secreto configurado se acepta todo (modo demo).
 */
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventStore } from './store.js';
import { loadReputation, lineWarnings, dialDecision } from './reputation.js';

const PORT = Number(process.env.PORT ?? 3000);
const DATA_DIR = process.env.DATA_DIR ?? path.resolve('runtime');
const SECRET = process.env.WEBHOOK_SECRET ?? '';

const reputation = loadReputation(path.resolve('data/number_reputation.csv'));
const { store, report } = EventStore.open(DATA_DIR, { reputation });
console.log('[boot] recovered', report);

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function validSignature(raw, header) {
  if (!SECRET) return true;
  const expected = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const given = Buffer.from(String(header ?? ''));
  // timingSafeEqual lanza si los largos difieren; comparar largo primero evita tumbar el proceso.
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), given);
}

const UI = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui.html'));

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(UI);
  }
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, lastSeq: store.state.lastSeq });
  }
  if (req.method === 'GET' && req.url === '/state') {
    return json(res, 200, { ...store.state, warnings: lineWarnings(store.state, reputation) });
  }
  if (req.method === 'POST' && req.url === '/dial') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid_json' }); }
      const agent = store.state.agents[body.agentId];
      if (!agent || agent.status !== 'active') return json(res, 409, { error: 'agent_not_active' });
      if (agent.currentLegId) return json(res, 409, { error: 'agent_busy', currentLegId: agent.currentLegId });
      const decision = dialDecision(agent.line, reputation);
      return json(res, decision.allowed ? 200 : 422, { to: body.to, ...decision });
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/webhooks') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!validSignature(raw, req.headers['x-signature'])) return json(res, 401, { error: 'bad_signature' });
      let ev;
      try { ev = JSON.parse(raw); } catch { return json(res, 400, { error: 'invalid_json' }); }
      if (!ev.event) return json(res, 400, { error: 'missing_event' });
      // Persistir + aplicar es síncrono y de microsegundos; en producción esto
      // encola y responde 200 antes de procesar. Si algo revienta, igual 200:
      // el evento ya está en el log y se reprocesa.
      let out;
      try { out = store.ingest(ev); } catch (err) { out = { accepted: true, applied: false, reason: `deferred:${err.message}` }; }
      return json(res, 200, out);
    });
    return;
  }
  json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`[boot] listening on http://localhost:${PORT}`));
