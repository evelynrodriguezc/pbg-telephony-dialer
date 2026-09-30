import fs from 'node:fs';

/** Lee number_reputation.csv -> Map(number -> { calls_24h, complaints, label }) */
export function loadReputation(csvPath) {
  const map = new Map();
  if (!fs.existsSync(csvPath)) return map;
  const [header, ...rows] = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
  const cols = header.split(',');
  for (const row of rows) {
    const values = row.split(',');
    const rec = Object.fromEntries(cols.map((c, i) => [c, values[i]]));
    map.set(rec.number, { calls24h: Number(rec.calls_24h), complaints: Number(rec.complaints), label: rec.label_observed });
  }
  return map;
}

/** Devuelve advertencias para las líneas de agente activas. */
export function lineWarnings(state, reputation) {
  const out = [];
  for (const agent of Object.values(state.agents)) {
    const rep = reputation.get(agent.line);
    if (!rep) continue;
    if (rep.label === 'spam_likely' || rep.calls24h > 60) {
      out.push({ agentId: agent.id, line: agent.line, ...rep, advice: 'rotar a una línea limpia y bajar volumen diario; registrar en Free Caller Registry' });
    }
  }
  return out;
}
