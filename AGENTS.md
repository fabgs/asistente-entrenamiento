# Guía para agentes

1. **Lee [PLAN.md](PLAN.md) entero antes de tocar nada.** Es la fuente de verdad de requisitos, modelo de datos, reglas de progresión y hoja de ruta.
2. Trabaja **por fases** (PLAN.md §13), en orden. Al terminar una tarea, marca su casilla; al terminar una fase, añade una línea al registro de cambios (§17).
3. Si cambias una decisión del plan, actualiza PLAN.md en el mismo commit explicando el motivo.
4. **[ARCHITECTURE.md](ARCHITECTURE.md) describe lo que hace el código**: capas, cada pantalla con desde dónde se llega y a dónde lleva, mapas de navegación, base de datos, flujos y segundo plano. Si añades o cambias una pantalla, una navegación, una tabla o migración, un flujo o algo nativo, actualízalo en el mismo commit (su §7 dice qué tocar) junto con su cabecera de versión.

## Convenciones

- **UI en español (es-ES)**; código, identificadores y nombres de ficheros en inglés (salvo las rutas de expo-router, que son en español como en el plan).
- TypeScript estricto. Nada de `any` sin justificar.
- La lógica de negocio va en `src/domain/` como **TS puro** (sin React Native ni Expo) y **siempre con tests**. Los casos de PLAN.md §4, §5 y §6.2 son obligatorios.
- Las pantallas acceden a datos solo a través de `src/db/repositories/`; las notificaciones solo desde `src/services/` (la única excepción es `src/app/_layout.tsx`, que escucha el toque en una notificación para abrir su ruta).
- Unidades: peso en **kg**; fechas locales `YYYY-MM-DD`; instantes en epoch ms; día de la semana **ISO 1 = lunes … 7 = domingo** (convertir a la convención de expo-notifications solo en `src/services`).
- Cualquier cambio en rutinas, slots, días o cardio debe llamar a `rescheduleDailyReminders()`.
- Usa **dev build** (`expo-dev-client`), no Expo Go.
- Comentarios escasos: solo donde el porqué no sea obvio.

## Expo cambia en cada SDK: no te fíes de la memoria

El proyecto usa **Expo SDK 58** (React Native 0.88, TypeScript 6). Antes de tocar una API de Expo, React Native o EAS, mira la versión en `package.json` y consulta la documentación de esa versión (`https://docs.expo.dev/versions/v58.0.0/`, índice en `https://docs.expo.dev/llms.txt`) o los `.d.ts` en `node_modules`. Detalles ya verificados:

- Pestañas JS: `import { Tabs } from 'expo-router/js-tabs'` (el `Tabs` de `expo-router` está deprecado).
- Notificaciones: `setNotificationHandler` usa `shouldShowBanner`/`shouldShowList`; los triggers llevan `type: SchedulableTriggerInputTypes.X` y `channelId`; `WEEKLY` usa 1 = domingo; `DATE` acepta `delivery: 'alarmClock'`.
- TypeScript 6 no carga tipos globales por defecto: están declarados en `tsconfig.json` (`types: ["jest", "node"]`).
- Instala dependencias con `npx expo install <paquete>` (resuelve versiones compatibles con el SDK).

## Compilar y probar

```bash
npx expo prebuild --platform android        # genera android/ (no se versiona)
cd android && ./gradlew assembleRelease     # APK en android/app/build/outputs/apk/release/
python scripts/sign_release.py              # (desde la raíz) firma con la clave propia y la rotación
npx expo run:android                         # build de desarrollo + Metro, con móvil o emulador conectado
```

Necesitas `ANDROID_HOME` apuntando al SDK de Android (en este equipo: `%LOCALAPPDATA%\Android\Sdk`) y JDK 17. Tras cambiar `app.json` o añadir un módulo nativo, vuelve a ejecutar `prebuild`. Ningún proceso debe tener como directorio de trabajo una carpeta dentro de `android/` al hacer `prebuild`: en Windows falla con `EBUSY` a mitad de borrar `android/`. El culpable típico es el **servidor de adb**, que hereda la carpeta desde la que se lanzó el primer comando `adb`: ejecuta `adb` siempre desde la raíz del proyecto y, si pasa, `adb kill-server` y repite `npx expo prebuild --platform android --clean`.

**Firma** (desde la 1.4.4): los APK de release se firman con la clave propia de la app, que vive fuera del repo (`~/.gradle/gradle.properties`, `ENTRENO_UPLOAD_*`, y el `.jks` que dice; copia de los dos en el gestor de contraseñas del usuario: si se pierden, no hay más actualizaciones). Después de `assembleRelease`, **siempre** `python scripts/sign_release.py`: añade la prueba de rotación (`signing/entreno-rotation.lineage`) para que los móviles con una versión firmada con la clave vieja (la de depuración de la plantilla de React Native, pública, hasta la 1.4.3) la acepten como actualización sin perder datos. `plugins/withReleaseSigning.js` mete la firma en `build.gradle` en cada `prebuild`; sin las propiedades, el release sigue con la clave de depuración. Un dev build (clave vieja) no se instala encima de un release con la nueva: desinstala antes en el emulador.

**Memoria**: si la compilación C++ falla con `clang++: error: clang frontend command failed due to signal` en muchos ficheros a la vez, es falta de RAM (cada arquitectura lanza un `clang` por núcleo). Cierra el emulador y Metro, `./gradlew --stop`, y compila con `--max-workers=2`. Para el APK basta `-PreactNativeArchitectures=arm64-v8a,x86_64` (el móvil y el emulador). Para probar algo de JS en el emulador sin perder sus datos se compila solo `x86_64`, y ese `app-release.apk` no se instala en un móvil («no es compatible con tu teléfono»): el que se reparte es la copia con su versión en Descargas (`Entreno-1.4.4.apk`).

**Sonidos**: el fin del descanso es `assets/sounds/rest_end.wav`, en su canal de notificaciones. El pitido de salida de los sprints no es una notificación: lo genera y lo toca el módulo nativo (`modules/rest-timer/.../SprintBeep.kt`, 2 kHz y 250 ms), y en `logcat` deja `[sprint] pitido N ms` con cuándo sonó de verdad. Los canales de Android son inmutables: un sonido distinto pide un id de canal nuevo y `prebuild --clean`. En el emulador, `python scripts/simulate_sprint.py --wait 5` simula un sprint con `adb emu geo fix` (sin velocidad Doppler sale «≈»; con `--doppler` la manda en cada punto y el sprint cuenta como bien medido), y `python scripts/simulate_walk.py --shape loop --speed 8` una caminata de 1,4 km en 3 min (también `--reverse`, `--detour 150`, `--stop`, un GPX y `--print`), para Mis rutas.

**Datos cifrados**: la base de datos va cifrada con SQLCipher (clave en el Keystore del dispositivo), así que copiarla del emulador con `run-as` ya no sirve para leerla con `sqlite3`. Los datos del usuario se leen de su copia de GitHub; si está cifrada, `node scripts/decrypt-backup.mjs copia.json > fuera-del-repo.json` con la contraseña que él te dé. Nunca guardes el resultado dentro del repo.

**Iconos**: los PNG de `assets/images/` (lanzador, adaptativo, monocromo, splash, favicon y `notification-icon.png`) salen de `python scripts/generate_icons.py` (sin dependencias). Para cambiarlos, edita el script, regenéralos y haz `prebuild --clean`.

**Rutas largas en Windows**: aunque `LongPathsEnabled = 1`, el `ninja.exe` 1.10.2 del CMake 3.22.1 del SDK no es *long-path aware* y la compilación C++ falla con `ninja: error: mkdir(CMakeFiles/rnscreens.dir/C_/Users/...): No such file or directory`. Un `subst` no sirve (el autolinking de Expo resuelve la ruta real). Soluciones: sustituir `%LOCALAPPDATA%\Android\Sdk\cmake\3.22.1\bin\ninja.exe` por ninja ≥ 1.12 (oficial, guardando copia del original), o compilar en la nube con EAS Build. **En este equipo ya está sustituido por ninja 1.12.1** (el original quedó como `ninja-1.10.2.exe.bak` junto a él). Tras un fallo así, borra las carpetas `.cxx` de `node_modules/*/android/` antes de reintentar.

## Antes de dar algo por terminado

```bash
npm run typecheck && npm run lint && npm test
```

Lo que dependa de notificaciones, segundo plano o permisos **no está terminado hasta probarlo en un Android real** (checklist de PLAN.md §14). Si no puedes probarlo, dilo explícitamente.

## Repo público: privacidad

No subas nunca el Excel, copias de seguridad (`*.json` exportados), tokens, APKs ni datos personales (fecha de nacimiento, etc.). Revisa `git status` antes de cada commit.

## Commits

Conventional commits, mensaje en español: `feat(entreno): descanso con notificación programada`, `fix(dieta): ...`, `docs(plan): ...`.
