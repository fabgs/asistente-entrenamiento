# Guía para agentes

1. **Lee [PLAN.md](PLAN.md) entero antes de tocar nada.** Es la fuente de verdad de requisitos, modelo de datos, reglas de progresión y hoja de ruta.
2. Trabaja **por fases** (PLAN.md §13), en orden. Al terminar una tarea, marca su casilla; al terminar una fase, añade una línea al registro de cambios (§17).
3. Si cambias una decisión del plan, actualiza PLAN.md en el mismo commit explicando el motivo.

## Convenciones

- **UI en español (es-ES)**; código, identificadores y nombres de ficheros en inglés (salvo las rutas de expo-router, que son en español como en el plan).
- TypeScript estricto. Nada de `any` sin justificar.
- La lógica de negocio va en `src/domain/` como **TS puro** (sin React Native ni Expo) y **siempre con tests**. Los casos de PLAN.md §4, §5 y §6.2 son obligatorios.
- Las pantallas acceden a datos solo a través de `src/db/repositories/`; las notificaciones solo desde `src/services/`.
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
npx expo run:android                         # build de desarrollo + Metro, con móvil o emulador conectado
```

Necesitas `ANDROID_HOME` apuntando al SDK de Android (en este equipo: `%LOCALAPPDATA%\Android\Sdk`) y JDK 17. Tras cambiar `app.json` o añadir un módulo nativo, vuelve a ejecutar `prebuild`.

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
