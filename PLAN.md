# Asistente de Entrenamiento — Plan del proyecto

App móvil **personal** (un solo usuario) para gestionar entrenamiento de fuerza, cardio, dieta y datos corporales. Sustituye al Excel `Dieta y entrenamiento.xlsx`, cuyos datos ya están volcados en [`data/seed/seed.json`](data/seed/seed.json).

> **Para agentes:** este documento es la fuente de verdad. Lee también [AGENTS.md](AGENTS.md). Trabaja por fases (§13), marca las casillas al terminar y añade una línea al [registro de cambios](#17-registro-de-cambios). Si tomas una decisión que contradice este plan, actualiza el plan en el mismo commit y explica por qué.

---

## 1. Visión y alcance

**Prioridad absoluta: el módulo de entrenamiento.** Orden de importancia: Entrenamiento > Recordatorio diario > Perfil > Dieta > Backup online.

Objetivos:

1. **Entrenar dentro de la app**: "Empezar rutina" carga la rutina del día; elijo ejercicio, hago la serie, **meto solo las reps** (el peso ya está definido en el ejercicio de la rutina), arranca un **descanso de 2:30 que suena aunque el móvil esté bloqueado y la app en segundo plano**, y después me propone *siguiente serie* o *siguiente ejercicio*.
2. **Progresión automática de cargas**: según mis reglas (rango de reps por ejercicio), al terminar la sesión se calcula el nuevo peso y **me lo propone; solo se cambia en el ejercicio de la rutina si yo lo acepto**, **siempre en saltos de 2,5 kg**.
3. **Historial** de todas las series (peso × reps) y del cardio.
4. **Editar rutinas**: añadir/quitar/reordenar ejercicios, cambiar series, rangos, descansos y qué rutina toca cada día.
5. **Notificación diaria** a una hora configurable con lo que toca hoy (p. ej. "Caminar 5 km + bici 30 min + Día 1: Torso"), **funcionando sin internet y con la app cerrada**.
6. **Perfil** (peso, altura, edad…) que calcula TMB, gasto, calorías objetivo, macros y agua.
7. **Dieta**: base de alimentos y plan semanal con totales frente a los objetivos del perfil.
8. **Almacenamiento local** en el móvil (SQLite) + **copia de seguridad** exportable y automática a un repo privado de GitHub.

No objetivos (por ahora): multiusuario, cuentas, servidor propio, publicar en Play Store, iOS (ver §2), registro diario de comidas reales, wearables.

---

## 2. Decisiones técnicas

| Tema | Decisión | Motivo |
|---|---|---|
| Plataforma | **Android primero** (APK instalado a mano). iOS posible más adelante con el mismo código. | Uso personal, desarrollo desde Windows; iOS exige Mac o cuenta de Apple Developer para instalar. |
| Framework | **Expo (React Native) + TypeScript**, última SDK estable (`npx create-expo-app@latest`). | Multiplataforma, ecosistema grande, builds en la nube con EAS desde Windows, muy bien conocido por agentes. |
| Navegación | **expo-router**: rutas en `src/app/` (convención de SDK 58), `Stack` raíz con las pestañas JS (`expo-router/js-tabs`) dentro, para que el modo entrenamiento se abra a pantalla completa encima. | Estándar en Expo; facilita deep links desde notificaciones. `NativeTabs` no documenta pantallas apiladas por encima. |
| Base de datos | **expo-sqlite con SQL escrito a mano** (sin ORM). Migraciones en `src/db/migrations.ts` con `PRAGMA user_version`; repositorios tipados en `src/db/repositories/`. | Son ~14 tablas sencillas: sin generación de código, ni ficheros `.sql`, ni plugins de Babel. Los repositorios dependen de una interfaz mínima (`src/db/db.ts`) y se testean en Jest con el SQLite integrado de Node 22. *(Se descartó Drizzle el 2026-11-01.)* |
| Estado UI | Datos persistentes → SQLite (fuente de verdad), recargados al enfocar cada pantalla (`useLoader`). El estado del entrenamiento activo (ejercicio actual, fin del descanso, ejercicios saltados) también vive en `workout_session`. | Si la app muere, todo lo importante ya está en la BD. No hace falta Zustand por ahora. |
| Notificaciones | **expo-notifications**, solo **notificaciones locales programadas** (nada de push remoto). El descanso usa trigger `DATE` con **`delivery: 'alarmClock'`** (→ `AlarmManager.setAlarmClock()`). | Funcionan sin internet y con la app cerrada; `setAlarmClock` no lo retrasa Doze. Plan B nativo en §7.4 solo si falla en el móvil real. |
| Gráficas | **react-native-gifted-charts**. | Sencillo, sin dependencias pesadas. |
| Fechas | **date-fns** con locale `es`. | Ligero. |
| Tests | **jest-expo** + @testing-library/react-native. La lógica de dominio es TS puro y se testea sin RN. | |
| Builds | Nunca Expo Go (sonidos de notificación personalizados, canales y permisos lo requieren). **Build local**: `npx expo prebuild --platform android` + `cd android && ./gradlew assembleRelease` → APK firmado con la clave de debug, instalable a mano (ver [README](README.md)). Para desarrollo con recarga en caliente: `npx expo run:android` (incluye `expo-dev-client`). EAS Build es opcional (requiere cuenta de Expo). | |
| Backup online | **Export/Import JSON** (manual) + **auto-backup a un repo privado de GitHub** vía API REST (§9). | Sin servidor, gratis, los datos son míos, y el historial de git da versiones de cada copia. |

Identificadores: nombre visible **"Entreno"**, Android package **`com.fabgs.entreno`**, esquema de deep link **`entreno://`**.

---

## 3. Datos iniciales (seed)

[`data/seed/seed.json`](data/seed/seed.json) se generó a partir del Excel. **El Excel no se sube al repo** (contiene datos personales; está en `.gitignore`).

Contenido:

- `profile`: altura 184 cm, peso 84 kg, hombre, factor actividad 1,5, déficit 400 kcal, 2 g/kg proteína, 1 g/kg grasa, 0,035 L/kg agua. **`birthDate` es `null` a propósito**: se pide en el onboarding.
- `settings`: descanso 150 s, incremento 2,5 kg, modo de progresión `average`, 2 sesiones por debajo para bajar, recordatorio diario 06:00 (el entreno empieza a las 06:30).
- `exercises` (22): `name`, `type` (`external` = carga externa / `bodyweight` = peso corporal con lastre opcional), `equipment`.
- `routines` (4): nombre, `weekdays` (ISO, 1 = lunes), `slots` con: `sets`, `weightKg` (peso actual = "Peso HOY" del Excel; `null` = peso corporal sin lastre), `target` (`range` {min,max} | `fixed` {reps} | `failure` {minus}), `perSide`, `unit` (`reps`/`steps`), `progression` (`load`/`manual`), `allowDecrease`, `incrementKg`, `restSeconds`, `note` (la regla original del Excel) e `history` (rendimientos "anterior" y "hoy" del Excel, del más antiguo al más reciente).
- `cardio` (9): actividad por día de la semana con objetivo, intensidad y notas.
- `foods` (34): macros por 100 g.
- `dietPlan` (145): `weekday`, `meal` (`desayuno`/`comida`/`merienda`/`cena`), `food`, `grams`.

Calendario semanal resultante:

| Día | Fuerza | Cardio |
|---|---|---|
| Lunes | Día 1: Torso (Empuje Pesado + Tirón Volumen) | Caminar 5 km + Bici estática 30 min |
| Martes | Día 2: Pierna y Core | Caminar 5 km |
| Miércoles | — | Sprints + Bouncing 15 min (HIIT, mañana) |
| Jueves | Día 3: Torso (Tirón Pesado + Empuje Volumen) | Caminar 5 km + Bici estática 30 min (zona 3-4) |
| Viernes | Día 4: Pierna y Core (Metabólico) | Caminar 5 km |
| Sábado | — | Sprints + Bouncing 15 min (HIIT, mañana) |
| Domingo | — | Descanso / Caminar (opcional) |

**Importación en el primer arranque** (BD vacía): crear todo lo anterior; registrar el peso inicial en `weight_log` con la fecha de hoy; convertir cada `history` en sesiones `imported = 1`: las entradas "anterior" con fecha del día de la semana de esa rutina de hace 2 semanas y las "hoy" de hace 1 semana, para que el motor de progresión tenga datos desde el primer día. Después se ejecuta el motor de progresión una vez por slot y se crean las **recomendaciones pendientes** (`weight_change` con `source = 'import'`, `status = 'pending'`, §6.2). **Los pesos de los slots no cambian**: se quedan como en el Excel hasta que yo acepte cada recomendación. La importación es idempotente (solo si la BD está vacía) y va en una transacción.

---

## 4. Perfil y cálculos

Campos: nombre, sexo, fecha de nacimiento, altura (cm), factor de actividad (selector: 1,2 · 1,375 · 1,5 · 1,55 · 1,725, por defecto 1,5), déficit kcal (por defecto 400; negativo = superávit), g/kg de proteína (2), g/kg de grasa (1), L/kg de agua (0,035). **El peso no se guarda en el perfil**: se usa el último registro de `weight_log`.

Fórmulas (`src/domain/nutrition.ts`, funciones puras):

```
edad          = años completos entre birthDate y hoy
TMB           = 10·peso + 6,25·altura − 5·edad + 5      (hombre)   ← Mifflin-St Jeor
              = 10·peso + 6,25·altura − 5·edad − 161    (mujer)
gastoTotal    = TMB · factorActividad
kcalObjetivo  = gastoTotal − déficit
proteína (g)  = peso · proteinGPerKg
grasa (g)     = peso · fatGPerKg
carbos (g)    = (kcalObjetivo − proteína·4 − grasa·9) / 4
agua (L)      = peso · waterLPerKg
IMC           = peso / (altura_m)²
kcal alimento = grasa·9 + carbos·4 + proteína·4
```

> El Excel usaba `6,24·altura` (errata); usamos el coeficiente correcto 6,25 (diferencia ≈ 1,8 kcal).

**Caso de test** (84 kg, 184 cm, 24 años, hombre, 1,5, déficit 400): TMB **1875** · gasto **2812,5** · objetivo **2412,5 kcal** · P **168 g** · G **84 g** · C **246,125 g** · agua **2,94 L** · IMC **24,81**.

Pantalla Perfil: formulario + tarjetas con los resultados + "Registrar peso" (fecha, kg) + gráfica de evolución del peso. Al cambiar el peso se recalculan los objetivos (y la dieta los muestra actualizados).

---

## 5. Dieta

- **Alimentos**: CRUD con macros por 100 g (kcal calculadas). Suplementos (creatina, colágeno, omega 3) tienen macros 0 y se muestran igual.
- **Plan semanal**: para cada día (L–D) y comida (desayuno, comida, merienda, cena) una lista de `alimento + gramos`. Añadir/quitar/editar gramos/reordenar, y **"Copiar día a…"**.
- **Totales**: por comida, por día y media semanal, frente a los objetivos del perfil (grasa, carbos, proteína, kcal) con indicador de desviación (verde ±5 %, ámbar ±10 %, rojo fuera).
- **Casos de test con el seed**: Lunes = G 94,66 · C 247,39 · P 157,71 · **2472,34 kcal**. Media semanal = G 77,53 · C 236,40 · P 166,28 · **2308,45 kcal** (idéntico al Excel).

---

## 6. Entrenamiento (núcleo)

### 6.1 Conceptos

- **Ejercicio** (`exercise`): catálogo. `type`: `external` (barra/mancuerna; el peso es la carga externa, por mancuerna si son dos) o `bodyweight` (el peso es el **lastre**; 0 = sin lastre).
- **Rutina** (`routine`): un día de entreno ("Día 1: Torso…") asignado a uno o varios días de la semana.
- **Slot** (`routine_slot`): un ejercicio dentro de una rutina con su prescripción: **peso actual**, series, objetivo de reps, progresión, descanso, nota. **El peso vive aquí**: durante el entreno no se introduce, solo se registran reps. El mismo ejercicio puede aparecer en varias rutinas con prescripciones distintas (p. ej. *Toes to bar* al fallo el martes y 10–12 el viernes).
- **Sesión** (`workout_session`): una ejecución de una rutina en una fecha.
- **Serie** (`set_log`): reps registradas + **copia del peso del slot** en ese momento (para que el historial no cambie cuando el slot suba de peso).

**La progresión se calcula por slot** (como en el Excel, donde cada día lleva su propio "peso anterior"). El historial por ejercicio agrega todos los slots.

### 6.2 Motor de progresión (`src/domain/progression.ts`)

Función pura:

```ts
recommend(slot, exercise, history, settings): Recommendation
// history: sesiones TERMINADAS que incluyen este slot, de la más reciente a la más antigua
type Recommendation = {
  action: 'increase' | 'decrease' | 'keep' | 'manual' | 'none';
  weightKg: number | null;      // peso recomendado para la próxima sesión
  reason: string;               // texto en español para la UI, p.ej. "Media 14,7 > 12 → sube a 37,5 kg"
  repsToBeat?: number[];        // reps de la última sesión, para mostrar como referencia
};
```

Reglas:

1. **Resumen de una sesión** para el slot: `peso de trabajo` = peso copiado en sus series (`set_log.weight_kg`, `null` cuenta como 0); `reps` = reps de todas sus series (las series extra cuentan).
2. Si `slot.progression === 'manual'` o `target.kind === 'failure'` → `manual`: sin cambio de peso; mostrar `slot.note` y `repsToBeat` ("supera tus reps").
3. Si no hay historial → `none` ("Elige el peso inicial").
4. `inc = slot.incrementKg ?? exercise.incrementKg ?? settings.defaultIncrementKg` (2,5). **Nunca se sube o baja más de un `inc` por sesión.**
5. Si la última sesión tiene menos series al peso de trabajo que `slot.sets` → `keep` ("Sesión incompleta").
6. Evaluar la última sesión:
   - `range` + modo `average` (por defecto): **media de reps > max → por encima**; **media < min → por debajo**.
   - `range` + modo `strict`: **todas las series ≥ max → por encima**; media < min → por debajo.
   - `fixed` (p. ej. 20 pasos): todas las series ≥ objetivo → por encima; nunca por debajo.
7. Por encima → `increase`, `peso + inc`.
8. Por debajo y `slot.allowDecrease`:
   - Si las últimas `settings.sessionsBelowToDecrease` (2) sesiones están por debajo **con el mismo peso** → `decrease`, `peso − inc`; si eso da < 0 → `keep` ("Sin carga que quitar: usa una variante más fácil").
   - Si no → `keep` con aviso ("Por debajo del rango; si se repite, bajará").
   - Motivo de esperar 2 sesiones: en el Excel, tras una sesión floja se mantenía el peso (hip thrust, laterales).
9. Por debajo sin `allowDecrease` → `keep`. En rango → `keep`.

**Aplicación: nunca automática.** Al terminar una sesión, para cada slot hecho se llama a `recommend()` y, si es `increase` o `decrease`, se crea una **recomendación pendiente** en `weight_change` (`from_kg`, `to_kg`, `reason`, `session_id`, `source = 'progression'`, `status = 'pending'`). `routine_slot.weight_kg` **solo cambia cuando pulso "Aplicar"** (`status = 'applied'`); "Ignorar" la pasa a `status = 'dismissed'`, **pero no desaparece**: se queda en el propio ejercicio como **sugerencia discreta** ("Sugerencia: ↑ 37,5 kg · Aplicar") que se puede aplicar en cualquier momento. Justo después de aplicar hay "Deshacer" (restaura `from_kg` y vuelve a `pending`). Las recomendaciones "abiertas" son las `pending` y las `dismissed` (`listOpenChanges`).

- Una recomendación `pending` se muestra como caja destacada (Aplicar / Ignorar) en el resumen, en Hoy y en la primera serie de ese ejercicio en el entreno (§6.3, §6.4). Una `dismissed` (o una pospuesta con "Ahora no") se muestra como sugerencia discreta en Hoy, en Rutinas, en el entreno y en el editor del ejercicio.
- Si termino otra sesión de ese slot, la recomendación abierta anterior (pendiente o ignorada) pasa a `expired` y, si toca, se crea la nueva (calculada con el peso que realmente usé).
- Si cambio el peso a mano en el editor de rutinas, se registra como `source = 'manual'`, `status = 'applied'`, y expira cualquier recomendación abierta de ese slot.
- Como mucho una recomendación abierta por slot, y de un solo incremento.

**Casos de test obligatorios** (con el seed, `average`, inc 2,5, 2 sesiones para bajar):

| Rutina | Ejercicio | Objetivo | Última sesión | Resultado |
|---|---|---|---|---|
| D1 | Fondos en paralelas lastrados | 5–8 | 15 kg · 9,8,6 | keep 15 |
| D1 | Remo con barra (90º) | 10–12 | 35 kg · 15,15,14 | **increase 37,5** |
| D1 | Floor Press con barra | 10–15 | 35 kg · 17,17 | **increase 37,5** |
| D1 | Elevaciones laterales mancuerna | 15–20 | 5 kg · 13,13,14 (antes 14,13,13 a 5 kg) | **decrease 2,5** |
| D1 | Curl bíceps barra Z | 10–12 | 20 kg · 10,9,9 (antes 10,9,8) | **decrease 17,5** |
| D1 | Dominadas pronas | al fallo −1 | 10,9,8 | manual |
| D2 | Sentadilla Búlgara lastrada | 8–12 | 10 kg · 14,14,14 | **increase 12,5** |
| D2 | Peso Muerto Rumano barra | 10–15 | 35 kg · 15,15,14 | keep 35 |
| D2 | Zancadas caminando | 20 pasos (fixed) | 10 kg · 20,20 | **increase 12,5** |
| D2 | Gemelos a 1 pierna | 15–20 | 0 kg · 20,20,20 | keep 0 |
| D3 | Dominadas supinas lastradas | 5–8 | 7,5 kg · 9,8,8 | **increase 10** |
| D3 | Remo mentón barra Z | 10–12 | 15 kg · 15,15,15 | **increase 17,5** |
| D3 | Australianas (homb post) | 15–20 | 0 kg · 13,12 (1 sola sesión) | keep 0 + aviso |
| D3 | Rompecráneos suelo | 10–15 | 15 kg · 15,13,11 | keep 15 |
| D4 | Sentadilla Goblet/Frontal | 15–20 (sin bajada) | 35 kg · 15,15,14 | keep 35 |
| D4 | Hip Thrust a 1 pierna | 10–12 | 20 kg · 9,9 (antes 9,9) | **decrease 17,5** |
| D4 | Toes to bar | 10–12 | 0 kg · 7 (1 de 2 series) | keep 0 (incompleta) |

Las filas `increase`/`decrease` de la columna "Resultado" son también las **recomendaciones pendientes que aparecen tras importar el seed** (§3).

Añadir además tests de: `strict`, incremento personalizado, bajada que llegaría a negativo, que nunca se salta más de un incremento, aplicar / ignorar / deshacer una recomendación, que una pendiente expira al terminar otra sesión del slot, que sin aceptar el peso del slot no cambia, y que el historial conserva el peso antiguo tras una subida.

### 6.3 Pantalla "Hoy" (tab inicial)

- Fecha y día. Rutina de hoy (según `routine_weekday`) con la lista de ejercicios, series × objetivo y **peso del slot**. Si hay recomendación pendiente: "35 kg → **37,5 kg** recomendado" con su motivo y botones **Aplicar / Ignorar** (y "Aplicar todas" si hay varias).
- Cardio de hoy como checklist (marcar hecho, opcional: valor real "5,3 km", "32 min").
- Botón **"Empezar rutina"** (o **"Continuar entrenamiento"** si hay una sesión `in_progress`).
- "Entrenar otra rutina" (selector) por si cambio el día. En días sin rutina: mensaje de descanso + cardio.
- Si hay una sesión `in_progress` de hace más de 12 h: preguntar "¿Terminarla o descartarla?".

### 6.4 Modo entrenamiento (`app/workout/[sessionId].tsx`)

Máquina de estados (`src/domain/workoutMachine.ts`, pura y testeada):

```
 EXERCISE_LIST ──elige ejercicio──▶ SET_INPUT ──"Serie hecha"──▶ RESTING
      ▲                                ▲                           │
      │                                └──"Siguiente serie"────────┤ (fin del descanso o "Saltar")
      └─────────"Siguiente ejercicio" / "Elegir otro"──────────────┘ (si era la última serie)
 EXERCISE_LIST ──"Terminar entrenamiento"──▶ SUMMARY
```

- **EXERCISE_LIST**: ejercicios de la rutina en orden con progreso ("2/3 series"), el siguiente pendiente destacado. Se puede elegir **cualquiera** (orden libre). Acciones: añadir ejercicio puntual (del catálogo, con opción "añadir también a la rutina"), saltar ejercicio, terminar.
- **SET_INPUT**: nombre, "Serie 2 de 3", **peso del slot (solo lectura**, "37,5 kg", "Lastre 15 kg" o "Peso corporal"), objetivo ("10–12 reps", "por pierna"), nota/regla y reps de esta serie la última vez. **Único input: reps**, grande, con stepper ±1, precargado con las reps de esa serie la última vez (o el mínimo del rango). Botón **"Serie hecha"** → guarda `set_log` (reps + copia del peso del slot) **inmediatamente** en la BD. Si el slot tiene una recomendación pendiente, al llegar a su **primera serie** aparece un aviso "Recomendado 37,5 kg (media 14,7 > 12) — **Aplicar / Ignorar / Ahora no**"; si aplico, las series de hoy ya usan el nuevo peso. Si hace falta cambiar el peso por otro motivo (p. ej. no está libre la mancuerna), un icono "editar" abre el editor del slot; el cambio afecta a esta sesión y a las siguientes.
- **RESTING**: cuenta atrás grande (2:30 por defecto; `slot.restSeconds ?? settings.restSecondsDefault`), botones **−30 s / +30 s / Saltar**, y debajo "Siguiente: Serie 3/3 · Remo con barra · 37,5 kg" o "Siguiente ejercicio: …". Al llegar a 0: sonido + vibración y botón **"Siguiente serie"** / **"Siguiente ejercicio"** / "Elegir otro". Tras la **última serie del último ejercicio** no hay descanso: se ofrece terminar.
- Desde cualquier estado: ver/corregir las reps o borrar series ya hechas y añadir **serie extra**.
- **"Terminar entrenamiento"**: marca la sesión como `finished` y **crea las recomendaciones pendientes** (§6.2) en la misma transacción. No cambia ningún peso.
- **SUMMARY** (`app/workout/resumen/[sessionId].tsx`): duración, series totales, volumen (Σ peso × reps de ejercicios con carga), récords (más reps a un peso o primer día con un peso nuevo) y **recomendaciones** por slot ("Remo con barra: 35 → 37,5 kg · media 14,7 > 12") con botones **Aplicar / Ignorar** y "Aplicar todas"; nada viene marcado por defecto y lo que no decida queda pendiente. Los slots sin cambio muestran "=" y su motivo.
- **Pantalla siempre encendida** durante el entreno (expo-keep-awake, configurable). Hápticos en "Serie hecha" y fin de descanso.
- **Resistente a cierres**: la sesión, sus series y el estado del descanso (`rest_ends_at`) están en la BD. Al reabrir, se reconstruye el estado y la cuenta atrás continúa correctamente.

### 6.5 Descanso en segundo plano (requisito crítico)

Diseño (`src/services/restTimer.ts`):

1. Al pulsar "Serie hecha": `endsAt = Date.now() + restSeconds·1000`.
2. **Programar una notificación local con trigger de fecha en `endsAt` y `delivery: 'alarmClock'`** (canal `rest-timer-v1`, identificador `rest-<sessionId>`, título "¡Descanso terminado!", cuerpo "Siguiente: Serie 3/3 · Remo con barra · 37,5 kg", `data.url = entreno://workout/<sessionId>`). La programa el sistema operativo, así que **suena con la pantalla bloqueada, con la app en segundo plano e incluso si el proceso muere**.
3. Guardar `rest_ends_at` y `rest_notification_id` en `workout_session`.
4. La cuenta atrás de la UI **se calcula siempre como `endsAt − Date.now()`** (nunca restando ticks), refrescando cada ~250 ms; al volver a primer plano (`AppState` → `active`) se recalcula.
5. −30 s / +30 s / Saltar / editar → cancelar la notificación y reprogramarla (o no).
6. En primer plano, el handler de notificaciones debe mostrar y **sonar** igualmente (una sola vía de aviso) y además vibrar con expo-haptics y pasar la UI al estado "Siguiente…".
7. Tocar la notificación abre la sesión (deep link vía expo-router).
8. Al terminar o descartar la sesión: cancelar cualquier notificación `rest-*` pendiente.

Android:

- Canal `rest-timer` con importancia **MAX**, sonido propio `assets/sounds/rest_end.wav` (declarado en el plugin de `expo-notifications`, `sounds`), patrón de vibración, visible en pantalla de bloqueo y `audioAttributes.usage = ALARM` para que suene con volumen de alarma (verificar en modo silencio).
- **Los canales de Android son inmutables** una vez creados: si se cambia el sonido o la importancia, crear un canal nuevo (`rest-timer-v2`) y borrar el viejo.
- Permisos en `app.json`: `POST_NOTIFICATIONS` (Android 13+, pedirlo en el onboarding), `USE_EXACT_ALARM` (válido porque la app no va a Play Store), `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; el módulo `rest-timer` añade `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `SYSTEM_ALERT_WINDOW` y `POST_PROMOTED_NOTIFICATIONS`.
- Guiar al usuario para **excluir la app de la optimización de batería** (botón en Ajustes → abre el ajuste del sistema con `expo-intent-launcher`). Algunas capas de fabricante (Xiaomi, Samsung, Huawei…) retrasan o matan alarmas si no.
- **Criterio de aceptación**: en un móvil real, con pantalla bloqueada y app en segundo plano o cerrada, un descanso de 2:30 suena con **≤ 3 s de retraso** en 10 de 10 pruebas. Si `expo-notifications` no lo cumple → ver Plan B (§7.4).
- **Cuenta atrás visible "como el reloj"** (módulo nativo local `modules/rest-timer`, Kotlin): durante el descanso corre un *foreground service* (`specialUse`) con una notificación fija cuya cuenta atrás dibuja el sistema (`setUsesChronometer` + `setChronometerCountDown` + `setWhen(endsAt)`), pública en la **pantalla de bloqueo**, sin sonido (canal `rest-countdown-v1`) y que en **Android 16** se pide como *Live Update* (`setRequestPromotedOngoing`). Se cierra sola al llegar a 0 (y `setTimeoutAfter` de respaldo); el sonido lo pone la alarma de `expo-notifications`.
- **Burbuja flotante**: si el ajuste "Burbuja flotante" está activo y hay permiso *Mostrar sobre otras apps* (`SYSTEM_ALERT_WINDOW`, se concede en Ajustes → Diagnóstico), el mismo servicio muestra una burbuja arrastrable con la cuenta atrás **solo mientras la app está en segundo plano** (el módulo escucha `OnActivityEntersBackground/Foreground`). Tocarla vuelve a la app; recuerda la posición.
- API JS (`modules/rest-timer/index.ts`): `startRestCountdown(endsAt, title, body, overlay)`, `stopRestCountdown()`, `canDrawOverlays()`; `restTimer.ts` la llama junto con la alarma.

### 6.6 Historial y progreso

- Tab **Historial**: lista de sesiones (fecha, rutina, duración, nº series) → detalle con todas las series (editables) y cardio del día.
- **Detalle de ejercicio** (`app/ejercicio/[id].tsx`): tabla por sesión (peso × reps por serie), gráfica de peso de trabajo y de reps totales por sesión, récords y lista de recomendaciones y cambios de peso (`weight_change`: aplicadas, ignoradas, manuales). Las sesiones importadas del Excel se marcan como tales.
- Historial de cardio: lista de días con actividades hechas.

### 6.7 Editor de rutinas y ejercicios

- **Catálogo de ejercicios**: crear/editar (nombre, tipo, equipo, incremento propio, notas) y archivar (nunca borrar si tiene historial).
- **Rutinas**: crear/renombrar/archivar; asignar días de la semana; añadir ejercicios desde el catálogo; reordenar (arrastrar o subir/bajar); editar slot (**peso actual** — se registra como cambio `manual` —, series, objetivo `range`/`fixed`/`failure`, por lado, unidad, progresión `load`/`manual`, permitir bajada, incremento, descanso, nota); quitar slot (soft delete: `archived = 1`, conserva historial).
- **Cardio semanal**: por día, lista de actividades (nombre, objetivo, intensidad, notas).
- **Vista calendario** L–D con lo que toca cada día.
- Cualquier cambio aquí llama a `rescheduleDailyReminders()` (§7).

---

## 7. Notificación diaria

### 7.1 Comportamiento

- Ajustes: activar/desactivar y **hora** (por defecto 06:00).
- Cada día a esa hora, sin internet y con la app cerrada: notificación con lo que toca, por ejemplo:
  - **Lunes · Día 1: Torso (Empuje Pesado + Tirón Volumen)** — "🚶 Caminar 5 km · 🚴 Bici estática 30 min · 🏋️ 7 ejercicios"
  - **Miércoles · HIIT** — "⚡ Sprints + Bouncing 15 min (sesión de mañana)"
  - **Domingo · Descanso** — "Descanso / Caminar (opcional)"
- Tocar la notificación abre la pantalla **Hoy**.

### 7.2 Implementación (`src/services/dailyReminder.ts`)

- Se programan **7 notificaciones semanales** (una por día, trigger `WEEKLY` con `weekday`, `hour`, `minute`), identificadores `daily-1` … `daily-7`, canal `daily-reminder` (importancia alta, sonido por defecto). El texto de cada una lo genera la función pura `buildDailyMessage(isoWeekday, data)` en `src/domain/schedule.ts`.
- `rescheduleDailyReminders()` es **idempotente**: cancela `daily-*` y las vuelve a crear. Se llama al arrancar la app, al cambiar hora/activación y tras cualquier cambio en rutinas, slots, días asignados o cardio.
- ⚠️ **Convención de días**: en todo el dominio y la BD se usa **ISO (1 = lunes … 7 = domingo)**. `expo-notifications` usa **1 = domingo … 7 = sábado**. Convertir solo en el borde con `isoToExpoWeekday(iso) = iso === 7 ? 1 : iso + 1`, con test.

### 7.3 Pantalla de diagnóstico (Ajustes)

Estado de permisos (notificaciones, alarmas exactas, optimización de batería) con botones para corregirlos, botón **"Probar descanso (10 s)"**, botón **"Probar recordatorio"** y lista de notificaciones programadas.

### 7.4 Plan B (si las alarmas llegan tarde)

Desde SDK 58, `expo-notifications` ya programa con `setAlarmClock()` cuando se pide `delivery: 'alarmClock'` y hay permiso de alarma exacta (lo que se usa en `restTimer.ts`), así que este plan B solo hace falta si en el móvil real sigue llegando tarde. En ese caso, crear un **módulo nativo local de Expo** (Kotlin, `modules/exact-alarm`) que programe con `AlarmManager.setAlarmClock()` (exento de Doze y el más fiable) un `BroadcastReceiver` que publique la notificación en el canal `rest-timer`, y que la reprograme tras reinicio (`BOOT_COMPLETED`). API JS: `scheduleExact(id, timestampMs, title, body, url)` / `cancel(id)`. `restTimer.ts` lo usa detrás de la misma interfaz. Documentar la decisión aquí si se activa.

---

## 8. Ajustes generales

Descanso por defecto (s), pantalla encendida durante el entreno, burbuja flotante, recordatorio diario (on/off + hora), diagnóstico (§7.3), copia de seguridad (§9) y **modo pruebas**.

**Modo pruebas** (`settings.dev_mode`, activado por defecto mientras la app está en pruebas): en el primer arranque tras instalar un APK nuevo se borran todos los datos y se vuelve a cargar el seed. Se detecta comparando `Application.getLastUpdateTimeAsync()` (Android lo actualiza en cada instalación) con el valor guardado en `app_meta('install-stamp')`. Con el modo pruebas activo no se hacen copias automáticas a GitHub. En Ajustes hay un interruptor para apagarlo y un botón "Reiniciar datos ahora". **Cuando el usuario empiece a usar la app de verdad**: apagarlo en Ajustes y cambiar el valor por defecto para instalaciones nuevas (pendiente de que el usuario lo pida).

---

## 9. Copia de seguridad

Código: `src/db/maintenance.ts` (exportar, validar, restaurar, borrar), `src/services/backup.ts` (ficheros, GitHub, modo pruebas), `src/services/githubBackup.ts` (cliente de la API de GitHub), UI en `src/components/DataSettings.tsx` (Ajustes).

1. **Exportar/Importar fichero**: volcado de las tablas de `BACKUP_TABLES` → `{ app: 'entreno', schemaVersion, exportedAt, tables }` en `entreno-backup-AAAA-MM-DD.json` (caché) compartido con el menú del sistema (`expo-sharing`). Importar con `File.pickFileAsync` de `expo-file-system` → `parseBackup` → confirmación → `restoreBackup`: borra e inserta **en una sola transacción** (si algo falla, los datos actuales no se tocan), ignora columnas desconocidas y rechaza copias de un `schemaVersion` más nuevo. Después se cancelan y reprograman las notificaciones.
2. **Copia automática en GitHub**: repo **privado** del usuario (usuario, repositorio y ruta del fichero en Ajustes) y un **fine-grained personal access token** con permiso *Contents: Read and write* solo sobre ese repo, guardado en **expo-secure-store** (nunca en la BD ni en el JSON).
   - Cuándo: al arrancar la app y al terminar un entreno, como mucho una vez cada 24 h, nunca en modo pruebas; si falla, se guarda el error (`settings.last_backup_error`) y se reintenta la próxima vez. Manual: "Subir copia ahora".
   - Cómo: `GET /repos/{owner}/{repo}/contents/{path}` para obtener el `sha` → `PUT` con el JSON en base64 (`File.base64()`). Cada copia es un commit → historial de versiones.
   - Restaurar: descarga con `Accept: application/vnd.github.raw+json`, confirmación y `restoreBackup`.

---

## 10. Modelo de datos (SQLite)

Convenciones: ids `INTEGER PRIMARY KEY AUTOINCREMENT`; pesos en **kg (REAL)**; fechas locales `TEXT 'YYYY-MM-DD'`; instantes en **epoch ms (INTEGER)**; booleanos `INTEGER 0/1`; día de la semana **ISO 1–7**; `archived` para borrado lógico.

| Tabla | Columnas |
|---|---|
| `profile` (1 fila) | `id`=1, `name`, `sex` ('male'/'female'), `birth_date`, `height_cm`, `activity_factor`, `deficit_kcal`, `protein_g_per_kg`, `fat_g_per_kg`, `water_l_per_kg` |
| `settings` (1 fila) | `id`=1, `rest_seconds_default`, `default_increment_kg`, `progression_mode`, `sessions_below_to_decrease`, `daily_reminder_enabled`, `daily_reminder_time` ('HH:mm'), `keep_awake`, `rest_overlay`, `dev_mode`, `backup_owner`, `backup_repo`, `backup_path`, `last_backup_at`, `last_backup_error` |
| `app_meta` | `key`, `value` — datos internos que sobreviven a un borrado (p. ej. `install-stamp`) |
| `weight_log` | `id`, `date` (único), `weight_kg` |
| `exercise` | `id`, `name` (único), `type` ('external'/'bodyweight'), `equipment`, `increment_kg` (null = por defecto), `notes`, `archived` |
| `routine` | `id`, `name`, `position`, `archived` |
| `routine_weekday` | `routine_id`, `weekday` — PK (`routine_id`, `weekday`) |
| `routine_slot` | `id`, `routine_id`, `exercise_id`, `position`, `weight_kg` (peso actual; null = peso corporal sin lastre), `sets`, `target_kind` ('range'/'fixed'/'failure'), `rep_min`, `rep_max`, `fixed_reps`, `failure_minus`, `per_side`, `unit` ('reps'/'steps'/'seconds'), `progression` ('load'/'manual'), `allow_decrease`, `increment_kg`, `rest_seconds`, `note`, `archived` |
| `cardio_activity` | `id`, `weekday`, `name`, `target`, `intensity`, `notes`, `position`, `archived` |
| `cardio_log` | `id`, `date`, `activity_id` (nullable), `name`, `done`, `value`, `notes` |
| `workout_session` | `id`, `routine_id` (nullable), `date`, `started_at`, `finished_at`, `status` ('in_progress'/'finished'/'abandoned'), `imported`, `notes`, `rest_ends_at`, `rest_notification_id`, `current_slot_id`, `skipped_slot_ids` (JSON) |
| `set_log` | `id`, `session_id`, `slot_id` (nullable: ejercicio puntual), `exercise_id`, `set_index`, `weight_kg` (copia del peso del slot al registrar; nullable), `reps`, `is_extra`, `completed_at` |
| `weight_change` | `id`, `slot_id`, `session_id` (nullable), `from_kg`, `to_kg`, `reason`, `source` ('progression'/'manual'/'import'), `status` ('pending'/'applied'/'dismissed'/'expired'), `created_at`, `decided_at` |
| `food` | `id`, `name` (único), `fat_per_100g`, `carbs_per_100g`, `protein_per_100g`, `archived` |
| `diet_item` | `id`, `weekday`, `meal` ('desayuno'/'comida'/'merienda'/'cena'), `food_id`, `grams`, `position` |

Índices: `set_log(session_id)`, `set_log(slot_id, completed_at)`, `set_log(exercise_id, completed_at)`, `workout_session(status)`, `workout_session(date)`, `diet_item(weekday)`, `cardio_log(date)`.

`recommend()` se calcula al terminar cada sesión y su resultado se guarda como fila `pending` en `weight_change`; `routine_slot.weight_kg` solo cambia al aplicar. Índice adicional: `weight_change(slot_id, status)`.

---

## 11. Estructura del proyecto

El proyecto Expo vive en la **raíz del repo** (junto a este plan). `android/` lo genera `expo prebuild` y no se versiona.

```
src/
  app/                              # rutas (expo-router)
    _layout.tsx                     # SQLiteProvider (migraciones + seed), canales y permisos, deep links, Stack raíz
    (tabs)/_layout.tsx              # Hoy · Rutinas · Historial · Dieta · Perfil
    (tabs)/index.tsx                # Hoy
    (tabs)/rutinas.tsx              # semana, rutinas con pesos y sugerencias, accesos a los editores
    (tabs)/historial.tsx            # sesiones terminadas
    (tabs)/dieta.tsx                # plan semanal y totales (edición: fase 7)
    (tabs)/perfil.tsx               # datos, objetivos calculados, registro de peso
    workout/[sessionId].tsx         # modo entrenamiento (lista · serie · descanso)
    workout/resumen/[sessionId].tsx # resumen + recomendaciones
    slot/[id].tsx                   # ejercicio de una rutina: peso, prescripción, recomendación, quitar
    rutina/[id].tsx                 # editor de rutina: nombre, días, orden, añadir/archivar
    ejercicios.tsx                  # catálogo de ejercicios / selector para añadir a una rutina
    ejercicio/[id].tsx              # crear (id = nuevo) o editar un ejercicio del catálogo
    cardio.tsx                      # cardio semanal editable
    ajustes.tsx                     # descanso, recordatorio, pantalla encendida, diagnóstico de avisos
  db/         db.ts (interfaz Db) · migrations.ts · seed.ts · seedData.ts · seedTypes.ts · maintenance.ts (backup/borrado) · repositories/*.ts · __tests__/
  domain/     progression.ts · nutrition.ts · schedule.ts · workoutMachine.ts · format.ts · types.ts · __tests__/
  services/   notifications.ts · restTimer.ts · dailyReminder.ts · backup.ts · githubBackup.ts · __tests__/
  components/ ui.tsx (Screen, Card, Button, Stepper editable, TextField, DateField, SwitchRow, WeekdayPicker…) · Recommendation.tsx · DataSettings.tsx
  hooks/      data.ts (useDb, useLoader, useNow)
  theme.ts
modules/rest-timer/                 # módulo nativo local (Kotlin): cuenta atrás en bloqueo + burbuja flotante
assets/sounds/rest_end.wav          # generado (sin derechos)
data/seed/seed.json
```

Reglas: `src/domain` no importa nada de React Native ni de Expo (TS puro, 100 % testeable). Las pantallas no hablan con SQLite directamente: usan `src/db/repositories`. Las notificaciones solo se tocan desde `src/services`. Las pantallas no llaman a `Date.now()` (lo marca la regla de pureza del React Compiler): los repositorios y servicios reciben `now` con valor por defecto.

---

## 12. Interfaz

- Idioma **español (es-ES)**: decimales con coma ("37,5 kg"), fechas "lun 3 nov".
- **Tema oscuro** por defecto (se entrena temprano), alto contraste, **botones grandes** usables con una mano y sudado; en modo entrenamiento, el número de reps y el cronómetro ocupan la pantalla.
- Sin librería de UI pesada: componentes propios con `StyleSheet` y un `theme` central.

---

## 13. Hoja de ruta

Cada fase termina con `npm test`, `npm run lint` y `npx tsc --noEmit` en verde y un build probado en el móvil.

### Fase 0 — Bootstrap
- [x] Proyecto Expo SDK 58 con TypeScript y expo-router en la raíz.
- [x] `tsconfig` estricto, alias `@/` → `src/`, ESLint (`eslint-config-expo`), scripts `test`, `lint`, `typecheck`.
- [x] jest-expo configurado.
- [x] `expo-dev-client`; `app.json`: nombre "Entreno", package `com.fabgs.entreno`, scheme `entreno`, permisos de §6.5, plugin `expo-notifications` con `sounds`.
- [x] Sonido `assets/sounds/rest_end.wav` (generado).
- [x] Build local de APK de release (`expo prebuild` + `gradlew assembleRelease`). En Windows requiere sustituir el `ninja` 1.10.2 del SDK por ≥ 1.12 (ver AGENTS.md → Compilar y probar).
- [ ] Instalada en un Android real.
- [ ] (Opcional) `eas.json` si algún día se usa EAS Build.

**Aceptación**: la app abre en el móvil con las 5 pestañas.

### Fase 1 — Datos y dominio ✅
- [x] Esquema SQL (§10) + migraciones + interfaz `Db`.
- [x] Importación del seed en el primer arranque (§3), incluidas las recomendaciones pendientes iniciales, con test.
- [x] Repositorios (rutinas, slots, sesiones, series, perfil, ajustes, peso, cardio, dieta, recomendaciones).
- [x] `nutrition.ts` + tests (§4).
- [x] `progression.ts` + tests (tabla de §6.2 y casos extra).
- [x] `schedule.ts` (rutina/cardio del día, `buildDailyMessage`, `isoToExpoWeekday`) + tests.
- [x] `workoutMachine.ts` + tests.

**Aceptación**: tests verdes (70); en el primer arranque hay 4 rutinas, 22 ejercicios, 34 alimentos, 145 elementos de dieta y 9 actividades de cardio.

### Fase 2 — Entrenar (MVP) ⭐
- [x] Pantalla Hoy (§6.3) con pesos de cada slot, recomendaciones pendientes y cardio.
- [x] Iniciar/continuar sesión; modo entrenamiento completo (§6.4) con input solo de reps.
- [x] Descanso con notificación programada (§6.5, `alarmClock`), −30/+30/Saltar, deep link.
- [x] Permiso de notificaciones al arrancar; alarmas exactas y batería desde Ajustes → Diagnóstico.
- [x] Corregir reps/borrar serie, serie extra, saltar ejercicio, acceso rápido a editar el peso del slot.
- [x] Añadir un ejercicio a la rutina desde el propio entreno ("+ Añadir ejercicio a la rutina").
- [ ] (Opcional) Ejercicio puntual solo para esa sesión, sin tocar la rutina.
- [x] Al terminar: crear recomendaciones pendientes; resumen con Aplicar / Ignorar / Aplicar todas; pendientes visibles en Hoy y en la primera serie del ejercicio.
- [x] Recuperación tras cerrar la app (estado en `workout_session`).
- [ ] **Verificación en móvil real** (checklist de §14).

**Aceptación (móvil real)**: completar el Día 1 de principio a fin; con el móvil bloqueado el descanso suena a los 2:30 (≤ 3 s de retraso, 10/10); matar la app a mitad de descanso y reabrir → la cuenta atrás sigue bien y la notificación suena; al terminar se proponen los pesos de `recommend()` y el peso del slot **solo cambia al pulsar Aplicar**.

### Fase 3 — Recordatorio diario
- [x] `dailyReminder.ts` + ajustes de hora/activación.
- [x] Reprogramación al arrancar y al guardar ajustes (falta engancharla al editor de rutinas de la fase 4).
- [x] Pantalla de diagnóstico (§7.3) con exclusión de optimización de batería y botones de prueba.
- [ ] **Verificación en móvil real** (checklist de §14).

**Aceptación**: en modo avión y con la app cerrada, la notificación llega a la hora configurada con el texto correcto del día; sigue llegando tras reiniciar el móvil.

### Fase 4 — Editor de rutinas
- [x] Catálogo de ejercicios (`ejercicios.tsx`, `ejercicio/[id].tsx`): buscar, crear, editar, archivar; también sirve de selector al añadir a una rutina.
- [x] Editor de rutina (`rutina/[id].tsx`): crear, renombrar, días, reordenar (↑ ↓), añadir, archivar.
- [x] Editor del ejercicio de la rutina (`slot/[id].tsx`): peso, series, objetivo (rango/fijo/fallo), por lado, unidad, progresión, permitir bajar, incremento y descanso propios, nota, quitar.
- [x] Cardio semanal editable (`cardio.tsx`); la vista calendario está en la pestaña Rutinas.
- [x] Todo cambio de rutinas, días o cardio reprograma el recordatorio diario.
- [ ] Verificación en móvil real.

**Aceptación**: añadir un ejercicio a una rutina, cambiarle el día y la hora → Hoy y la notificación diaria lo reflejan.

### Fase 5 — Historial y progreso
- [x] Lista de sesiones y resumen de cada una (solo lectura).
- [ ] Editar series de una sesión ya terminada.
- [ ] Detalle de ejercicio con tabla, gráficas y récords.
- [ ] Historial de cardio.

### Fase 6 — Perfil y peso
- [x] Aviso en Hoy si falta la fecha de nacimiento; formulario de perfil (la fecha se elige con el calendario nativo de Android, `@react-native-community/datetimepicker`).
- [x] Perfil con cálculos (§4) y registro de peso (lista).
- [ ] Gráfica de evolución del peso.

### Fase 7 — Dieta
- [ ] CRUD de alimentos.
- [ ] Plan semanal editable con "Copiar día a…".
- [x] Totales por comida/día/semana frente a objetivos (§5), en vista de solo lectura.

### Fase 8 — Backup ✅
- [x] Exportar/Importar JSON (restauración atómica, compatible con copias antiguas).
- [x] Auto-backup a GitHub privado (§9) con token en secure-store; subir y restaurar a mano.
- [x] Modo pruebas (§8): borrar datos al instalar un APK nuevo; "Reiniciar datos ahora".
- [ ] Probar la copia en GitHub con un repo y token reales del usuario.

### Fase 9 — Pulido
- [x] Tema oscuro, hápticos, pantalla encendida durante el entreno.
- [ ] Icono y splash propios (ahora son los de la plantilla de Expo).
- [x] Cuenta atrás del descanso en la pantalla de bloqueo (Live Update en Android 16) y burbuja flotante sobre otras apps (`modules/rest-timer`).
- [ ] Revisión de accesibilidad (tamaños de fuente, contraste).

---

## 14. Pruebas

- **Unitarias** (Jest, `src/domain/__tests__`): nutrición, progresión, calendario/mensajes, máquina de estados, conversión de días, formateo es-ES. Son los fixtures de §4, §5 y §6.2.
- **Integración** (`src/db/__tests__`): importación del seed, sesiones y recomendaciones sobre SQLite real en memoria (`node:sqlite` vía `createTestDb()`).
- **Manual en dispositivo** (checklist antes de cerrar las fases 2 y 3):
  - [ ] Descanso suena con pantalla bloqueada (10/10, ≤ 3 s).
  - [ ] Descanso suena con la app cerrada desde multitarea.
  - [ ] −30/+30/Saltar reprograman o cancelan bien (no suena una notificación antigua).
  - [ ] Matar la app durante el descanso y reabrir: estado correcto.
  - [ ] Recordatorio diario en modo avión y tras reiniciar.
  - [ ] Cambiar la hora del recordatorio no deja notificaciones duplicadas.
  - [ ] Modo silencio / No molestar: comportamiento documentado.
  - [ ] Con el móvil bloqueado se ve la cuenta atrás del descanso y desaparece al llegar a 0.
  - [ ] Al salir de la app durante el descanso aparece la burbuja; se puede arrastrar; tocarla vuelve al entreno; desaparece al volver a la app.

---

## 15. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Alarmas retrasadas por Doze o por la capa del fabricante | Permiso de alarma exacta, exclusión de optimización de batería, diagnóstico, Plan B nativo (§7.4). |
| Canales de Android inmutables | Versionar el id del canal al cambiar sonido/importancia. |
| Desfase de convención de días (ISO vs expo) | Conversión única en el borde + test. |
| Pérdida de datos (móvil perdido o reinstalación) | Export JSON y auto-backup GitHub (§9). |
| Migraciones de BD que rompan datos | Migraciones versionadas con `PRAGMA user_version` (`src/db/migrations.ts`), solo se añaden al final; nunca editar una ya publicada; exportar backup antes de actualizar. |
| Datos personales en un repo público | Excel, backups y tokens fuera del repo (`.gitignore`); el seed no incluye fecha de nacimiento. |

---

## 16. Ideas futuras (fuera de alcance)

Registro diario de comidas reales y lista de la compra · estimación de 1RM · deload automático tras estancamiento · temporizador de cardio/HIIT por intervalos · widget de pantalla de inicio con "lo de hoy" · integración con Health Connect (pasos, peso) · versión iOS · horario de estudio del Excel (pestaña "Rutina") como agenda diaria.

---

## 17. Registro de cambios

- 2026-11-01 — Plan inicial y `data/seed/seed.json` generados a partir del Excel. Ninguna fase empezada.
- 2026-11-01 — El peso se define en el slot de la rutina (`routine_slot.weight_kg`); en el entreno solo se introducen reps. Seed con `weightKg` por slot.
- 2026-11-01 — Las recomendaciones de peso **nunca se aplican solas**: quedan pendientes (`weight_change.status = 'pending'`) hasta que pulse Aplicar o Ignorar (resumen, Hoy o primera serie del ejercicio).
- 2026-11-01 — Fases 0–1 completas y fases 2–3 implementadas (pendiente verificar en móvil real). Decisiones: SQL a mano en lugar de Drizzle; rutas en `src/app`; pestañas JS dentro de un Stack; descanso con `delivery: 'alarmClock'`; build local con `expo prebuild` + Gradle (en Windows con ninja ≥ 1.12).
- 2026-11-01 — Las recomendaciones ignoradas siguen como sugerencia aplicable en el ejercicio. Nuevo módulo nativo `modules/rest-timer`: cuenta atrás del descanso en la pantalla de bloqueo y burbuja flotante. Build local desbloqueado sustituyendo el `ninja` del SDK por 1.12.1.
- 2026-11-01 — Probado en emulador Android 16 (API 36.0): importación del seed, entreno con series/descanso/siguiente ejercicio, sugerencia ignorada aplicable, alarma de fin de descanso con `setAlarmClock` (dumpsys: flags 0x3, exacta), cuenta atrás fija pública, burbuja flotante, apertura desde la notificación, recuperación tras un cierre forzado y resumen con nueva recomendación. Encontrado y corregido: `setRequestPromotedOngoing` no existe en Android 16.0 (llega en una versión menor posterior). Falta probar en un móvil real (Doze, capa del fabricante, sonido en silencio).
- 2026-11-01 — Fase 4 implementada: catálogo de ejercicios, editor de rutinas y de cada ejercicio de la rutina, cardio semanal editable y "añadir ejercicio a la rutina" desde el entreno. Los Stepper permiten escribir el valor a mano. La fecha de nacimiento se escribe en DD-MM-AAAA. Historial de git limpiado de datos personales.
- 2026-11-01 — Fecha de nacimiento con el selector de fecha nativo (`DateField`).
- 2026-11-01 — Fase 8: exportar/importar copia, copia automática en GitHub y modo pruebas (borra los datos al instalar un APK nuevo, activado por defecto mientras la app está en pruebas).
