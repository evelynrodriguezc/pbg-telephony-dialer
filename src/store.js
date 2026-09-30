/**
 * EventStore: log write-ahead en disco + reducer en memoria + snapshot.
 *
 *  ingest(ev):
 *    1. Clave de idempotencia (id del proveedor o seq). Si ya se vio -> descartada.
 *    2. Se escribe el evento crudo en events.jsonl ANTES de procesarlo.
 *       Si el proceso muere después de escribir, el replay lo aplica.
 *    3. Se aplica el reducer.
 *    4. Cada N eventos se guarda snapshot.json (estado + claves vistas + lastSeq).
 *
 *  open(dir):
 *    Carga el snapshot (si existe) y vuelve a aplicar del log sólo los eventos
 *    con seq posterior. Como el reducer es determinista, el estado queda idéntico
 *    al que había antes del reinicio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { initialState, reduce } from './state.js';

export function idempotencyKey(ev) {
  if (ev.id) return `id:${ev.id}`;
  if (ev.event_id) return `id:${ev.event_id}`;
  if (typeof ev.seq === 'number') return `seq:${ev.seq}`;
  // Sin id del proveedor: huella de contenido.
  return `hash:${ev.event}|${ev.call_control_id ?? ''}|${ev.ts ?? ''}`;
}

export class EventStore {
  constructor(dir, { snapshotEvery = 5, reputation = new Map() } = {}) {
    this.dir = dir;
    this.ctx = { reputation };
    this.logPath = path.join(dir, 'events.jsonl');
    this.snapshotPath = path.join(dir, 'snapshot.json');
    this.snapshotEvery = snapshotEvery;
    this.state = initialState();
    this.seen = new Set();
    this.sinceSnapshot = 0;
    fs.mkdirSync(dir, { recursive: true });
  }

  static open(dir, opts) {
    const store = new EventStore(dir, opts);
    const report = store.recover();
    return { store, report };
  }

  recover() {
    let fromSnapshot = false;
    if (fs.existsSync(this.snapshotPath)) {
      const snap = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
      this.state = snap.state;
      this.seen = new Set(snap.seen);
      fromSnapshot = true;
    }
    let replayed = 0;
    let skipped = 0;
    if (fs.existsSync(this.logPath)) {
      const lines = fs.readFileSync(this.logPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const { ev } = JSON.parse(line);
        const key = idempotencyKey(ev);
        if (this.seen.has(key)) { skipped += 1; continue; }
        this.seen.add(key);
        this.state = reduce(this.state, ev, this.ctx).state;
        replayed += 1;
      }
    }
    return { fromSnapshot, replayed, skipped, lastSeq: this.state.lastSeq };
  }

  ingest(ev) {
    const key = idempotencyKey(ev);
    if (this.seen.has(key)) {
      return { key, accepted: false, applied: false, reason: 'duplicate_key' };
    }
    // Write-ahead: persistir antes de mutar.
    fs.appendFileSync(this.logPath, JSON.stringify({ receivedAt: new Date().toISOString(), ev }) + '\n');
    this.seen.add(key);
    const { state, applied, reason } = reduce(this.state, ev, this.ctx);
    this.state = state;
    this.sinceSnapshot += 1;
    if (this.sinceSnapshot >= this.snapshotEvery) this.snapshot();
    return { key, accepted: true, applied, reason };
  }

  snapshot() {
    const tmp = this.snapshotPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ takenAt: new Date().toISOString(), state: this.state, seen: [...this.seen] }));
    fs.renameSync(tmp, this.snapshotPath); // escritura atómica
    this.sinceSnapshot = 0;
  }
}
