# Entreno — asistente de entrenamiento

App personal (Android, y en iPhone sin Mac: ver abajo) para entrenar con progresión automática de cargas, descansos cronometrados que suenan con el móvil bloqueado, recordatorio diario offline, perfil con cálculo de calorías/macros y plan de dieta. Todo se guarda en el móvil (SQLite).

**Estado:** el modo entrenamiento, las recomendaciones de peso, el recordatorio diario, el perfil y la vista de dieta funcionan; falta verificarlos en un móvil real y completar los editores (rutinas, dieta) y el backup. Detalle por fases en [PLAN.md](PLAN.md#13-hoja-de-ruta).

- Plan completo, decisiones y hoja de ruta: [PLAN.md](PLAN.md)
- Instrucciones para agentes: [AGENTS.md](AGENTS.md)
- Una instalación nueva solo trae el catálogo de ejercicios y alimentos ([data/seed/catalog.json](data/seed/catalog.json)); cada uno monta sus rutinas, cardio y dieta. Los datos del Excel original ([data/seed/seed.json](data/seed/seed.json)) son datos de prueba: los usan los tests y el botón «Cargar datos de prueba» de los builds de desarrollo.

Stack: Expo SDK 58 (React Native) + TypeScript · expo-router · expo-sqlite · expo-notifications.

## Desarrollo

Requisitos: Node 22, JDK 17 y el SDK de Android (`ANDROID_HOME`).

```bash
npm install
npm test               # lógica de dominio y base de datos
npm run typecheck
npm run lint
npx expo run:android   # build de desarrollo en el móvil o emulador conectado
```

## Instalar en el móvil

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
cd .. && python scripts/sign_release.py
```

`sign_release.py` firma con la clave propia y la prueba de rotación (ver AGENTS.md → Compilar y probar). El APK queda en `android/app/build/outputs/apk/release/app-release.apk`. Cópialo al móvil e instálalo (hay que permitir "instalar apps de origen desconocido"), o con el móvil conectado por USB: `adb install -r app-release.apk`.

Después, en la app: **Perfil → engranaje → Ajustes → Avisos y permisos**, quita la optimización de batería y comprueba que no queda nada en ámbar.

## En un iPhone (sin Mac y gratis)

GitHub compila la app de iPhone sin firmar ([.github/workflows/ios.yml](.github/workflows/ios.yml)) y [SideStore](https://docs.sidestore.io/) la firma en el propio iPhone con tu Apple ID normal. La firma dura 7 días y SideStore la renueva desde el móvil. Con un Apple ID gratuito caben 3 apps instaladas así, contando SideStore.

**La primera vez** (con el PC, una sola vez):

1. En Windows: [iTunes](https://www.apple.com/itunes/) de Apple (o «Apple Devices» de la Microsoft Store) e [iloader](https://github.com/nab138/iloader/releases) (el `.msi`).
2. En el iPhone: instala **LocalDevVPN** desde la App Store, ábrela y conéctala.
3. Conecta el iPhone por cable al PC y confía en el ordenador.
4. En iloader: entra con tu Apple ID, elige el iPhone y pulsa «Install SideStore (Stable)».
5. En el iPhone: Ajustes → General → VPN y gestión de dispositivos → tu Apple ID → Confiar («Permitir y reiniciar»); después Ajustes → Privacidad y seguridad → **Modo de desarrollador**, activado (se reinicia).
6. Con LocalDevVPN conectada, abre SideStore, entra con el mismo Apple ID y, en «My Apps», toca el contador «7 DAYS» de SideStore para renovarla.

**Si SideStore no te deja iniciar sesión** (errores «HTTP 401 … PTM/TK» o «ADI native error -45063»: desde el 20 de noviembre de 2026 Apple rechaza su inicio de sesión de siempre; incidencias [#1745](https://github.com/SideStore/SideStore/issues/1745) y [#1765](https://github.com/SideStore/SideStore/issues/1765)). Así entró el 24 de noviembre:

1. «Close» en la pantalla de inicio de sesión. Settings → User Customizations → desactiva **On-Device Anisette** y cierra SideStore del todo.
2. Settings → User Customizations → **Reset adi.pb**, sin «Keep headers» → Reset & Sign Out.
3. Settings → Anisette Servers → **`https://mac-ani.jkcoxson.com`**, con «Enable Auto Rotation» desactivado.
4. User Customizations → Anisette Client Configuration → Remote Server Sync → **Fetch** → **Save as Overrides**. En **Client Info** cambia la versión para que quede `<MacBookPro13,3> <Mac OS X;26.6;25F84> <com.apple.AuthKit/1 (com.apple.akd/1.0)>` (el User Agent, como venga) → **Save Overrides**. Nunca «Reset to Defaults» ahí.
5. Cierra SideStore del todo, conecta LocalDevVPN, ábrela e inicia sesión.

**Déjalo así:** el Modo de desarrollador activado (sin él no abren ni SideStore ni Entreno), LocalDevVPN conectada y la actualización en segundo plano de SideStore activada (Ajustes → General), para que renueve sola. No borres Entreno: se van sus datos del iPhone.

**Cada versión de Entreno:**

1. En GitHub: **Actions → iOS → Run workflow** (tarda unos 25 minutos).
2. En el iPhone, con Safari y la sesión de GitHub iniciada: abre esa ejecución, baja a «Artifacts» y descarga `Entreno-<versión>-ios`. Es un `.zip`: tócalo en Archivos y sale `Entreno-<versión>.ipa`. Se borra de GitHub a los 2 días.
3. En SideStore, con LocalDevVPN conectada: «My Apps» → «+» → elige el `.ipa`. Instalarlo encima de una versión anterior conserva los datos.

**Cada semana:** SideStore renueva solo en segundo plano si LocalDevVPN está conectada; si no, abre SideStore y toca el contador. Si se pasan los 7 días, Entreno no abre hasta renovar, pero no pierde nada.

**Tus datos:** en la app, siete toques en la versión del pie de Ajustes muestran la copia en GitHub; pon el repositorio y el token, y al guardar ofrece restaurar la copia («Ya hay una copia en GitHub»), con la contraseña de las copias.

**De momento, en iPhone no hay**: cuenta atrás en la pantalla de bloqueo, burbuja, pitido de salida ni GPS del chip en los sprints, ni parar un sprint con los botones de volumen. El fin del descanso es una notificación normal: con el iPhone en silencio, solo vibra. Durante una caminata no cierres la app deslizándola: iOS corta el GPS.
