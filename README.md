# Telephony Dialer: estado, idempotencia y recuperación

Reto de Ingeniería PBG (60 minutos). Construí la pieza que considero más crítica de un dialer: **el núcleo que recibe webhooks de telefonía y mantiene un estado correcto** aunque los eventos lleguen duplicados, fuera de orden, o el proceso se reinicie. Sin esto, cualquier UI o marcador encima muestra datos falsos.

No es un dialer completo. No hay UI, ni integración real con un proveedor (Twilio/Telnyx), ni cola externa.

## Qué hay

| Archivo | Rol |
|---|---|
| `src/state.js` | Reducer puro: `(estado, evento) -> estado`. Aquí vive el modelo y las reglas. |
| `src/store.js` | Log write-ahead (`events.jsonl`) + dedupe por clave + snapshot + recuperación al arrancar. |
| `src/server.js` | HTTP sin dependencias: `POST /webhooks`, `GET /state`, `GET /health`. Firma HMAC opcional. |
| `src/reputation.js` | Cruza la línea del agente con `number_reputation.csv` y avisa si está marcada como spam. |
| `scripts/replay.js` | Alimenta `data/webhooks.jsonl` tal cual llega, simula el reinicio y reenvía todo el feed. |
| `test/state.test.js` | 8 pruebas: identidades, duplicados, desorden, fallo SIP, inbound durante outbound, lookup ambiguo, recuperación. |

## Correr

```bash
npm test          # 8 pruebas con node:test, sin dependencias
npm run replay    # procesa el feed del paquete y muestra el estado final
npm start         # servidor en :3000 (PORT, DATA_DIR, WEBHOOK_SECRET opcionales)
```

Ejemplo contra el servidor:

```bash
curl -X POST localhost:3000/webhooks -H 'content-type: application/json' \
  -d '{"seq":1,"ts":"13:00:00.100Z","event":"agent_leg.answered","call_control_id":"A-1","from":"+15550000001"}'
curl localhost:3000/state
```

Si matas el proceso y lo vuelves a levantar con el mismo `DATA_DIR`, el estado vuelve igual (se ve en el log de arranque: `[boot] recovered {...}`).

## Modelo de estado

Tres identidades separadas, nunca mezcladas:

- **Agente** (`agents[A-*]`): la línea del agente. Tiene su número saliente (`line`), estado `active/ended`, la pierna con la que está hablando ahora (`currentLegId`) y el historial de piernas. Sigue `active` aunque los clientes cuelguen.
- **Pierna** (`legs[C-*]` o `legs[I-*]`): una llamada concreta, outbound o inbound. Tiene `status` y un `rank` numérico (`initiated/ringing=1, answered=2, ended=3`), más `agentId` y `clientId`.
- **Cliente** (`clientId`): el lead. Un lead **no es un número**. En el paquete, L201 y L202 comparten teléfono, así que una inbound desde ese número queda con `identity.status = "ambiguous"` y candidatos, sin asignar lead. Lo decide el agente o una regla de negocio, no el sistema a ciegas.

## Cómo se resuelve cada problema del enunciado

**Duplicados.** Dos capas. (1) Clave de idempotencia por evento: id del proveedor si lo trae, si no `seq`, si no una huella de contenido. Si se vio, se descarta antes de tocar nada. (2) El reducer es monótono: un `answered` sobre una pierna ya `answered` no hace nada. Esto atrapa el duplicado semántico del feed (seq 3 llega con otro id pero es el mismo `answered` que seq 4).

**Fuera de orden.** El `rank` solo sube. `hangup` antes de `answered` deja la pierna en `ended` y el `answered` tardío se ignora. `answered` antes de `initiated` crea la pierna como `orphan` y el `initiated` tardío rellena metadatos (cliente, número) sin bajar el estado. No dependo de que el proveedor ordene nada.

**Reinicio.** Cada evento se escribe en `events.jsonl` **antes** de procesarse (write-ahead). Cada N eventos se guarda `snapshot.json` de forma atómica (tmp + rename). Al arrancar: cargar snapshot, re-aplicar del log solo lo posterior. Como el reducer es determinista, el estado queda idéntico. En el replay, `process.restart` con `snapshot_age_seconds: 1.7` termina en `recovered fromSnapshot=true replayed=2 stateIdentical=true`.

**Inbound durante outbound.** Si la línea del agente tiene `currentLegId`, la inbound queda `disposition: "queued"`; si está libre, `"offered"`. No se pisa la conversación en curso. En el feed, I-201 entra justo después de que C-102 falló con SIP 603, así que el agente estaba libre y se ofrece.

**Fallo SIP.** `sip.failure` cierra la pierna con `endReason: "sip_603"` y libera al agente igual que un hangup.

**Reputación del número.** La línea del agente (+15550000001) aparece como `spam_likely` con 86 llamadas en 24h. `GET /state` devuelve `warnings` con esa alerta. No roto números automáticamente: el "number cycling" empeora la reputación del pool; lo correcto es bajar volumen, registrar el número (Free Caller Registry, STIR/SHAKEN atestación A) y rotar con criterio.

## Supuestos

- Una sola línea de agente activa a la vez en la demo. Los eventos del paquete no traen a qué agente pertenece cada pierna; en producción eso viene en `client_state` (Telnyx) o en un mapeo propio por `CallSid` (Twilio).
- `seq` hace de id de evento. Los proveedores reales dan un id; el store lo usa si existe.
- El log es un archivo JSONL. Es el mismo patrón que con Postgres (tabla `events` con índice único por clave) o Redis `SETNX`, solo que sin infraestructura para 60 minutos.
- El set de claves vistas crece sin límite. En producción: TTL o índice único en base de datos.

## Qué podría romperse mañana en producción

- Concurrencia: con dos instancias del servidor el archivo y el `Set` en memoria dejan de ser una fuente única. Hace falta base de datos con índice único por clave de idempotencia y un lock por `call_control_id`.
- Sin firma configurada acepta cualquier POST. En producción `WEBHOOK_SECRET` es obligatorio.
- No hay detección de silencio: una pierna `answered` sin `hangup` durante 4 horas debería reconciliarse consultando la API del proveedor.
- El snapshot guarda todas las claves vistas; a millones de eventos hay que podar.

## Con una semana más

1. Postgres + tabla `events` (clave única) + `outbox`, y una cola (SQS o BullMQ) para responder 200 y procesar aparte.
2. Reconciliación periódica contra la API del proveedor para piernas colgadas y eventos que nunca llegaron.
3. Enrutamiento real de inbound: cola por agente, timeout, voicemail, y UI para resolver identidades ambiguas.
4. Múltiples agentes y afinidad pierna-agente explícita.
5. Métricas: eventos ignorados por razón, latencia de webhook, piernas huérfanas.

## Uso de IA

Construido con Claude Code. Yo decidí el alcance (núcleo de estado antes que UI), revisé cada regla del reducer y las pruebas cubren los casos del paquete.
