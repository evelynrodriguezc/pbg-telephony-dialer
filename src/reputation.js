import fs from 'node:fs';

/** Límite diario por número. Por encima, las operadoras empiezan a etiquetar. */
export const DAILY_LIMIT = 50;

/** Lee number_reputation.csv -> Map(number -> { calls24h, complaints, label }) */
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

/** Una línea está "quemada" si la operadora ya la etiquetó o si pasó el límite diario. */
export function isBurned(rep) {
  if (!rep) return false;
  return rep.label === 'spam_likely' || rep.calls24h >= DAILY_LIMIT || rep.complaints > 0;
}

/** Línea limpia con menos volumen hoy. Null si no hay ninguna. */
export function recommendLine(reputation, exclude = null) {
  let best = null;
  for (const [number, rep] of reputation) {
    if (number === exclude || isBurned(rep)) continue;
    if (!best || rep.calls24h < best.rep.calls24h) best = { number, rep };
  }
  return best?.number ?? null;
}

/**
 * Decisión ANTES de marcar. Aquí es donde se evita el problema, no después.
 *  - allowed=false si la línea está quemada; se sugiere otra línea limpia.
 *  - Si no hay línea limpia, no se marca: seguir quemando el pool empeora todo.
 */
export function dialDecision(line, reputation) {
  const rep = reputation.get(line) ?? null;
  if (!isBurned(rep)) return { allowed: true, line, reason: 'ok', reputation: rep };
  const recommended = recommendLine(reputation, line);
  return {
    allowed: false,
    line,
    reason: rep.label === 'spam_likely' ? 'line_labeled_spam' : 'daily_limit_reached',
    reputation: rep,
    recommendedLine: recommended,
    advice: recommended
      ? `marcar desde ${recommended} y dejar descansar ${line}`
      : 'no hay línea limpia disponible; pausar marcación y registrar números (Free Caller Registry, STIR/SHAKEN A)',
  };
}

/** Advertencias para las líneas de agente activas (se muestran en GET /state). */
export function lineWarnings(state, reputation) {
  const out = [];
  for (const agent of Object.values(state.agents)) {
    const rep = reputation.get(agent.line);
    if (!isBurned(rep)) continue;
    out.push({ agentId: agent.id, line: agent.line, ...rep, recommendedLine: recommendLine(reputation, agent.line),
      advice: 'bajar volumen por línea, registrar en Free Caller Registry, pedir atestación STIR/SHAKEN A, no rotar números en masa' });
  }
  return out;
}
