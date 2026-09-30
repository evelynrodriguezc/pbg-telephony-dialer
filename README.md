# Telephony Dialer

Control de estado para telefonía de agentes: una línea del agente se mantiene activa mientras distintos clientes entran y salen, y nada se pierde aunque los eventos lleguen repetidos, fuera de orden, o el proceso se reinicie.

## El problema

Un sistema de llamadas recibe eventos (webhooks) del proveedor de telefonía: el agente contestó, salió una llamada, el cliente contestó, colgó, entró una llamada. Esos eventos llegan por internet y no son confiables: pueden llegar dos veces, en otro orden, o mientras el servidor está caído. Si el sistema se guía por ellos tal cual llegan, termina mostrando llamadas que ya terminaron como activas, agentes ocupados que están libres, y clientes asignados a la persona equivocada.

## La solución

Un núcleo pequeño que hace cuatro cosas:

1. **Separa identidades.** La línea del agente, cada llamada con un cliente, y el cliente como persona son tres cosas distintas. La línea sigue activa aunque los clientes cuelguen. Un cliente no es un número de teléfono: si dos leads comparten número, el sistema no adivina, marca la identidad como ambigua y deja que el agente decida.
2. **Ignora lo que no avanza.** El estado de una llamada solo puede ir hacia adelante: iniciada, contestada, terminada. Un evento repetido o uno que llega tarde intentando retroceder se ignora. Esa sola regla resuelve duplicados y desorden.
3. **Guarda antes de procesar.** Cada evento se escribe en disco antes de tocar el estado, con una clave única para descartar repetidos. Al arrancar, el servidor relee el registro y queda exactamente como estaba antes de caerse.
4. **Cuida la reputación del número.** Antes de marcar, revisa si la línea del agente está marcada como spam o pasó el límite diario. Si es así, no marca y sugiere otra línea limpia.

## Qué hay

| Archivo | Rol |
|---|---|
| `src/state.js` | Las reglas: `(estado, evento) -> estado`. Función pura, sin efectos secundarios. |
| `src/store.js` | Registro en disco, descarte de repetidos, snapshot y recuperación al arrancar. |
| `src/server.js` | HTTP sin dependencias: `POST /webhooks`, `POST /dial`, `GET /state`, `GET /health`, `GET /` (vista). Firma HMAC opcional. |
| `src/ui.html` | Vista en vivo: línea del agente arriba, llamadas entrando y saliendo abajo, alertas. |
| `src/reputation.js` | Decide si se puede marcar desde una línea y sugiere una limpia. |
| `scripts/feed.js` | Manda el feed de ejemplo al servidor, evento por evento, con Enter. |
| `scripts/replay.js` | Procesa el feed completo de una vez, simula el reinicio y muestra el estado final. |
| `test/state.test.js` | 10 pruebas: identidades, duplicados, desorden, fallo SIP, inbound durante outbound, lookup ambiguo, recuperación, reputación. |
| `data/` | Datos sintéticos de ejemplo: leads, eventos, reputación de números. |

## Correr

```bash
npm test          # 10 pruebas, sin dependencias (Node 20+)
npm run replay    # procesa el feed de ejemplo y muestra el estado final
npm run fresh     # servidor en :3000 empezando vacío
npm run feed      # en otra terminal: manda el feed, un evento por Enter
```

Abre http://localhost:3000 para ver el estado en vivo. Cuando el feed llegue al reinicio, mata el servidor y vuelve a correr `npm start`: el estado vuelve igual.

Variables opcionales: `PORT`, `DATA_DIR`, `WEBHOOK_SECRET` (si se define, `x-signature` debe ser HMAC-SHA256 del cuerpo).

## Modelo de estado

- **Agente** (`agents[A-*]`): la línea del agente. Número saliente, estado `active/ended`, con quién habla ahora (`currentLegId`) y el historial de llamadas.
- **Llamada** (`legs[C-*]` o `legs[I-*]`): una llamada concreta, outbound o inbound. Tiene `status` y un `rank` (`initiated/ringing=1, answered=2, ended=3`) que solo sube.
- **Cliente** (`clientId`): el lead. Nunca se asigna automáticamente cuando hay más de un candidato para un número.

En telefonía cada tramo de una llamada se llama *leg*; en el código se usa ese nombre.

## Cómo se comporta con el feed de ejemplo

`data/webhooks.jsonl` trae los casos difíciles a propósito:

- El evento 4 llega antes que el 3, y el 3 es un repetido: se ignora.
- Reinicio con snapshot viejo: se recupera desde disco y el estado queda idéntico.
- Fallo SIP 603: la llamada se cierra y el agente queda libre.
- Entra una llamada mientras la línea sigue activa: si el agente está ocupado se encola, si está libre se ofrece.
- El número entrante pertenece a dos leads: identidad ambigua, no se asigna.
- La línea del agente está marcada spam con 86 llamadas en 24h: alerta y línea recomendada.

## Herramientas

Node 24, sin dependencias. Desarrollado con apoyo de IA como asistente de programación; el alcance, las decisiones de diseño, la revisión y las pruebas son mías.
