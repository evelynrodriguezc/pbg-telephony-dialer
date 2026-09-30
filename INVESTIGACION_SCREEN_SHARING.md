# Reto de investigación: ver la pantalla del cliente desde un enlace, sin app

## Respuesta corta

Exactamente lo pedido (un enlace que el cliente abre en su teléfono y desde ahí vemos toda su pantalla mientras navega otras apps) **solo es posible en desktop**. En iPhone y Android no lo permite ningún navegador, y no es un tema de implementación sino de plataforma: la captura de pantalla del sistema está reservada a apps instaladas. Lo que sí se puede hacer en móvil sin app es ver y guiar al cliente **dentro de nuestro propio sitio** (co-browsing), y para todo lo demás, usar una app que el cliente ya tiene instalada (WhatsApp).

## 1. Qué es técnicamente posible

| Plataforma | Ver toda la pantalla desde un enlace web | Ver al cliente dentro de nuestro sitio | Ver toda la pantalla de alguna forma |
|---|---|---|---|
| Desktop (Chrome, Edge, Firefox, Safari en Mac) | Sí. API `getDisplayMedia` + WebRTC. El navegador pide permiso y el usuario elige pantalla completa, ventana o pestaña. | Sí | Sí, con el mismo enlace |
| Android (Chrome, Samsung Internet, Firefox) | No. `getDisplayMedia` no existe en ningún navegador Android. | Sí, con co-browsing (JS en nuestra página) | Solo con una app nativa (API MediaProjection), o con una app que el cliente ya tenga, como WhatsApp |
| iPhone (Safari y cualquier navegador iOS, todos usan WebKit) | No. WebKit en iOS no implementa `getDisplayMedia`. | Sí, con co-browsing | Solo con una app nativa (ReplayKit + Broadcast Extension), o con WhatsApp o FaceTime |

## 2. Qué no es posible y por qué

**En móvil, un sitio web no puede capturar la pantalla del sistema.** La única API web para esto es `getDisplayMedia`, y en caniuse aparece sin soporte en Safari iOS (ninguna versión), Chrome Android, Samsung Internet y Firefox Android. Es una decisión de privacidad de Apple y Google, no un pendiente técnico: una página web que pueda ver otras apps (banco, mensajes) es un riesgo enorme.

**Para capturar todo el teléfono hace falta una app instalada:**
- En Android, la API es MediaProjection. Desde Android 10 exige un servicio en primer plano declarado en el manifiesto de una app, y desde Android 14 un permiso específico. El usuario debe aceptar en cada sesión.
- En iOS, la API es ReplayKit. Para ver fuera de la propia app (pantalla de inicio, otras apps) se necesita un Broadcast Upload Extension, que es un componente de una app instalada desde la App Store.

Los proveedores de co-browsing lo confirman en su documentación: Cobrowse.io dice literal que compartir el dispositivo completo "no está disponible en navegadores móviles como Chrome móvil y Safari móvil por limitaciones del navegador" y remite a sus SDK nativos.

**Una PWA (web instalable) tampoco lo resuelve.** Sigue corriendo dentro del motor del navegador y con sus mismas APIs.

## 3. Diferencias entre plataformas, en una línea cada una

- **Desktop:** todo funciona con un enlace. El cliente elige qué compartir y ve un aviso permanente mientras comparte.
- **Android:** sin app, solo co-browsing en nuestro sitio. Con app, MediaProjection permite compartir pantalla completa o una sola app (Android 14+).
- **iPhone:** igual que Android sin app. Con app, ReplayKit. Además, iOS tiene FaceTime con "Compartir mi pantalla", pero exige que ambos usen FaceTime.
- **Común a ambos móviles:** WhatsApp permite compartir pantalla en videollamada, en iPhone y Android, cifrado de extremo a extremo y sin instalar nada nuevo si el cliente ya lo tiene.

## 4. Lo que construiría para acercarnos lo máximo posible

Un solo enlace que detecta la plataforma y ofrece el mejor camino disponible:

**Nivel 1, desktop: pantalla completa por web.** Enlace → `getDisplayMedia` → WebRTC al navegador del agente. Cumple exactamente lo pedido. Se puede montar con un servidor de señalización propio o con un proveedor (Twilio Video, LiveKit, Daily).

**Nivel 2, móvil dentro de nuestro sitio: co-browsing.** Un snippet de JavaScript en nuestras páginas (el enlace seguro donde el cliente sube documentos, el formulario de solicitud) sincroniza el DOM con el agente en tiempo real. El agente ve lo que el cliente ve, puede señalar y resaltar campos, y con permiso puede rellenar por él. No hay permiso de pantalla porque no se captura pantalla, se replica la página. Funciona en Safari iOS y Chrome Android. Permite enmascarar campos sensibles (SSN, tarjeta) para que el agente no los vea. Se puede construir (rrweb es una librería abierta para esto) o comprar (Cobrowse.io, Surfly, Zoom Cobrowse SDK). Esto cubre el caso de uso principal de PBG: el cliente se traba subiendo documentos o llenando la solicitud, y el agente lo guía.

**Nivel 3, móvil fuera de nuestro sitio: una app que el cliente ya tiene.** Si el cliente necesita ayuda en otra app (su correo, el portal de la aseguradora, la galería para encontrar una foto), el enlace muestra un botón "te llamo por WhatsApp" que abre `wa.me` con el número del agente. En la videollamada, el cliente toca "Compartir pantalla" y el agente ve todo el teléfono. Para nuestro público (agentes de seguros hispanos y sus clientes) WhatsApp es prácticamente universal, así que en la práctica no se instala nada. En iPhone, FaceTime es alternativa si el agente también tiene iPhone.

**Nivel 4, siempre disponible: el agente comparte su pantalla.** Al revés de lo pedido, pero funciona en cualquier teléfono sin permiso: el agente comparte su pantalla desde desktop y el cliente la ve en su navegador móvil como video. Sirve para "mira, este botón, aquí". Es el fallback cuando nada más aplica.

**Reglas transversales:** consentimiento explícito con texto claro antes de iniciar, indicador visible de "el agente está viendo", enmascarado de datos sensibles, nunca grabar sin aviso, y botón de detener siempre a la vista. Esto importa doble porque manejamos SSN y datos de salud.

**Si en el futuro PBG tiene app propia**, se agrega el SDK nativo (ReplayKit en iOS, MediaProjection en Android) y ahí sí se comparte el teléfono completo desde nuestra propia app.

## Fuentes

- caniuse, soporte de `getDisplayMedia` por navegador: https://caniuse.com/mdn-api_mediadevices_getdisplaymedia
- MDN, `MediaDevices.getDisplayMedia()`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- WebKit, Safari 16.1 (captura de ventana en macOS, no en iOS): https://webkit.org/blog/13399/webkit-features-in-safari-16-1/
- Android Developers, Media projection (servicio en primer plano, consentimiento por sesión): https://developer.android.com/media/grow/media-projection
- Android Developers, App screen sharing en Android 14: https://developer.android.com/about/versions/14/features/app-screen-sharing
- Apple / LiveKit, ReplayKit y Broadcast Upload Extension para captura del sistema en iOS: https://github.com/livekit/client-sdk-swift/blob/main/Docs/ios-screen-sharing.md
- Cobrowse.io, "Full device screen sharing" no disponible en navegadores móviles: https://docs.cobrowse.io/sdk-features/full-device-capabilities/full-device-screen-sharing
- WhatsApp, cómo compartir pantalla: https://faq.whatsapp.com/1339237313658883
- Apple Support, compartir pantalla en FaceTime en iPhone: https://support.apple.com/guide/iphone/share-your-screen-in-a-facetime-call-iph327b4b53c/ios
- rrweb, librería abierta de grabación y replay de DOM: https://github.com/rrweb-io/rrweb
