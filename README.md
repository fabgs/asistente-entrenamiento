# Entreno — asistente de entrenamiento

App Android personal para entrenar con progresión automática de cargas, descansos cronometrados que suenan con el móvil bloqueado, recordatorio diario offline, perfil con cálculo de calorías/macros y plan de dieta. Todo se guarda en el móvil (SQLite).

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
```

El APK queda en `android/app/build/outputs/apk/release/app-release.apk`. Cópialo al móvil e instálalo (hay que permitir "instalar apps de origen desconocido"), o con el móvil conectado por USB: `adb install -r app-release.apk`.

Después, en la app: **Perfil → Ajustes y notificaciones → Diagnóstico de avisos**, quita la optimización de batería y comprueba que el resto de permisos pone «Sí».
