import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialState, reduce } from '../src/state.js';
import { EventStore } from '../src/store.js';

const run = (events, state = initialState()) => events.reduce((s, ev) => reduce(s, ev).state, state);

const agentUp = { seq: 1, ts: 't1', event: 'agent_leg.answered', call_control_id: 'A-1', from: '+15550000001' };
const c1Init = { seq: 2, ts: 't2', event: 'client_leg.initiated', call_control_id: 'C-1', client_id: 'L101', to: '+15551110001' };
const c1Ans = { seq: 3, ts: 't3', event: 'client_leg.answered', call_control_id: 'C-1' };
const c1Hang = { seq: 4, ts: 't4', event: 'client_leg.hangup', call_control_id: 'C-1' };

test('agente y cliente son identidades separadas; la línea sigue activa tras el hangup del cliente', () => {
  const s = run([agentUp, c1Init, c1Ans, c1Hang]);
  assert.equal(s.agents['A-1'].status, 'active');
  assert.equal(s.agents['A-1'].currentLegId, null);
  assert.equal(s.legs['C-1'].status, 'ended');
  assert.equal(s.legs['C-1'].clientId, 'L101');
  assert.equal(s.legs['C-1'].agentId, 'A-1');
});

test('duplicado semántico (mismo answered dos veces) no altera el estado', () => {
  const s1 = run([agentUp, c1Init, c1Ans]);
  const { state: s2, applied } = reduce(s1, { ...c1Ans, seq: 99, ts: 't3b' });
  assert.equal(applied, false);
  assert.equal(s2.legs['C-1'].history.length, s1.legs['C-1'].history.length);
});

test('fuera de orden: hangup antes de answered deja la pierna terminada', () => {
  const s = run([agentUp, c1Init, c1Hang, c1Ans]);
  assert.equal(s.legs['C-1'].status, 'ended');
  assert.equal(s.agents['A-1'].currentLegId, null);
});

test('fuera de orden: answered antes de initiated conserva el estado y luego rellena metadatos', () => {
  const s = run([agentUp, c1Ans, c1Init]);
  assert.equal(s.legs['C-1'].status, 'answered');
  assert.equal(s.legs['C-1'].clientId, 'L101');
  assert.equal(s.legs['C-1'].orphan, true);
});

test('sip.failure libera al agente', () => {
  const s = run([agentUp, c1Init, { seq: 5, ts: 't5', event: 'sip.failure', call_control_id: 'C-1', code: 603, message: 'Decline' }]);
  assert.equal(s.legs['C-1'].endReason, 'sip_603');
  assert.equal(s.agents['A-1'].currentLegId, null);
});

test('inbound durante outbound se encola; inbound con agente libre se ofrece', () => {
  const busy = run([agentUp, c1Init, c1Ans, { seq: 6, ts: 't6', event: 'inbound.ringing', call_control_id: 'I-1', from: '+15552220000' }]);
  assert.equal(busy.legs['I-1'].disposition, 'queued');
  assert.equal(busy.agents['A-1'].currentLegId, 'C-1');
  const free = run([agentUp, { seq: 6, ts: 't6', event: 'inbound.ringing', call_control_id: 'I-1', from: '+15552220000' }]);
  assert.equal(free.legs['I-1'].disposition, 'offered');
});

test('lookup ambiguo no asigna lead automáticamente', () => {
  const s = run([agentUp,
    { seq: 6, ts: 't6', event: 'inbound.ringing', call_control_id: 'I-1', from: '+15552220000' },
    { seq: 7, ts: 't7', event: 'lookup.result', phone: '+15552220000', matches: ['L201', 'L202'] }]);
  assert.equal(s.legs['I-1'].identity.status, 'ambiguous');
  assert.equal(s.legs['I-1'].identity.clientId, null);
  assert.deepEqual(s.legs['I-1'].identity.candidates, ['L201', 'L202']);
});

test('store: clave repetida se descarta y el estado se recupera tras reinicio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dialer-'));
  const a = new EventStore(dir, { snapshotEvery: 2 });
  for (const ev of [agentUp, c1Init, c1Ans]) a.ingest(ev);
  assert.equal(a.ingest(c1Ans).reason, 'duplicate_key');
  const before = JSON.stringify(a.state);
  const { store: b, report } = EventStore.open(dir, { snapshotEvery: 2 });
  assert.equal(report.fromSnapshot, true);
  assert.equal(report.replayed, 1); // solo el evento posterior al snapshot
  assert.equal(JSON.stringify(b.state), before);
  b.ingest(c1Hang);
  assert.equal(b.state.legs['C-1'].status, 'ended');
});

import { dialDecision, DAILY_LIMIT } from '../src/reputation.js';

const reputation = new Map([
  ['+15550000001', { calls24h: 86, complaints: 0, label: 'spam_likely' }],
  ['+15550000002', { calls24h: 22, complaints: 0, label: 'clean' }],
  ['+15550000003', { calls24h: 104, complaints: 0, label: 'spam_likely' }],
]);

test('guardia de reputación: no marcar desde línea quemada y sugerir la limpia', () => {
  const bad = dialDecision('+15550000001', reputation);
  assert.equal(bad.allowed, false);
  assert.equal(bad.reason, 'line_labeled_spam');
  assert.equal(bad.recommendedLine, '+15550000002');
  const ok = dialDecision('+15550000002', reputation);
  assert.equal(ok.allowed, true);
  const limit = dialDecision('+15550000009', new Map([['+15550000009', { calls24h: DAILY_LIMIT, complaints: 0, label: 'clean' }]]));
  assert.equal(limit.reason, 'daily_limit_reached');
  assert.equal(limit.recommendedLine, null);
});

test('una llamada que salió por línea quemada queda marcada en la pierna', () => {
  const s = [agentUp, c1Init].reduce((st, ev) => reduce(st, ev, { reputation }).state, initialState());
  assert.equal(s.legs['C-1'].reputationFlag.label, 'spam_likely');
  assert.equal(s.legs['C-1'].reputationFlag.recommendedLine, '+15550000002');
  assert.equal(s.counters.dialsFromBurnedLine, 1);
});
