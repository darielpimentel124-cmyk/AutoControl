# AutoControl Pro — Guía de despliegue e instalación

App web progresiva (PWA) para controlar el odómetro y el mantenimiento de hasta 10 vehículos. Funciona sin conexión y guarda todo automáticamente en el dispositivo (IndexedDB, con copia de respaldo en localStorage).

## Archivos

```
autocontrol-pro/
├── index.html              ← estructura y barra inferior de 4 pestañas
├── styles.css              ← diseño (tipografía grande, botones amplios)
├── app.js                  ← lógica, guardado automático, validación
├── manifest.json           ← "display": "standalone", nombre, colores, iconos
├── service-worker.js       ← caché sin conexión y carga rápida
└── icons/
    ├── icon.svg
    ├── icon-192.png
    ├── icon-512.png
    ├── icon-maskable-512.png   (Android, icono adaptable)
    └── apple-touch-icon.png    (iPhone, 180×180)
```

Sube **la carpeta completa** tal cual. Todas las rutas son relativas, así que funciona en la raíz de un dominio o en una subcarpeta (por ejemplo, `usuario.github.io/autocontrol-pro/`).

> ⚠️ Una PWA necesita **HTTPS** para instalarse y trabajar sin conexión. Si abres `index.html` con doble clic (`file://`), la app funciona, pero no se instala ni guarda la caché sin conexión.

---

## Opción 1 · Netlify Drop (la más rápida, unos 2 minutos)

1. Entra en **https://app.netlify.com/drop** (crea una cuenta gratuita si te la pide).
2. Arrastra la carpeta `autocontrol-pro` completa a la página.
3. Netlify te da una dirección HTTPS, por ejemplo `https://nombre-aleatorio.netlify.app`.
4. Opcional: en *Site configuration → Change site name* puedes ponerle un nombre más fácil.

Para actualizar: en tu sitio, ve a *Deploys* y arrastra de nuevo la carpeta.

## Opción 2 · GitHub Pages

1. Crea una cuenta en **https://github.com** y pulsa **New repository**. Ponle, por ejemplo, `autocontrol-pro`, márcalo como **Public** y créalo.
2. Pulsa **uploading an existing file** y arrastra **el contenido** de la carpeta (incluida la carpeta `icons`). Pulsa **Commit changes**.
3. Ve a **Settings → Pages**. En *Source* elige **Deploy from a branch**, rama **main**, carpeta **/ (root)**, y pulsa **Save**.
4. En uno o dos minutos la app estará en `https://TU-USUARIO.github.io/autocontrol-pro/`.

## Opción 3 · Vercel

1. Entra en **https://vercel.com** con tu cuenta de GitHub.
2. **Add New → Project**, importa el repositorio del paso anterior.
3. En *Framework Preset* elige **Other**, deja vacío el comando de compilación (*Build*) y pulsa **Deploy**.

---

## Instalar en el teléfono

### Android (Chrome)
1. Abre la dirección HTTPS en **Chrome**.
2. Toca el menú **⋮** y luego **Instalar app** (o **Añadir a pantalla de inicio**). También puedes usar el botón **Instalar AutoControl Pro** de la pestaña **Avisos**.
3. La app aparece en tu cajón de apps y se abre a pantalla completa, sin barra del navegador.

### iPhone / iPad (Safari)
1. Abre la dirección en **Safari**.
2. Toca **Compartir** (el cuadro con una flecha hacia arriba ⬆️).
3. Desliza y toca **Añadir a pantalla de inicio**, y luego **Añadir**.
4. Ábrela siempre desde el icono de la pantalla de inicio.

> En iPhone, los avisos del sistema requieren **iOS 16.4 o posterior** y tener la app **instalada en la pantalla de inicio**. iOS puede borrar los datos de sitios web que **no** están instalados si pasan semanas sin usarse. Instalada en la pantalla de inicio, la app no tiene ese problema, aun así conviene exportar respaldos de vez en cuando.

---

## Cómo funciona

| Pestaña | Qué hace |
|---|---|
| **Odómetro** | Elige el vehículo (solo se ven los que has creado y el botón "+ Añadir vehículo", hasta 10/10). Muestra las millas en grande, con botones +100 / +500 / +1,000 y la opción de deshacer. Toca el número para escribir la lectura exacta. Incluye el estado general: Al día, Próximo o Vencido. |
| **Servicios** | Trae 9 servicios predeterminados y te deja crear los tuyos. El estado se calcula por millas **o** por tiempo, lo que ocurra primero. "Próximo" significa que falta un 10 % del intervalo (mínimo 500 mi) o menos de 30 días. Con **✓ Registrar** guardas un mantenimiento hecho. Con **👁️** ves y editas el producto, el número de parte, la tienda, el precio, la garantía, el recibo (foto o PDF), el historial y los intervalos, y puedes restaurar los de fábrica. |
| **Vehículo** | Año, Marca, Modelo, Motor y VIN, con validación de 17 caracteres y el botón **Copiar VIN**. Tiene un interruptor de notificaciones por vehículo, y botones para **restaurar solo los intervalos** o **restaurar el vehículo de fábrica** (borra registros y recibos, pero conserva los datos del auto y el odómetro). |
| **Avisos y Copia** | Recordatorio mensual que nombra el año, la marca y el modelo de cada vehículo con avisos activados que aún no tiene el odómetro actualizado este mes. Permite descargar un evento de calendario **.ics** que se repite cada mes y **exportar o importar un respaldo JSON**. |

### Guardado y seguridad
- Cada cambio se guarda solo, unos 0.3 segundos después. Verás un ✓ verde arriba.
- Al importar un respaldo, la app revisa todo el archivo: que sea un JSON válido, que venga de AutoControl Pro, que no tenga más de 10 vehículos y que cada número, fecha y texto sea válido. Los recibos tienen que ser imágenes o PDF auténticos. Si algo falla, **no cambia nada** y te explica por qué.
- Los datos del usuario se muestran siempre como texto plano. Además, una Política de Seguridad de Contenido (CSP) bloquea cualquier script externo.
- Las fotos de los recibos se comprimen (máx. 1600 px). Los PDF pueden pesar hasta 6 MB.

### Sobre los recordatorios
Una PWA no puede lanzar avisos programados con la app cerrada si no tiene un servidor propio. Por eso hay dos vías:
1. **Calendario (.ics):** es la más fiable. El calendario te avisa cada mes aunque no abras la app. Si añades vehículos, vuelve a descargarlo.
2. **Aviso del dispositivo:** si das permiso, la app muestra un aviso **al abrirla** a partir del día que elijas, una vez al mes. También verás un contador en la pestaña **Avisos**.

---

## Publicar una actualización
1. Edita los archivos.
2. En `service-worker.js`, cambia `CACHE_VERSION` (por ejemplo, de `autocontrol-v1.0.0` a `autocontrol-v1.0.1`).
3. Sube los archivos de nuevo. Los teléfonos cargarán la nueva versión la próxima vez que se abra la app (a veces hace falta cerrarla y abrirla dos veces).

Los datos del usuario **no se pierden** al actualizar, porque están en el dispositivo y no en la caché.
