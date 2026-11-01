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

## Antes de dar algo por terminado

```bash
npm run typecheck && npm run lint && npm test
```

Lo que dependa de notificaciones, segundo plano o permisos **no está terminado hasta probarlo en un Android real** (checklist de PLAN.md §14). Si no puedes probarlo, dilo explícitamente.

## Repo público: privacidad

No subas nunca el Excel, copias de seguridad (`*.json` exportados), tokens, APKs ni datos personales (fecha de nacimiento, etc.). Revisa `git status` antes de cada commit.

## Commits

Conventional commits, mensaje en español: `feat(entreno): descanso con notificación programada`, `fix(dieta): ...`, `docs(plan): ...`.
