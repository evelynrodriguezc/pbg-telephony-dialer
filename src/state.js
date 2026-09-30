/**
 * Reducer puro: (estado, evento) -> { state, applied, reason }
 *
 * Reglas:
 *  - Determinista y sin efectos secundarios: el mismo log de eventos siempre
 *    produce el mismo estado. Eso es lo que hace posible recuperar tras un reinicio.
 *  - Cada pierna (leg) tiene un rango de progreso. Un evento que intenta mover
 *    la pierna hacia atrás (p. ej. "answered" después de "hangup") se ignora.
 *    Eso absorbe duplicados semánticos y eventos fuera de orden.
 *  - Tres identidades separadas:
 *      agent   -> la línea del agente (call_control_id "A-*", número saliente)
 *      leg     -> una llamada concreta con un cliente (call_control_id "C-*" o "I-*")
 *      client  -> el prospecto (client_id / lead). Un lead no es un número:
 *                 varios leads pueden compartir teléfono.
 */

import { isBurned, recommendLine } from './reputation.js';

export const RANK = { initiated: 1, ringing: 1, answered: 2, ended: 3 };

export function initialState() {
  return {
    agents: {},   // por call_control_id de la pierna del agente
    legs: {},     // por call_control_id de la pierna del cliente (outbound e inbound)
    lastSeq: 0,
    counters: { applied: 0, ignored: 0, dialsFromBurnedLine: 0 },
  };
}

function clone(state) {
  return structuredClone(state);
}

function activeAgent(state) {
  return Object.values(state.agents).find((a) => a.status === 'active') ?? null;
}

function agentFreeFrom(agent, legId) {
  if (agent && agent.currentLegId === legId) agent.currentLegId = null;
}

function ensureLeg(state, id, patch) {
  if (!state.legs[id]) {
    state.legs[id] = { id, status: null, rank: 0, agentId: null, history: [] };
  }
  Object.assign(state.legs[id], patch);
  return state.legs[id];
}

/** Sube el estado de la pierna solo si el nuevo rango es mayor. */
function advance(leg, status, ev, extra = {}) {
  const rank = RANK[status];
  if (rank <= leg.rank) {
    return { applied: false, reason: `stale_or_duplicate:${leg.status}>=${status}` };
  }
  leg.status = status;
  leg.rank = rank;
  Object.assign(leg, extra);
  leg.history.push({ seq: ev.seq, ts: ev.ts, status });
  return { applied: true, reason: 'ok' };
}

/**
 * ctx.reputation (Map opcional): reputación de los números salientes. Se inyecta,
 * no se lee de disco aquí, para que el reducer siga siendo puro y reproducible.
 */
export function reduce(prev, ev, ctx = {}) {
  const state = clone(prev);
  let result = { applied: true, reason: 'ok' };

  switch (ev.event) {
    case 'agent_leg.answered': {
      const id = ev.call_control_id;
      if (state.agents[id]?.status === 'active') {
        result = { applied: false, reason: 'agent_already_active' };
        break;
      }
      state.agents[id] = {
        id,
        line: ev.from,
        status: 'active',
        currentLegId: null,
        legIds: [],
        answeredAt: ev.ts,
        warnings: [],
      };
      break;
    }

    case 'agent_leg.hangup': {
      const agent = state.agents[ev.call_control_id];
      if (!agent || agent.status === 'ended') {
        result = { applied: false, reason: 'agent_missing_or_ended' };
        break;
      }
      agent.status = 'ended';
      agent.endedAt = ev.ts;
      break;
    }

    case 'client_leg.initiated': {
      const agent = activeAgent(state);
      const leg = ensureLeg(state, ev.call_control_id, {
        direction: 'outbound',
        clientId: ev.client_id ?? null,
        to: ev.to ?? null,
        agentId: agent?.id ?? null,
      });
      result = advance(leg, 'initiated', ev);
      if (agent && !agent.legIds.includes(leg.id)) agent.legIds.push(leg.id);
      if (agent && result.applied && leg.rank < RANK.ended) agent.currentLegId = leg.id;
      // Guardia de reputación: si esta llamada salió por una línea ya quemada,
      // queda marcada para que el dashboard y el dialer dejen de usar esa línea.
      const rep = agent && ctx.reputation?.get(agent.line);
      if (result.applied && rep && isBurned(rep)) {
        leg.reputationFlag = { line: agent.line, ...rep, recommendedLine: recommendLine(ctx.reputation, agent.line) };
        state.counters.dialsFromBurnedLine += 1;
      }
      // Si "initiated" llega tarde (pierna ya answered/ended) igual rellenó metadatos.
      if (!result.applied) result.reason = 'late_initiated_metadata_merged';
      break;
    }

    case 'client_leg.answered': {
      const leg = ensureLeg(state, ev.call_control_id, {});
      if (leg.rank === 0) leg.orphan = true; // answered antes de initiated
      result = advance(leg, 'answered', ev, { answeredAt: ev.ts });
      break;
    }

    case 'client_leg.hangup':
    case 'sip.failure': {
      const leg = ensureLeg(state, ev.call_control_id, {});
      const endReason = ev.event === 'sip.failure' ? `sip_${ev.code}` : 'hangup';
      result = advance(leg, 'ended', ev, { endedAt: ev.ts, endReason, sipMessage: ev.message });
      if (result.applied) agentFreeFrom(state.agents[leg.agentId] ?? activeAgent(state), leg.id);
      break;
    }

    case 'inbound.ringing': {
      const agent = activeAgent(state);
      const busy = Boolean(agent?.currentLegId);
      const leg = ensureLeg(state, ev.call_control_id, {
        direction: 'inbound',
        from: ev.from,
        agentId: agent?.id ?? null,
        // Decisión: si el agente está en otra llamada, la inbound se encola,
        // no se le pisa la conversación en curso.
        disposition: !agent ? 'no_agent' : busy ? 'queued' : 'offered',
        identity: { status: 'pending', candidates: [] },
      });
      result = advance(leg, 'ringing', ev);
      if (agent && !agent.legIds.includes(leg.id)) agent.legIds.push(leg.id);
      break;
    }

    case 'lookup.result': {
      const targets = Object.values(state.legs).filter(
        (l) => l.direction === 'inbound' && l.from === ev.phone && l.identity?.status === 'pending',
      );
      if (targets.length === 0) {
        result = { applied: false, reason: 'no_pending_inbound_for_phone' };
        break;
      }
      const matches = ev.matches ?? [];
      const status = matches.length === 0 ? 'unknown' : matches.length === 1 ? 'resolved' : 'ambiguous';
      for (const leg of targets) {
        // Nunca se asigna un lead automáticamente si hay más de un candidato:
        // el número no es la identidad del cliente.
        leg.identity = { status, candidates: matches, clientId: status === 'resolved' ? matches[0] : null };
      }
      break;
    }

    case 'process.restart': {
      // Marcador informativo; la recuperación la hace el store al arrancar.
      result = { applied: false, reason: 'marker_only' };
      break;
    }

    default:
      result = { applied: false, reason: `unknown_event:${ev.event}` };
  }

  if (typeof ev.seq === 'number' && ev.seq > state.lastSeq) state.lastSeq = ev.seq;
  state.counters[result.applied ? 'applied' : 'ignored'] += 1;
  return { state, ...result };
}
