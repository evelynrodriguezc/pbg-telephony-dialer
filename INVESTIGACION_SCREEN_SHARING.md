# Reto de investigación: ver la pantalla del cliente desde un enlace, sin app

**Respuesta corta.** Desde un enlace, sin instalar nada, ver toda la pantalla del cliente solo funciona en computador. En celular (iPhone y Android) no se puede, y no es por falta de desarrollo: Apple y Google no dejan que una página web vea lo que pasa en otras apps. Eso solo lo puede hacer una app instalada.

**Qué sí se puede.**
- En computador: el cliente abre el enlace, el navegador le pregunta si quiere compartir pantalla, acepta, y el agente ve todo. Esto es lo que piden y funciona hoy con tecnología estándar (WebRTC).
- En celular, dentro de nuestras propias páginas: sí podemos ver lo que el cliente ve y guiarlo, por ejemplo cuando está subiendo documentos o llenando la solicitud. Se logra con un pequeño código en nuestra página que le muestra al agente una copia en vivo de lo que el cliente tiene en pantalla. No pide permiso de pantalla porque no graba la pantalla, solo replica nuestra página. Funciona en iPhone y Android, y podemos tapar datos delicados como el seguro social.

**Qué no se puede.** En celular, ver otras apps o sitios que no son nuestros (su correo, su banco, la galería de fotos) desde un enlace. Ningún navegador de celular lo permite. Lo comprobé en la tabla de compatibilidad de caniuse y en la documentación de Apple y Android: la función existe solo para apps instaladas.

**Diferencia entre plataformas, en corto.**
- Computador: todo por el enlace.
- Android: por el enlace, solo dentro de nuestras páginas.
- iPhone: igual que Android. Además tiene FaceTime con compartir pantalla, pero los dos deben tener iPhone.

**Qué construiría.** Un solo enlace que detecta desde dónde lo abren y da la mejor opción:
1. Si es computador: compartir pantalla completa. Exactamente lo pedido.
2. Si es celular y el problema está en nuestra página: el agente ve una copia en vivo y le va señalando dónde tocar.
3. Si es celular y necesita ayuda en otra app: un botón "te llamo por WhatsApp". En la videollamada de WhatsApp el cliente puede compartir su pantalla completa, en iPhone y Android. Como casi todos nuestros clientes ya tienen WhatsApp, en la práctica no instalan nada.
4. Siempre disponible: el agente comparte su pantalla al cliente y le dice "mira, este botón". Funciona en cualquier celular.

En todos los casos el cliente debe aceptar de forma clara, ver un aviso mientras lo estamos viendo, y poder detenerlo con un botón.

**Fuentes.**
- Tabla de compatibilidad de compartir pantalla en navegadores (caniuse): https://caniuse.com/mdn-api_mediadevices_getdisplaymedia
- Documentación de la función en navegadores (MDN): https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- Android, captura de pantalla solo desde apps: https://developer.android.com/media/grow/media-projection
- iPhone, captura de pantalla solo desde apps (ReplayKit): https://github.com/livekit/client-sdk-swift/blob/main/Docs/ios-screen-sharing.md
- Cobrowse.io, confirma que en navegadores de celular no se puede ver el dispositivo completo: https://docs.cobrowse.io/sdk-features/full-device-capabilities/full-device-screen-sharing
- WhatsApp, cómo compartir pantalla: https://faq.whatsapp.com/1339237313658883
- Apple, compartir pantalla en FaceTime: https://support.apple.com/guide/iphone/share-your-screen-in-a-facetime-call-iph327b4b53c/ios
