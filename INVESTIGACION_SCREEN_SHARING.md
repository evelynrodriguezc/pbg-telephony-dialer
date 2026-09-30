# Reto de investigación: ver la pantalla del cliente desde un enlace, sin app

**Qué es posible.** Solo en desktop. Un enlace web puede pedir permiso y ver la pantalla completa con la API getDisplayMedia y WebRTC (Chrome, Edge, Firefox, Safari en Mac).

**Qué no es posible y por qué.** En iPhone y Android ningún navegador tiene getDisplayMedia (caniuse: sin soporte en Safari iOS, Chrome Android, Samsung Internet, Firefox Android). Capturar todo el teléfono requiere una app instalada: en Android la API MediaProjection con un servicio en primer plano, en iOS ReplayKit con un Broadcast Extension. Es una decisión de privacidad de Apple y Google, no un pendiente técnico. Una PWA tampoco sirve, corre dentro del mismo navegador.

**Diferencias.** Desktop: todo por web. Android e iPhone: sin app, solo se puede ver al cliente dentro de nuestro propio sitio. iPhone además tiene FaceTime con compartir pantalla, pero ambos deben usar FaceTime.

**Qué construiría.** Un solo enlace que detecta el dispositivo y ofrece lo mejor disponible:
1. Desktop: pantalla completa por web, exactamente lo pedido.
2. Móvil dentro de nuestro sitio: co-browsing. Un snippet de JavaScript replica la página del cliente al agente en tiempo real (rrweb o Cobrowse.io). No pide permiso de pantalla porque no captura pantalla. Funciona en Safari iOS y Chrome Android, y permite ocultar SSN y datos sensibles. Cubre el caso principal: guiar al cliente cuando se traba subiendo documentos o llenando la solicitud.
3. Móvil fuera de nuestro sitio: botón "te llamo por WhatsApp". En la videollamada el cliente comparte su pantalla completa, en iPhone y Android, cifrado de extremo a extremo. Para clientes hispanos WhatsApp ya está instalado, así que en la práctica no se instala nada.
4. Siempre: el agente comparte su pantalla al cliente ("mira, este botón"). Funciona en cualquier teléfono.

En todos los casos: consentimiento claro, indicador visible de que el agente está viendo, y botón de detener a la vista.

**Fuentes.**
- caniuse, getDisplayMedia: https://caniuse.com/mdn-api_mediadevices_getdisplaymedia
- MDN, getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- Android, Media projection: https://developer.android.com/media/grow/media-projection
- iOS, ReplayKit y Broadcast Extension: https://github.com/livekit/client-sdk-swift/blob/main/Docs/ios-screen-sharing.md
- Cobrowse.io, sin captura completa en navegadores móviles: https://docs.cobrowse.io/sdk-features/full-device-capabilities/full-device-screen-sharing
- WhatsApp, compartir pantalla: https://faq.whatsapp.com/1339237313658883
- Apple, compartir pantalla en FaceTime: https://support.apple.com/guide/iphone/share-your-screen-in-a-facetime-call-iph327b4b53c/ios
