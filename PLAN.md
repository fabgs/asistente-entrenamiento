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
| Base de datos | **expo-sqlite con SQL escrito a mano** (sin ORM). Migraciones en `src/db/migrations.ts` con `PRAGMA user_version`; repositorios tipados en `src/db/repositories/`. | Son 18 tablas sencillas: sin generación de código, ni ficheros `.sql`, ni plugins de Babel. Los repositorios dependen de una interfaz mínima (`src/db/db.ts`) y se testean en Jest con el SQLite integrado de Node 22. *(Se descartó Drizzle el 2026-11-01.)* |
| Estado UI | Datos persistentes → SQLite (fuente de verdad), recargados al enfocar cada pantalla (`useLoader`). El estado del entrenamiento activo (ejercicio actual, fin del descanso, ejercicios saltados) también vive en `workout_session`. | Si la app muere, todo lo importante ya está en la BD. No hace falta Zustand por ahora. |
| Notificaciones | **expo-notifications**, solo **notificaciones locales programadas** (nada de push remoto). El descanso usa trigger `DATE` con **`delivery: 'alarmClock'`** (→ `AlarmManager.setAlarmClock()`). | Funcionan sin internet y con la app cerrada; `setAlarmClock` no lo retrasa Doze. Plan B nativo en §7.4 solo si falla en el móvil real. |
| Gráficas | Propias con **react-native-svg** (`LineChart`, `TrackChart`). *(react-native-gifted-charts se descartó en la fase 5.)* | Control total de marcas, zoom y cursor; sin dependencias pesadas. |
| Silueta del cuerpo | **react-native-body-highlighter 3.2.0** (MIT, JS puro sobre react-native-svg), versión fija y con `overrides` para que use el `react-native-svg` de la app; solo la importa `src/components/BodyMap.tsx`. Fase 17. | Dibujo frontal y trasero, de hombre y de mujer, mucho mejor que uno hecho a mano; sin código nativo. Los trazados no van en el repo. |
| Músculos de los ejercicios | Taxonomía **propia en español** (18 músculos, `src/domain/muscles.ts`) asignada a mano a los 22 del catálogo. Fase 17. | La base pública [exercemus](https://github.com/exercemus/exercises) se tomó solo como referencia: son ~800 ejercicios en inglés, cada uno con su licencia (los de wger, CC-BY-SA), y algunas asignaciones no encajan (Floor Press con el tríceps de principal). |
| Mapa interactivo y 3D | **MapLibre GL JS 5.24** (UMD desde unpkg) dentro de **react-native-webview**: teselas de OpenStreetMap, ortofoto **PNOA** del IGN (satélite) y relieve **Terrarium de Mapzen** en AWS. Fase 12. | Sin claves ni SDK nativo de mapas; relieve 3D como Wikiloc. Necesita internet (el WebView guarda en caché la librería y las teselas). La v6 ya no publica el UMD, por eso la 5.x. |
| Imagen para compartir | **react-native-view-shot** captura una vista a 1080 × 1920 px (o 1080 × 1080, 1.4.3) y **expo-sharing** abre el menú de Android (Instagram, WhatsApp, Drive…). Fase 12. | Sin servidor ni plantillas externas; la vista es la misma que se ve en la vista previa. |
| Fotos de las sesiones | **expo-image-picker** (cámara y selector de fotos del sistema, sin permiso de lectura de la galería) y **expo-image-manipulator** (copia reducida a 2160 px, JPEG 0,85, en `Documents/photos/`). La copia de seguridad lleva las filas, no las imágenes. Fase 20. | Una copia propia no se pierde si el original se borra o se mueve; 2160 px bastan para una historia y una foto ocupa ~0,5 MB en vez de 3–8. Las imágenes en GitHub harían la copia enorme (se deja como idea, §16). |
| Fechas | **date-fns** con locale `es`. | Ligero. |
| Tests | **jest-expo** + @testing-library/react-native. La lógica de dominio es TS puro y se testea sin RN. | |
| Builds | Nunca Expo Go (sonidos de notificación personalizados, canales y permisos lo requieren). **Build local**: `npx expo prebuild --platform android` + `cd android && ./gradlew assembleRelease` → APK firmado con la clave de debug, instalable a mano (ver [README](README.md)). Para desarrollo con recarga en caliente: `npx expo run:android` (incluye `expo-dev-client`). EAS Build es opcional (requiere cuenta de Expo). | |
| Backup online | **Export/Import JSON** (manual) + **auto-backup a un repo privado de GitHub** vía API REST (§9). | Sin servidor, gratis, los datos son míos, y el historial de git da versiones de cada copia. |

Identificadores: nombre visible **"Entreno"**, Android package **`com.fabgs.entreno`**, esquema de deep link **`entreno://`**.

---

## 3. Datos iniciales (seed)

[`data/seed/seed.json`](data/seed/seed.json) se generó a partir del Excel. **El Excel no se sube al repo** (contiene datos personales; está en `.gitignore`).

> **Desde la fase 10, la app compilada no incluye estos datos.** Una instalación nueva solo trae el catálogo de ejercicios y alimentos ([`data/seed/catalog.json`](data/seed/catalog.json), `SEED` en `src/db/seedData.ts`) y ajustes por defecto (recordatorio diario apagado): cada usuario monta sus rutinas, cardio y dieta, y Hoy le guía con «Monta tu semana». El Excel completo (`DEMO_SEED`, `src/db/demoSeed.ts`) son **datos de prueba**: lo usan los tests y el botón «Cargar datos de prueba (Excel)» de Ajustes → Modo pruebas, que solo existe en builds de desarrollo (`__DEV__`; el bundle de release no lo contiene, comprobado con `expo export`). `importSeed` solo actúa si la BD no tiene perfil. Lo que sigue describe lo que carga `DEMO_SEED`.

Contenido:

- `profile`: altura 184 cm, peso 84 kg, hombre, factor actividad 1,5, déficit 400 kcal, 2 g/kg proteína, 1 g/kg grasa, 0,035 L/kg agua. **`birthDate` es `null` a propósito**: se pide en el onboarding.
- `settings`: descanso 150 s, incremento 2,5 kg, modo de progresión `average`, 2 sesiones por debajo para bajar, recordatorio diario 06:00 (el entreno empieza a las 06:30). Una instalación nueva (`SEED`, `src/db/seedData.ts`) trae el recordatorio a las 07:00 y apagado.
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

Campos: sexo, fecha de nacimiento, altura (cm), factor de actividad (selector: 1,2 · 1,375 · 1,5 · 1,55 · 1,725, por defecto 1,5), déficit kcal (por defecto 400; negativo = superávit), g/kg de proteína (2), g/kg de grasa (1), L/kg de agua (0,035), editables desde la 1.4.2 en Objetivos del día. **El peso no se guarda en el perfil**: se usa el último registro de `weight_log`. La columna `profile.name` existe pero no se usa ni se edita (cada instalación es de una persona y nada lo mostraría; decidido en la 1.4.2).

Fórmulas (`src/domain/nutrition.ts`, funciones puras):

```
edad          = años completos entre birthDate y hoy
TMB           = 10·peso + 6,25·altura − 5·edad + 5      (hombre)   ← Mifflin-St Jeor
              = 10·peso + 6,25·altura − 5·edad − 161    (mujer)
gastoTotal    = TMB · factorActividad
kcalObjetivo  = gastoTotal − déficit
proteína (g)  = peso · proteinGPerKg
grasa (g)     = peso · fatGPerKg
carbos (g)    = max(0, (kcalObjetivo − proteína·4 − grasa·9) / 4)   ← y kcalOver = lo que pasan proteína y grasa
agua (L)      = peso · waterLPerKg
IMC           = peso / (altura_m)²
kcal alimento = grasa·9 + carbos·4 + proteína·4
```

> El Excel usaba `6,24·altura` (errata); usamos el coeficiente correcto 6,25 (diferencia ≈ 1,8 kcal).

**Caso de test** (84 kg, 184 cm, 24 años, hombre, 1,5, déficit 400): TMB **1875** · gasto **2812,5** · objetivo **2412,5 kcal** · P **168 g** · G **84 g** · C **246,125 g** · agua **2,94 L** · IMC **24,81**.

Pantalla Perfil (reorganizada en la 1.4.0, tras un debate con agentes: tres propuestas, dos críticos y un juez): «Completa tu perfil» arriba si falta algo; **Esta semana**, los músculos de la semana (§6.9); el **peso corporal** («Registrar peso» abre una hoja con un stepper de 0,1 kg que empieza en el último peso; la gráfica; los 3 últimos pesajes como filas y «Todos los pesajes», que abre `pesos.tsx`: todos por meses, cargando de 30 en 30 al bajar (`listWeightsPage`). Tocar uno, aquí o allí, permite corregirlo o borrarlo con «Deshacer», nunca el único); una fila **Objetivos del día** («Perder 400 kcal» y las kcal objetivo) y al final **mis datos** como filas: fecha de nacimiento con el calendario nativo, altura con − / + y sexo con segmentado. Nada abre el teclado. El engranaje de la cabecera abre Ajustes. Al cambiar el peso se recalculan los objetivos (y la dieta los muestra actualizados).

Pantalla **Objetivos del día** (`src/app/objetivos.tsx`, desde el Perfil y desde el ⋮ de Dieta): la tarjeta de calorías y macros (proteína, grasa, hidratos y agua), el **objetivo** (Perder · Mantener · Ganar con las kcal al día de 50 en 50; por dentro sigue siendo `deficit_kcal` con signo, `src/domain/bodyProfile.ts`) y la **actividad** en una hoja de 5 niveles (de «Sedentaria · 1,2» a «Alta · 1,725»), y debajo metabolismo basal, gasto total e IMC. Objetivo y actividad están aquí para que su efecto se vea en la misma pantalla. Si falta algún dato, «Completa tu perfil» lleva al Perfil.

**Por kilo de peso** (1.4.2, decidido con agentes: tres propuestas, dos críticos y un juez): filas «Proteína · 2 g/kg», «Grasa · 1 g/kg» y «Agua · 35 ml/kg»; cada una abre una hoja con un `NumberRow` (proteína de 0,8 a 3 y grasa de 0,5 a 2, de 0,1 en 0,1; agua de 20 a 60 ml/kg, de 1 en 1: se edita en ml porque los steppers guardan 2 decimales y 0,035 L/kg no se podría volver a poner; se guarda en L/kg), «Al día con 84 kg · 168 g», «Quedan para hidratos · 246 g», «Volver a 2 g/kg» si no es el valor por defecto (`DEFAULT_PER_KG`) y «Listo»; guarda al momento. Sin peso: «Registra tu peso en el Perfil para ver los gramos». Se descartaron niveles con nombre («Alta · 2 g/kg»): meten un criterio que la app no puede respaldar; el número con su efecto en gramos lo entiende cualquiera.

**Hidratos**: si proteína y grasa ya pasan de las kcal del día (mucho g/kg o mucho déficit), el objetivo de hidratos es 0, nunca negativo (antes Dieta enseñaba «de −30» en verde), y Objetivos y sus hojas (también la de Objetivo) avisan con una fila ámbar «No quedan hidratos · Proteína y grasa ya pasan de tus 827 kcal». No se bloquea ni se avisa de «pocos hidratos» (quien hace keto viviría con el aviso).

---

## 5. Dieta

- **Alimentos** (`src/app/alimentos.tsx`, `src/app/alimento/[id].tsx`): catálogo con búsqueda sin tildes; crear, editar y borrar (en la interfaz «Borrar»; por dentro se archiva, así que no desaparece de los días del plan que lo usan, y crear uno con el mismo nombre lo recupera). El editor tiene un «Guardar» abajo y avisa al salir con cambios. Macros por 100 g; las kcal se calculan (9/4/4) y los macros no pueden sumar más de 100 g. Suplementos (creatina, colágeno, omega 3) tienen macros 0 y se muestran igual.
- **Plan semanal** (pestaña Dieta): un selector de día (L–D) y las cuatro comidas (desayuno, comida, merienda, cena) como listas, con los gramos y las kcal alineados en columnas. «Añadir alimento», al final de cada comida, abre el catálogo en modo selector y los gramos se eligen en una hoja. Tocar un alimento abre una hoja con los gramos (±10 g), «Guardar» y «Quitar», que se deshace desde el aviso. **«Copiar el <día> a…»** (menú ⋮) reemplaza el plan de los días elegidos por el del día actual, también con «Deshacer». En el mismo ⋮, «Objetivos del día» abre su pantalla (§4).
- **Totales**: del día o la media semanal (segmentado), frente a los objetivos del perfil, en una rejilla 2 × 2 (Calorías · Proteína / Grasa · Hidratos) con «de 2412», un icono y una barra de color según la desviación (`deviation()` en `src/domain/nutrition.ts`): verde ±5 %, ámbar ±10 %, rojo fuera. Sin objetivos, una fila «Completa tu perfil».
- **Casos de test con el seed**: Lunes = G 94,66 · C 247,39 · P 157,71 · **2472,34 kcal**. Media semanal = G 77,53 · C 236,40 · P 166,28 · **2308,45 kcal** (idéntico al Excel).

---

## 6. Entrenamiento (núcleo)

### 6.1 Conceptos

- **Ejercicio** (`exercise`): catálogo. `type`: `external` (barra/mancuerna; el peso es la carga externa, por mancuerna si son dos) o `bodyweight` (el peso es el **lastre**; 0 = sin lastre).
- **Rutina** (`routine`): un día de entreno ("Día 1: Torso…") asignado a uno o varios días de la semana.
- **Slot** (`routine_slot`): un ejercicio dentro de una rutina con su prescripción: **peso actual**, series, objetivo de reps, progresión, descanso, nota. **El peso vive aquí**: durante el entreno no se introduce, solo se registran reps. El mismo ejercicio puede aparecer en varias rutinas con prescripciones distintas (p. ej. *Toes to bar* al fallo el martes y 10–12 el viernes).
- **Sesión** (`workout_session`): una ejecución de una rutina en una fecha. Es **suelta** (1.3.4) si no tiene rutina (`routine_id` NULL): sus ejercicios son slots prestados de las rutinas, cada uno con su peso y su prescripción (§6.4, «Ejercicio suelto»).
- **Serie** (`set_log`): reps registradas + **copia del peso del slot** en ese momento (para que el historial no cambie cuando el slot suba de peso).
- **Serie de aproximación** (`set_log.is_warmup = 1`, fase 12): calentamiento con **su propio peso** y reps. Se guarda y se ve aparte, pero **nunca cuenta**: ni como serie hecha (`setsDone`), ni para el volumen, los récords, el número de series del historial o la progresión (`slotHistory`). Se numeran aparte (A1, A2…) y sí cuentan para la duración. «Calentamiento» queda para las fases del cardio.

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

1. **Resumen de una sesión** para el slot: `peso de trabajo` = peso copiado en sus series (`set_log.weight_kg`, `null` cuenta como 0); `reps` = reps de todas sus series (las series extra cuentan; las de aproximación no).
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
   - Si no → `keep` con aviso: «si se repite, te sugerirá bajar» cuando falta una sesión, y «si sigue así dos sesiones más, te sugerirá bajar» cuando faltan más (1.4.2; antes decía «si se repite» aunque faltaran dos).
   - Motivo de esperar 2 sesiones: en el Excel, tras una sesión floja se mantenía el peso (hip thrust, laterales).
9. Por debajo sin `allowDecrease` → `keep`. En rango → `keep`; en modo `strict`, el motivo dice cuántas series llegaron al máximo («2 de 3 series en 12 o más», «Ninguna serie en 12 o más»): con 14, 12 y 11 la media (12,3) ya pasa de 12 y decir «dentro de 10–12» era falso (arreglado en la 1.4.2).
10. **Reglas editables** (1.4.2, Ajustes → «Sugerencias de peso», §8): incremento por defecto (de 0,25 a 10 kg, de 0,25 en 0,25: llega a un disco de 1,25 en el cinturón; los editores de ejercicio y de ejercicio de la rutina usan el mismo paso), cuándo subir (`average` «La media pasa del máximo» / `strict` «Todas las series llegan al máximo»: no es «más estricto», con 12, 12 y 12 en 10–12 sube solo `strict` y con 14, 12 y 11 solo `average`) y cuándo bajar (de 1 a 4 sesiones seguidas). Valen **desde el próximo entreno**: las sugerencias abiertas no se recalculan (recalcularlas aplicaría a la vez otros cambios del ejercicio hechos después, como el rango, y rompería el «Deshacer» de las aplicadas; una instalación nueva no tiene ninguna abierta). `getSettings` limpia valores imposibles de una copia (`sanitizeProgression`: incremento ≤ 0, modo desconocido, sesiones fuera de 1–4).
11. Los motivos «Se mantiene» del resumen se recalculan con las reglas actuales; si con ellas la sesión pediría un cambio (y su sugerencia ya caducó), no se enseña ninguno, para no decir «Se mantiene: media por encima de 12».

**Aplicación: nunca automática.** Al terminar una sesión, para cada slot hecho se llama a `recommend()` y, si es `increase` o `decrease`, se crea una **recomendación pendiente** en `weight_change` (`from_kg`, `to_kg`, `reason`, `session_id`, `source = 'progression'`, `status = 'pending'`). `routine_slot.weight_kg` **solo cambia cuando pulso "Aplicar"** (`status = 'applied'`); "Ignorar" la pasa a `status = 'dismissed'`, **pero no desaparece**: se queda en el propio ejercicio como **sugerencia discreta** ("Sugerencia: ↑ 37,5 kg · Aplicar") que se puede aplicar en cualquier momento. Justo después de aplicar hay "Deshacer" (restaura `from_kg` y vuelve a `pending`). Las recomendaciones "abiertas" son las `pending` y las `dismissed` (`listOpenChanges`).

- Una recomendación `pending` se muestra como caja destacada (Aplicar / Ignorar) en el resumen, en Hoy y en la primera serie de ese ejercicio en el entreno (§6.3, §6.4). Una `dismissed` (o una pospuesta con "Ahora no") se muestra como sugerencia discreta en Hoy, en Rutinas, en el entreno y en el editor del ejercicio.
- Si termino otra sesión de ese slot, la recomendación abierta anterior (pendiente o ignorada) pasa a `expired` y, si toca, se crea la nueva (calculada con el peso que realmente usé).
- Un **ejercicio suelto** (§6.4) cuenta para su slot como cualquier sesión, con una excepción: si de una sesión suelta sale «mantener» (p. ej. unas series sueltas a medias), la recomendación abierta del slot **no caduca** (`proposeForSlot(…, expireOnKeep)`). Así unas series sueltas no borran el «Subir a 37,5 kg» de la rutina.
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

- La fecha es el título de la cabecera («Martes, 3 de noviembre», en una línea); con el modo pruebas activo, a su lado la etiqueta ámbar **«Pruebas»**, que abre Ajustes. Dos grupos: **«Para hoy»** (primero el cardio pendiente, luego la rutina) y **«Hecho»**. *(Fase 10; rediseño en la fase 12.)*
- **Rutina de hoy** (según `routine_weekday`), plegada (`RoutineCard`, la misma que en Rutinas): icono, título, «6 ejercicios · 15 series», la etiqueta ámbar «2 sugerencias» y el botón **«Empezar rutina»** (o **«Continuar entreno»**, solo si esa rutina es la que está en curso; con otro entreno en curso, «Empezar rutina» avisa «Hay un entreno en curso»), que abre directamente la serie que toca (§6.4). El chevron despliega los ejercicios con el peso a la derecha y cada sugerencia pendiente como decisión («Subir a 37,5 kg» / «Mantener 35 kg», con su motivo en una frase), y «Aplicar las 2».
- **Cardio de hoy**: una fila con el icono del tipo, «Caminar · 5 km» y la intensidad, un círculo para marcarlo sin grabar (el mismo ✓ redondo que una rutina hecha) y **«Iniciar»** en las de GPS o temporizador (§6.8).
- Con todo lo del día hecho, «Todo hecho por hoy» y una frase de ánimo que cambia cada día (`allDoneMessage`, `src/domain/schedule.ts`); lo extra cuenta, así que un día de descanso con una caminata del pool también lo muestra. Sin nada programado ni hecho, «Día de descanso». «Monta tu semana» solo sale sin rutinas y sin cardio.
- **Hecho**: check verde, el título de la sesión, el resultado («5,14 km · 59 min») y un chevron al resumen o al detalle. Nada tachado. Una fila por entreno terminado hoy (`finishedSessionsOn`: también la misma rutina dos veces o uno suelto, «Remo con barra (90º) y 1 más»), luego el cardio de hoy y después el de otros días hecho hoy, con su ✓ para desmarcarlo (1.3.4).
- Perfil incompleto: la fila «Completa tu perfil» al final de «Para hoy».
- **Hacer otra cosa** (1.3.4; diseñado con agentes: propuestas, dos críticas y un juez): al final, un grupo con tres filas que solo salen cuando sirven:
  - «Hacer otro cardio» (si no hay un cardio en curso): una hoja con el **pool** del cardio de la semana que hoy no toca (§6.8), una fila por actividad con su objetivo, cómo se registra y sus días («Bici estática · 30 min · LISS · continuo suave · Lunes»). Tocarla marca las de Marcar e inicia las demás, con las mismas exclusiones que «Para hoy».
  - «Entrenar otra rutina» (si no hay un entreno en curso): una hoja con las demás rutinas («Lunes y jueves · 6 ejercicios»); no empieza nada hasta elegir una.
  - «Hacer un ejercicio suelto» (si no hay un entreno en curso y las rutinas tienen ejercicios): abre el selector (§6.4). Con sprints o Fases en curso, avisa antes de abrirlo.
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

- **EXERCISE_LIST**: arriba «12 min · 4 de 15 series» y una barra de progreso; los ejercicios como filas con «10 kg · 8–12 reps por lado» (y «· 2 aprox.»), un punto por serie (verde si está hecha) y las etiquetas «Siguiente» o «Saltado». Se puede elegir **cualquiera** (orden libre). Abajo, fijo, «Empezar · Sentadilla búlgara» / «Seguir · …»; con todo hecho, «Terminar y ver resumen». «Añadir ejercicio a la rutina» es la última fila (del catálogo; siempre lo añade a la rutina) y «Descartar entreno» va en el ⋮.
- **SET_INPUT**: nombre y «Serie 2 de 3» (con «+ Aproximación» a la derecha hasta la primera serie efectiva), las aproximaciones hechas, el **SetTracker** (una celda por serie, hasta 6 por fila: las hechas con sus reps, la actual con las reps del stepper en verde y las pendientes con «–»; tocar una hecha la corrige en una hoja) y, debajo, la **ficha de la serie** (una superficie con separadores, *fase 13*): el **peso del slot** en grande («37,5 kg», «Lastre 15 kg» o «Peso corporal»; toda la fila abre la hoja «Cambiar peso», stepper del incremento que vale también para las próximas sesiones, `setSlotWeightManually`), la sugerencia si la hay, «Objetivo | Última vez» en dos columnas («10–12 reps», con «Por lado» debajo si toca; «14 · 14 · 14» con la de esta serie resaltada) y la nota (2 líneas; si se corta, se despliega al tocarla). Abajo, fija, la barra con las **reps** (stepper grande, precargado con las de esa serie la última vez o el mínimo del rango; se pueden escribir) y **«Serie hecha»**, que guarda `set_log` (reps + copia del peso del slot) **inmediatamente**. Si el slot tiene una sugerencia pendiente, antes de la primera serie un botón ancho bajo el peso («Subir a 37,5 kg», con su motivo dentro) la aplica y pasa a «Deshacer» en el mismo sitio y con la misma altura; desde la primera serie, o si se ignoró, queda la línea discreta «Sugerencia: subir a 37,5 kg · Aplicar», que al aplicarla pasa a «Ahora 37,5 kg · Deshacer». Se puede deshacer hasta la siguiente serie (no después de cambiar el peso a mano); si no se toca, sigue pendiente para Hoy y el resumen. Como en la barra inferior, los toques se ignoran 600 ms tras cada cambio y mientras se guarda, así que un doble toque no aplica y deshace. El ⋮ lleva Saltar ejercicio (con «Deshacer»), Añadir aproximación (desde la primera serie efectiva) y Editar ejercicio de la rutina.
- **RESTING**: anillo de 264 dp que se vacía con la cuenta atrás en el sentido de las agujas del reloj (el hueco avanza desde las 12), en una animación continua de Reanimated en el hilo de la interfaz (se vuelve a sincronizar al volver a la app) (2:30 por defecto; `slot.restSeconds ?? settings.restSecondsDefault`) y «de 2:30»; al llegar a 0 se pone verde y cuenta el tiempo de más («+0:35») en ámbar. Debajo, «Serie 1 hecha · 10 kg × 14», que abre su corrección sin parar la cuenta atrás ni reprogramar la alarma, y «Siguiente: Remo con barra · Serie 2 de 3 · 10 kg» («Primera serie» solo si ese ejercicio no tiene ninguna hecha). Abajo, fijos, «−30 s» / «+30 s» y «Saltar descanso», que al llegar a 0 pasa en el mismo sitio a **«Siguiente serie»** / **«Siguiente ejercicio»**. Tras la **última serie del último ejercicio** no hay descanso: se ofrece terminar.
- **Doble toque**: la barra inferior ignora los toques durante 600 ms cada vez que cambia de acción (`BottomBar` con `actionKey`), así que un doble toque en «Serie hecha» registra una sola serie y deja el descanso en marcha.
- Corregir o borrar series ya hechas (en una hoja; «Borrar» deja un aviso con «Deshacer» que la recupera con el mismo número, `restoreSet`) y añadir **serie extra**.
- **Aproximación** (fase 12): mientras el ejercicio no tenga series efectivas, «+ Aproximación» a la derecha de «Serie 1 de N» (después, en el ⋮) abre una hoja con el peso y las reps propuestos (`warmupProposal`, `src/domain/warmup.ts`: los de esa aproximación la última vez o, si no hay, 50 % × 10, 70 % × 5 y 85 % × 3 del peso de trabajo, redondeados hacia abajo al incremento). Guardarla no inicia el descanso ni cambia la serie en curso. Se ven como píldoras azules (A1, A2…) que se corrigen o borran tocándolas. El resumen las lista aparte y calcula series y volumen sin ellas («Sin contar 2 aproximaciones»).
- **Empezar** (fase 12): «Empezar rutina» y «Continuar entreno» abren directamente la serie del ejercicio en curso o del primero pendiente (`slotToOpen` en `workoutMachine.ts`, `openNextSet`); si se está descansando, el descanso. Atrás lleva a la lista, como siempre.
- **Atrás** (botón del sistema o de la cabecera) durante una serie o un descanso lleva a la **lista de ejercicios**; desde la lista sale a Hoy. Durante el descanso la lista muestra abajo, en lugar del botón, una mini barra con el anillo y la cuenta atrás que vuelve al temporizador; elegir ahí un ejercicio pendiente lo convierte en el siguiente sin cortar el descanso (`usePreventRemove`). Las notificaciones abren rutas con `router.navigate`, que vuelve a la pantalla si ya está abierta en vez de apilar otra copia. *(Fase 10.)*
- Al completar todas las series, la lista muestra la tarjeta **«Rutina completada»** (ejercicios, series, tiempo) con «Terminar y ver resumen»; las confirmaciones usan el diálogo propio de la app (`showDialog`, `src/components/Dialog.tsx`), nunca la alerta del sistema.
- **Ejercicio suelto** (1.3.4; `src/app/ejercicio-suelto.tsx`): un selector con buscador y una sección por rutina («Remo con barra (90º) · 3 × 10–12 reps · 35 kg») empieza una sesión suelta (`startLooseSession`) y abre su primera serie. Cada ejercicio se entrena con **su** slot: peso, series, objetivo, descanso, nota, aproximaciones y sugerencia. La cabecera y la notificación dicen «Ejercicio suelto»; lo terminado se llama como el primer ejercicio («Remo con barra (90º)», «… y 1 más»; `workoutTitle`). En la lista, «Añadir otro ejercicio» (fuera del descanso) abre el mismo selector sin los que ya están (`addLooseExercise`). Los ejercicios de la sesión son los de sus series más el que está en curso (`looseSlotIds`), así que uno que se deja con Atrás sin ninguna serie desaparece, y una sesión suelta sin series se descarta al salir o al terminarla. No hay «Saltar ejercicio». «Cambiar peso» cambia el del slot y lo dice: «También en «Día 1: …»». Con todo hecho, «Ejercicio completado» o «Ejercicios completados».
- **"Terminar entrenamiento"**: marca la sesión como `finished` y **crea las recomendaciones pendientes** (§6.2) en la misma transacción. No cambia ningún peso.
- **SUMMARY** (`app/workout/resumen/[sessionId].tsx`): cabecera con compartir y ⋮ (Corregir series, Borrar entreno); título editable (`workout_session.title`, vacío = nombre de la rutina) con la fecha y la hora; Duración · Series · Volumen (Σ peso × reps de ejercicios con carga, sin aproximaciones; con dos mancuernas, ×2); con 2 o más sugerencias, una fila «2 sugerencias · 1 sube · 1 baja» con el botón «Aplicar las 2». Una tarjeta por ejercicio con su nombre (→ progreso), las series agrupadas por peso («35 kg × 15, 15 · 37,5 kg × 12», `formatSetGroups`), las aproximaciones aparte y la **sugerencia** como decisión («Subir a 37,5 kg» / «Mantener 35 kg», con el motivo en una frase, sin símbolos); nada viene marcado por defecto y lo que no decida queda pendiente. Los slots sin cambio muestran «=» y su motivo. Al terminar el entreno, abajo «Compartir» y «Listo».
- **Pantalla siempre encendida** durante el entreno (expo-keep-awake, configurable). Hápticos en "Serie hecha" y fin de descanso.
- **Resistente a cierres**: la sesión, sus series y el estado del descanso (`rest_ends_at`) están en la BD. Al reabrir, se reconstruye el estado y la cuenta atrás continúa correctamente.

### 6.5 Descanso en segundo plano (requisito crítico)

Diseño (`src/services/restTimer.ts`):

1. Al pulsar "Serie hecha": `endsAt = Date.now() + restSeconds·1000`.
2. **Programar una notificación local con trigger de fecha en `endsAt` y `delivery: 'alarmClock'`** (canal `rest-timer-v1`, identificador `rest-<sessionId>`, título "¡Descanso terminado!", cuerpo "Siguiente: Serie 3/3 · Remo con barra · 37,5 kg", `data.url = /workout/<sessionId>`). La programa el sistema operativo, así que **suena con la pantalla bloqueada, con la app en segundo plano e incluso si el proceso muere**.
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
- **Entreno en curso** (1.3.4): mientras haya un entreno sin terminar, el mismo servicio muestra una notificación fija (canal `activity-ongoing-v1`, «Entreno en curso», sin sonido) con el nombre de la rutina, lo que toca («Serie 2 de 3 · Remo con barra · 37,5 kg», o «4 de 19 series» en la lista) y el tiempo del entreno contando hacia arriba; tocarla vuelve a la app. Sin burbuja. La cuenta atrás del descanso se pone encima y, al llegar a 0 o al saltarla, vuelve la del entreno. La pantalla del entreno la actualiza con cada cambio (`src/services/workoutInProgress.ts`), el arranque de la app la repone si quedó un entreno abierto, y terminar o descartar el entreno la quita.
- API JS (`modules/rest-timer/index.ts`): `startRestCountdown(endsAt, title, body, overlay)`, `stopRestCountdown()` (vuelve a la actividad en curso si la hay), `startOngoing(startedAt, title, body)`, `stopOngoing()`, `canDrawOverlays()`; `restTimer.ts` y `workoutInProgress.ts` la llaman.

### 6.6 Historial y progreso

- Pestaña **Historial**: segmentado **Entrenos · Ejercicios · Cardio** que recuerda la vista, y listas por mes con filas: entreno (→ resumen; título de la sesión, «Vie 30 oct · 11 series · 58 min», la rutina si el título es otro y la etiqueta «Importado» si viene del Excel), ejercicio (sesiones, última fecha y peso máximo → progreso), caminata (miniatura de la ruta, distancia y tiempo → detalle; la miniatura de 48 dp va centrada en la columna de 40 dp de los iconos, así todos los títulos empiezan en el mismo sitio) y cardio solo marcado («Hecho»).
- **Progreso de un ejercicio** (`src/app/progreso/[id].tsx`, de todas las rutinas): una sola gráfica (`src/components/LineChart.tsx`) con segmentado **Peso · Reps** que se recuerda, lectura fija alineada con el área de la gráfica (la cifra empieza donde empieza la línea y la fecha acaba sobre la última fecha del eje; igual en la del peso corporal) y paso entero en reps (`niceScale`); récords en una rejilla (mejor peso, más reps, mayor volumen; `src/domain/progress.ts`) sin repetir la misma serie; sesiones (→ resumen) y cambios de peso decididos como filas. Se llega desde Historial, el resumen, el editor del ejercicio de la rutina y el del catálogo.
- **Corregir un entreno terminado** (resumen → ⋮ → «Corregir series»): las series de cada ejercicio como celdas; tocar una abre una hoja con reps y peso, «Guardar» y «Borrar» (con «Deshacer»). Después se recalcula la recomendación de esa sesión (`refreshRecommendations`) solo si sigue siendo la sesión más reciente de ese ejercicio y su recomendación no se aplicó ya; si se borran todas las series de un ejercicio, su recomendación caduca. El resumen agrupa las series por ejercicio a partir de las propias series, así que un ejercicio quitado de la rutina sigue apareciendo en sus entrenos pasados.

### 6.7 Editor de rutinas y ejercicios

- **Rutinas** (pestaña): arriba la tarjeta **Semana**, plegada por defecto (1.3.4) en una tira de 7 días con la letra y un icono (mancuerna si hay rutina, figura corriendo si solo hay cardio, sofá si es descanso; hoy resaltado), y desplegada con el chevron junto al título en un día por fila con lo que toca (se recuerda mientras la app está abierta); tocar un día abre su editor (`cardio.tsx?dia=N`: las rutinas de ese día como casillas, que se guardan al momento, y su cardio) y «Editar cardio» abre el de toda la semana (`cardio.tsx`). Después, las rutinas plegadas (`RoutineCard` en modo Rutinas: días, ejercicios y series, sugerencias pendientes y un lápiz que abre su editor; desplegada, cada ejercicio es una fila con su icono, el nombre, el peso como cifra a la derecha y la prescripción debajo (`SlotRow`, 1.4.1), abre el suyo y su sugerencia va en una caja con «Aplicar» dentro, pegada a él) y las filas «Series por músculo» (§6.9) y «Catálogo de ejercicios». El «+» de la cabecera crea una rutina: pide el nombre en un diálogo y solo la crea al confirmar.
- **Editor de rutina** (`rutina/[id].tsx`): el nombre se cambia tocando el título; los días (`DayPicker`) y el orden (modo «Ordenar») se guardan al momento; los ejercicios con la misma fila que las tarjetas (`SlotRow`; el icono ocupa el sitio del antiguo número de orden, también en «Ordenar»); añadir ejercicios desde el catálogo; «Borrar rutina» en el ⋮ (desaparece de Rutinas y de la semana, los entrenos hechos siguen en el historial; por dentro `archived = 1`).
- **Ejercicio de la rutina** (`slot/[id].tsx`, con el nombre del ejercicio como título y el de la rutina debajo; la prescripción ya no se repite ahí desde la 1.4.1, porque está justo debajo en sus controles): **peso actual** (se registra como cambio `manual` solo si cambia), series, objetivo `range`/`fixed`/`failure`, por lado, unidad, progresión `load`/`manual`, permitir bajada, incremento y descanso propios y nota, con `NumberRow`, `DurationField` y segmentados. Un único «Guardar» abajo, deshabilitado sin cambios, que guarda y vuelve; al salir con cambios, «¿Guardar los cambios?». En el ⋮, «Quitar de la rutina» (soft delete: `archived = 1`, conserva el historial); el ejercicio se borra desde su editor del catálogo. La fila «Últimas sesiones» abre el progreso.
- **Catálogo de ejercicios** (`ejercicios.tsx`, `ejercicio/[id].tsx`): buscador (por nombre o por músculo: «bíceps» encuentra el curl y las supinas; igual en «Ejercicio suelto») y filas por orden alfabético con el icono de su movimiento y sus músculos principales debajo (§6.9); el «+» crea uno. Nombre, tipo, material, **músculos principales y secundarios** (dos filas que abren una hoja con chips por grupo; un músculo es principal o secundario, no ambos), incremento propio y notas, con el mismo «Guardar»; «Borrar ejercicio» en el ⋮ (se archiva: nunca se pierde su historial). Con `?sinMusculos=ids`, el catálogo muestra solo esos ejercicios mientras sigan sin músculos («Sin músculos»).
- **Cardio semanal** (`cardio.tsx`): por día, las actividades como filas (icono del tipo, «Caminar · 5 km» e intensidad) y «Añadir actividad». Cada actividad se edita en su pantalla (`cardio/actividad/[id].tsx`; `id` es un número o `nueva`, con `?dia=N` al crear): nombre, objetivo, intensidad, cómo se registra (Marcar · GPS · Fases · Sprints; «Fases» es el temporizador) y su plan: el del temporizador (LISS · MISS · HIIT) o el de los sprints (cuántos, de 1 a 20, y el descanso, de 0:30 a 10:00, 1:30 por defecto); «Añadir» o «Guardar» abajo y «Quitar actividad» en el ⋮, al momento y con «Deshacer».
- Las escrituras se encolan (`src/hooks/editing.ts`, para que dos toques rápidos no abran dos transacciones) y cualquier cambio aquí llama a `rescheduleDailyReminders()` (§7).

### 6.8 Cardio con seguimiento (fase 10)

Cada actividad de cardio tiene un **tipo de seguimiento** (`cardio_activity.tracking`): `check` (solo marcar, como hasta ahora), `gps` (caminar, correr) o `timer` (bici, HIIT). En Hoy, las de GPS y temporizador muestran **«Iniciar»**, que abre `src/app/cardio-sesion/[id].tsx`. Una sesión (`cardio_session`) se guarda en la BD desde el principio, así que sobrevive a que se cierre la app, igual que el entreno de fuerza. Al terminarla se marca el cardio del día en `cardio_log` con el resumen («5,2 km · 58 min» o «30 min») y el enlace a la sesión.

**GPS** (`src/services/gpsTracker.ts`, `expo-location` + `expo-task-manager`):
- `Location.startLocationUpdatesAsync` con *foreground service* (notificación fija «Grabando la ruta»), precisión alta, un punto cada 3 s sin mínimo de distancia (`WALK_GPS`; los sprints, cada segundo). La tarea (`TaskManager.defineTask`, definida al cargar el módulo) solo **añade puntos** a `cardio_point`; así sigue grabando con la pantalla bloqueada y la app en segundo plano. Solo pide la ubicación **mientras se usa la app**: el servicio en primer plano basta y la ubicación en segundo plano está desactivada en `app.json` (fase 10).
- Pausar detiene la grabación; al reanudar empieza un **tramo** nuevo (`segment`), y la distancia nunca une tramos.
- Distancia, velocidad y ritmo los calcula la función pura `summarizeTrack()` (`src/domain/gps.ts`, con tests): descarta puntos con precisión peor de 30 m, saltos imposibles (> 10 m/s) y el ruido de estar parado (movimientos menores que la precisión). Velocidad media = distancia / tiempo en movimiento (sin pausas). Ritmo en min/km.
- Al terminar, la ruta se guarda **comprimida** (polilínea codificada, `encodePolyline`) en `cardio_session.route` y un **perfil** con una muestra cada 10 s de actividad (segundos activos, metros acumulados y altitud, `buildSamples`) en `cardio_session.samples`; después se borran sus puntos. Una caminata de 1 h ocupa ~10 KB en la copia de seguridad en vez de miles de filas.
- **Detalle de una caminata** (fase 12): cabecera sin título (compartir y ⋮ con «Borrar caminata»); título editable (`cardio_session.title`; vacío = nombre de la actividad) con la fecha y la hora; **panel de métricas** (`MetricBoard`, `src/domain/walkStats.ts`): una cifra grande y una rejilla en la que cada dato tiene su celda fija (`gridMetrics`); tocar una celda sube su dato a la cifra grande y deja la distancia en su sitio, y tocar la distancia grande cambia km ↔ metros (5,14 km ↔ 5142 m); ambas cosas se recuerdan (`settings.cardio_hero`, `settings.distance_unit`). Mapa de 240 dp con **3D** y **ampliar** en la esquina (tocarlo abre la pantalla completa en el último modo usado); justo debajo **una sola gráfica** (`TrackChart`) con selector Ritmo · Velocidad · Altitud que se recuerda (`settings.cardio_chart`), por distancia (velocidad: media móvil de 30 s, `speedSeries`; ritmo: la misma, con huecos por debajo de 2 km/h y el eje invertido; altitud: media móvil, desnivel con histéresis de 3 m, `altitudeProfile`/`elevationChange`), escala Y por percentiles 2–98 (`percentileRange`) y encima, dos datos con la etiqueta sobre la cifra (`chartSummary`): «Ritmo medio» y «Mejor km» (el km completo más rápido), «Velocidad media» y «Máxima» (percentil 95) o «Subida» y «Bajada»; en directo, «Ahora» y la media; con un punto elegido, su valor y «Punto 2,31 km · 24:10». «Altitud aproximada, del GPS» va debajo de la gráfica. Un toque o un arrastre horizontal mueve el cursor y lo marca en el mapa (`positionAtDistance`, como mucho cada 50 ms); un arrastre vertical desplaza la página; pellizcar o doble toque amplía el eje X y «Ver todo» vuelve a la ruta entera (`zoomRange`, `src/domain/trackChart.ts`). Debajo, los **parciales por km** en tabla (`kmSplits`, diferencia con el ritmo medio y «Más rápido»); tocar uno amplía la gráfica a ese km. En el historial de cardio cada caminata lleva una miniatura de su ruta.
- **En directo**, sin scroll: la píldora del GPS es el título de la cabecera («GPS ±5 m», «GPS débil ±18 m», «Sin señal de GPS», «En pausa»); el panel de métricas (ritmo y velocidad de los últimos 30 s, «–» en pausa o antes de 50 m) y un segmentado **Mapa · Gráfica · Parciales** que se recuerda (`settings.cardio_live_panel`) con un panel que ocupa el resto (los parciales, con el km en curso arriba). La gráfica y los parciales se recalculan con cada lectura de puntos (`walkSnapshot`, cada 3 s), no con el reloj. Abajo, fijos, «Pausar» (un toque, vibra) y «Terminar» («¿Terminar y guardar?» · Guardar / Seguir caminando); en pausa, «Seguir» en el mismo sitio. Vibra al cerrar cada km si la app está delante. «Descartar caminata» va en el ⋮.
- **Mapa a pantalla completa** (`src/app/ruta/[id].tsx`, `InteractiveMap`): MapLibre GL JS 5.24 en un WebView, con versión fija y `integrity`; teselas raster de 128 px (un nivel de zoom más, más nítidas) y `raster-brightness-max` 0,62 para que se vea como el mapa del detalle. Mover, ampliar, girar e inclinar; «2D · 3D» arriba a la derecha (relieve con exageración 1,5 y sombreado), capas Mapa/Satélite (PNOA, solo España, con un aviso de 1,5 s), ver la ruta entera y norte; marcas de cada km. Abajo, una hoja fija plegada (selector y lectura) que se despliega con la gráfica sincronizada; la cámara solo se mueve si el marcador sale del 80 % central. En directo sigue tu posición (la hoja plegada muestra Distancia · Tiempo · Ritmo) y, si mueves el mapa, aparece «Recentrar». Sin conexión: «Sin conexión» con «Reintentar»; el mapa estático del detalle sigue funcionando.
- **Imagen para compartir** (`src/app/compartir/[tipo]/[id].tsx`, `src/components/ShareCard.tsx`, `src/services/shareImage.ts`): con el título (se guarda como título de la sesión), fecha y hora, la ruta y distancia, tiempo, ritmo medio y desnivel; estilos **Mapa** (teselas con degradado; sin conexión se deshabilita, `canLoadMapTiles` en `src/services/network.ts`), **Foto** (1.4.3, si la sesión tiene fotos, y entonces es el de partida: la foto de fondo, oscurecida arriba y abajo, con los textos y la ruta en blanco; con varias, una fila de miniaturas para elegir), **Oscuro** y **Sin fondo** (PNG transparente para pegar encima de una foto). **Formato** (1.4.3): **Historia · 9:16** (1080 × 1920) o **Cuadrado · 1:1** (1080 × 1080, con los textos al 80 %); Sin fondo tiene su tamaño (1080 × 1100). La marca «ENTRENO» y «© OpenStreetMap» van en la última línea, pegadas abajo (antes quedaban debajo de las cifras con un hueco vacío debajo, aviso del usuario). Del entreno de fuerza: título, duración, series, volumen y cada ejercicio con su peso y reps (sin aproximaciones; 6 en la historia, 5 en el cuadrado). Textos con `shareType` (px de la imagen) y sin escalar con la fuente del sistema. Abajo, «Guardar» (en la galería con `expo-media-library`; solo pide añadir fotos, y desde Android 10 ni eso) y «Compartir» (`expo-sharing`); los dos esperan a que carguen las teselas o la foto.
- Mapa (`src/components/RouteMap.tsx`): la ruta en SVG sobre las teselas de OpenStreetMap (`tile.openstreetmap.org`, con su atribución y un User-Agent propio, como pide su política de uso), pedidas un nivel de zoom más cerca y pintadas a 128 dp para que se lean las calles (`tilesFor` con `detail`; en la imagen, round(log2(PixelRatio))), con un velo de 0,38 para el tema oscuro; sin internet se ve la ruta sobre el fondo de la app. Sin SDK de mapas ni claves de API. *(CARTO se descartó: sus teselas ya exigen clave.)*

**Sprints** (1.3.4; `cardio_activity.tracking = 'sprint'`; diseñado con agentes: cuatro propuestas, tres críticos y un juez). Un pitido da la salida y el atleta toca «Parar» al terminar; el GPS mide la distancia y la velocidad máxima.
- **Estado** (`src/domain/sprint.ts`, puro y con tests): toda la sesión es su lista de vueltas (`cardio_session.laps`, JSON `[[salida, parada, metros, punta, calidad], …]`); como mucho la última está abierta, y si su salida aún no ha llegado es una salida pendiente. De ahí salen los estados *Listo*, *cuenta atrás* (los últimos 5 s), *Corriendo*, *Descanso* y *Hechos* (`sprintState`), y las transiciones puras `goNow`, `cancelGo`, `stopLap`, `shiftRest`, `dropLastClosed`, `dropOpen`, `extraSprint` y `closeForFinish`. Cada acción se escribe con bloqueo optimista (`setSprintLaps` solo escribe si las vueltas siguen como se leyeron), así que un doble toque escribe una vez.
- **Flujo**: «Empezar sprint» → cuenta atrás de 5 s (vibra a 3, 2 y 1) → **pitido** = salida y crono en décimas → «Parar» (un panel verde enorme abajo, que para al tocar, ignora los toques de los primeros 600 ms y, entre 0,6 y 3 s, anula la salida con «Deshacer») → descanso con el anillo del gimnasio (±30 s, «Saltar descanso» deja la salida a 5 s) → el pitido del final del descanso es la salida del siguiente. Tras el último, *Hechos* con «Otro sprint» y «Terminar»; antes, «Terminar» (o «Terminar ahora» en el ⋮) pregunta «¿Terminar con 3 de 6 sprints?». Un sprint que lleva más de 60 s avisa «¿Se te olvidó parar?» con «Quitar este sprint»; nunca se cierra solo. Tocar la última fila de la tabla quita ese sprint (con «Deshacer»). Atrás no sale mientras corre o en la cuenta atrás. Pista de un solo uso (`hint:sprint-how`).
- **Pitido** (nativo desde 16.14; `modules/rest-timer/.../SprintBeep.kt`, `scheduleSprintBeep` / `cancelSprintBeep`): no es una notificación. Por notificación sonaba de 0,4 a 0,8 s tarde y cada vez distinto (§14): Android retiene ~200 ms cada notificación nueva y SystemUI prepara después el reproductor. Ahora, con la salida a menos de 1 min, un hilo de la app con prioridad de audio y *wake lock* espera la salida en el propio proceso (vivo gracias al servicio de la cuenta atrás), abre la salida de audio con 0,1 s de silencio a −0,8 s y toca un tono de 2 kHz y 250 ms ya cargado en un `AudioTrack` estático, en el flujo de alarma (suena en silencio y vibra 250 ms). Con `AudioTimestamp` mide cuándo salió de verdad el sonido, lo deja en `logcat` (`[sprint] pitido N ms`) y aprende la latencia de salida del móvil (media con la anterior, en `SharedPreferences`) para adelantar el siguiente. De respaldo, una alarma `setAlarmClock` 2 s antes de la salida despierta un receptor (`goAsync`) si el proceso murió; no puede ser la vía principal porque Android no entrega una alarma antes de 5 s desde que se pone y, tras «Saltar descanso», la salida está a 5 s. Pedir la misma salida otra vez no cambia nada, y una cancelada (salida anulada, Terminar) no suena. `syncSprint` lo pide al enfocar, al volver a la app y al arrancar (`restoreCardioInProgress`). La cuenta atrás de la pantalla de bloqueo sigue siendo la del módulo `rest-timer` («Descanso» / «Preparados»). Con la pantalla enfocada, la app se muestra sobre la pantalla de bloqueo (`setShowWhenLocked`): botón de encendido y «Parar» sin el PIN. Un entreno y unos sprints no pueden estar en curso a la vez (comparten esa cuenta atrás).
- **Medición** (`measureSprint`): GPS a 1 punto por segundo durante toda la sesión (`SPRINT_GPS`). Se descartan los puntos con precisión peor de 20 m y los saltos aislados; la velocidad de cada punto es la Doppler del GPS si es creíble (≤ 12,5 m/s; si Android da 0 mientras las posiciones se mueven, la de las posiciones) y luego una mediana de 3. La distancia integra esa curva entre el pitido y «Parar» y se corta donde, tras la punta, baja de 2 m/s (no suma lo andado al frenar). La punta es el máximo. Calidad *débil* (≈) con precisión mediana > 8 m, un hueco > 2,5 s, más del 30 % de puntos sin Doppler o sin puntos después de parar. No se muestra la velocidad media (el tiempo incluye la frenada). Al terminar se guardan los puntos de cada sprint (`lap_fixes`) para poder recalcular si se ajustan las constantes tras medir en pista.
- **Pantallas**: la píldora del GPS es el título en directo («GPS ±4 m», «GPS débil ±14 m», «Sin GPS · solo tiempo»…); sin GPS se mide solo el tiempo («Seguir sin GPS»). El detalle muestra Vel. máx. (o Mejor tiempo), Metros y Sprints y la tabla (# · Tiempo · Metros · Vel. máx., el más rápido en verde). En Hoy y el historial, «6 sprints · máx. 30,6 km/h» con el icono `run-fast`. La imagen para compartir es la del entreno (Oscuro · Sin fondo) con un sprint por fila.
- **Pool** (1.3.4; `src/domain/cardioPool.ts`, puro y con tests): «Hacer otro cardio» ofrece el cardio de la semana que hoy no toca. Dos actividades son la misma si coincide todo lo que guardan menos las notas (`cardioKey`: nombre, objetivo e intensidad sin mayúsculas, tildes ni espacios, cómo se registra y su plan). Se quita el grupo si alguna de sus actividades es de hoy o ya está hecha hoy, y lo representa la de id menor (con ella se guardan el registro y la sesión). Unos sprints o unas Fases y un entreno no pueden estar en curso a la vez, porque comparten la cuenta atrás de la pantalla de bloqueo (`sharesLockCountdown`). Borrar una sesión de cardio terminada borra también su registro del día.
- **Actividad existente**: la migración 8 convierte «Sprints + Bouncing» (temporizador HIIT) en sprints, 6 × 1:30. Para volver: editor → Fases → HIIT.

**Temporizador** (`src/domain/cardioPlan.ts`, puro y con tests): el plan se guarda como JSON en `cardio_activity.plan` y se expande en fases con su intensidad:
- **LISS**: un bloque continuo (p. ej. 30 min suave, Z2).
- **MISS**: calentamiento + bloque medio (Z3-4) + enfriamiento (p. ej. 5 + 20 + 5 min).
- **HIIT**: calentamiento + N rondas de trabajo/descanso + enfriamiento (p. ej. 3 min + 8 × (30 s + 60 s) + 3 min).
- Al iniciar se programan **todas las alarmas de cambio de fase** a la vez (`delivery: 'alarmClock'`, canal del descanso, identificadores `cardio-<sesión>-<n>` y `cardio-<sesión>-end`), así que suenan con la pantalla bloqueada aunque el JS esté parado; el módulo `rest-timer` muestra la cuenta atrás hasta el final en la pantalla de bloqueo. Pausar cancela las alarmas; reanudar las reprograma con lo que falte. La pantalla muestra la fase actual en grande, lo que queda de ella, la siguiente y una barra con todas las fases coloreadas por intensidad.

### 6.9 Músculos (fase 17, 1.4.0)

Diseñado con agentes en dos rondas: cuatro propuestas sobre la idea (datos, producto, visual y ciencia del entrenamiento) y un debate sobre el Perfil (tres propuestas, dos críticos y un juez). El usuario eligió «esta semana frente a tu plan» en lugar de una ventana de 7 o 30 días y el hombro en tres partes, y descartó niveles, insignias, rankings, el semáforo de recuperación y el generador de entrenos.

- **Taxonomía** (`src/domain/muscles.ts`): 18 músculos en 6 grupos: Pecho; Espalda (dorsal, espalda alta, trapecio, lumbar); Hombros (anterior, lateral, posterior); Brazos (bíceps, tríceps, antebrazo); Piernas (cuádriceps, isquios, glúteo, aductores, gemelo); Core (abdomen, oblicuos). Cada ejercicio tiene músculos **principales** y **secundarios** (`exercise_muscle`, §10). Los 22 del catálogo vienen asignados por nombre (`CATALOG_MUSCLES`: al instalar, con la migración 9 y al restaurar una copia anterior a la 9); uno renombrado o nuevo sale «Sin músculos» hasta que se le asignen. El cardio no tiene músculos.
- **Series por músculo**: cada serie de trabajo de un entreno terminado suma **1 a cada músculo principal y 0,5 a cada secundario** (conteo fraccional; las aproximaciones y las series sin reps no cuentan; por lado, en segundos o en pasos, una serie es una). No se usa el tonelaje: 10 de los 22 son de peso corporal y compararía cargas, no estímulo. El **plan** es lo mismo sobre las rutinas: las series de cada ejercicio activo por los días de su rutina (`plannedWeekSets`). «Esta semana» va del lunes a hoy (`weekSoFar`).
- **Perfil · Esta semana** (`src/components/MuscleWeek.tsx`): «34 de 65 series» (series reales) y la **silueta** de frente y de espalda (`BodyMap`, 2 × 120 × 240 dp, del sexo del perfil) pintada por las series hechas, en una rampa violeta con cortes fijos: nada · menos de 3 · menos de 6 · menos de 10 · **10 o más** (el inicio de la franja de 10–20 series por semana que recomienda la evidencia), `muscleLevel`. No pinta la parte del plan hecha: el lunes saldría todo el cuerpo violeta y el domingo todo al máximo; el plan va en las cifras. Una región que junta dos músculos (dorsal y espalda alta; hombro anterior y lateral en la vista frontal) toma el mayor. Debajo, una línea fija: la leyenda, la lectura del músculo tocado («Isquios · 3 de 6 series»; dos líneas si la región junta dos; otro toque la quita) o, con la semana vacía, «Semana pasada: 42 series». Después, la fila ámbar «3 ejercicios sin músculos · Sus series no cuentan» (del plan o de la semana; con uno, abre su editor; con más, el catálogo filtrado) y «Series por músculo». Sin rutinas ni series: «Sin rutinas todavía» → Rutinas.
- **Músculos** (`src/app/musculos.tsx`, desde el Perfil y desde Rutinas): «Esta semana · 34 de 65 series», la leyenda (Hechas · Tu plan · De 10 a 20) y «Cada serie suma 1 a su músculo principal y 0,5 a los secundarios»; por grupo, cada músculo con «6 de 11» (✓ verde con el plan hecho) y una barra con el mismo eje para todos (0–25 series): relleno del color de la silueta, la franja de 10 a 20 y una raya en el plan. Tocar un músculo abre una hoja con los ejercicios que le suman (principal o «Secundario: cuenta la mitad», y sus series hechas de las planificadas); cada uno abre su editor.
- **Iconos**: el de cada ejercicio sale del movimiento de su primer músculo principal (`movementPattern`): empuje `weight-lifter`, tirón `rowing`, brazos y hombro `arm-flex`, pierna `yoga` (una zancada), cadera `kettlebell` y core `human-handsup`; sin músculos, la mancuerna en gris (`ExerciseIcon`, `PATTERN_ICON`). Van en el catálogo, en Historial → Ejercicios y (1.4.1) en cada fila de ejercicio de una rutina (`SlotRow`: tarjetas de Rutinas y Hoy, editor de rutina y «Ejercicio suelto»), en «Siguiente» del descanso y en las tarjetas del resumen (§12). En el progreso del ejercicio, sus músculos como etiquetas (`MuscleTags`: principales en violeta, secundarios más apagados).


### 6.10 Fotos de las sesiones (fase 20, 1.4.3)

Pedido del usuario del 2026-11-05: «poder añadir foto a una caminata o actividad».

- **Dónde**: en el detalle de cualquier sesión de cardio terminada (caminata, Fases, sprints) y en el resumen de un entreno, «Añadir foto» (sin fotos, una fila «De la cámara o de la galería») o, con fotos, una tira de miniaturas con «Añadir» al final. En la caminata va entre el mapa con la gráfica y los parciales; en el resto, después de las cifras; en el resumen, al final. Menú: **Hacer una foto** (cámara del sistema; el original se guarda también en la galería, como cualquier foto) o **Elegir de la galería** (selector de fotos del sistema, hasta 10 a la vez, sin permiso de lectura).
- **Durante la caminata**: una cámara en la cabecera hace la foto y la deja en el punto de la ruta donde estabas al abrir la cámara (el último punto del GPS, si tiene menos de 30 s y ±50 m; `placeFromFix`). Se ve como una cámara sobre la ruta en el mapa del directo y del detalle.
- **Sitio de una foto de la galería** en una caminata (`photoPlace`, `src/domain/photos.ts`, con tests): su GPS del EXIF si está a menos de 200 m de la ruta (el selector de Android suele quitarlo); si no, la hora del EXIF, pero solo en caminatas sin pausas (el perfil guarda segundos activos y no cuándo fueron las pausas; `placeAtTime`). Si no se sabe, la foto queda en la tira, no en el mapa.
- **Ver y quitar**: una miniatura abre `src/app/foto/[id].tsx`, las fotos de la sesión una por página con su fecha; ⋮ «Quitar foto» pide confirmación («Si está en la galería del móvil, sigue allí»).
- **Guardado** (`src/services/photos.ts`): una copia propia reducida a 2160 px por el lado largo (JPEG 0,85) en `Documents/photos/`; la tabla `photo` (§10) dice de qué sesión es, cuándo y dónde. Borrar la sesión borra sus fotos (filas y ficheros).
- **Copia de seguridad**: van las filas, no las imágenes. Borrar los datos (modo pruebas, restaurar) no borra las imágenes, así que restaurar en el mismo móvil las recupera; en otro móvil no se muestran. Las imágenes de fotos que ya no tiene ninguna fila (pruebas) se quedan en la carpeta.

---

## 7. Notificación diaria

### 7.1 Comportamiento

- Ajustes: activar/desactivar y **hora** (por defecto 07:00 y apagado en una instalación nueva).
- Cada día a esa hora, sin internet y con la app cerrada: notificación con lo que toca, por ejemplo:
  - **Lunes · Día 1: Torso (Empuje Pesado + Tirón Volumen)** — "🚶 Caminar 5 km · 🚴 Bici estática 30 min · 🏋️ 7 ejercicios"
  - **Miércoles · HIIT** — "⚡ Sprints + Bouncing 15 min (sesión de mañana)"
  - **Domingo · Descanso** — "Descanso / Caminar (opcional)"
- Tocar la notificación abre la pantalla **Hoy**.

### 7.2 Implementación (`src/services/dailyReminder.ts`)

- Se programan **7 notificaciones semanales** (una por día, trigger `WEEKLY` con `weekday`, `hour`, `minute`), identificadores `daily-1` … `daily-7`, canal `daily-reminder-v1` (importancia alta, sonido por defecto). El texto de cada una lo genera la función pura `buildDailyMessage(isoWeekday, data)` en `src/domain/schedule.ts`.
- `rescheduleDailyReminders()` es **idempotente**: cancela `daily-*` y las vuelve a crear. Se llama al arrancar la app, al cambiar hora/activación y tras cualquier cambio en rutinas, slots, días asignados o cardio.
- ⚠️ **Convención de días**: en todo el dominio y la BD se usa **ISO (1 = lunes … 7 = domingo)**. `expo-notifications` usa **1 = domingo … 7 = sábado**. Convertir solo en el borde con `isoToExpoWeekday(iso) = iso === 7 ? 1 : iso + 1`, con test.

### 7.3 Pantalla de diagnóstico (Ajustes)

Avisos y permisos (Ajustes, fase 12): si todo está bien (notificaciones, alarmas exactas, la burbuja si está activada y la optimización de batería, que lee `isIgnoringBatteryOptimizations()` del módulo `rest-timer`), una sola fila «Todo listo para que suenen los avisos» con «Ver detalles» (cada comprobación como «Activado» o «Falta» y el número de avisos programados); si falla algo, solo esas filas, en ámbar, y tocarlas abre su ajuste. Los botones «Probar descanso (10 s)» y «Probar recordatorio (5 s)» se quitaron en la fase 11: el descanso ya está probado en entrenos reales y el recordatorio se comprueba con el aviso de verdad (poniendo la hora un par de minutos después).

### 7.4 Plan B (si las alarmas llegan tarde)

Desde SDK 58, `expo-notifications` ya programa con `setAlarmClock()` cuando se pide `delivery: 'alarmClock'` y hay permiso de alarma exacta (lo que se usa en `restTimer.ts`), así que este plan B solo hace falta si en el móvil real sigue llegando tarde. En ese caso, crear un **módulo nativo local de Expo** (Kotlin, `modules/exact-alarm`) que programe con `AlarmManager.setAlarmClock()` (exento de Doze y el más fiable) un `BroadcastReceiver` que publique la notificación en el canal `rest-timer`, y que la reprograme tras reinicio (`BOOT_COMPLETED`). API JS: `scheduleExact(id, timestampMs, title, body, url)` / `cancel(id)`. `restTimer.ts` lo usa detrás de la misma interfaz. Documentar la decisión aquí si se activa.

---

## 8. Ajustes generales

Una lista que guarda al momento (fase 12): **Entrenamiento** (descanso entre series en una hoja, pantalla encendida, burbuja flotante), **Sugerencias de peso** (1.4.2, `src/components/WeightRules.tsx`: «Incremento · 2,5 kg», «Cuándo subir · Por la media» y «Cuándo bajar · Tras 2 sesiones», cada una con su hoja; las de subir y bajar enseñan un ejemplo calculado con el propio `recommend()` —«Ejemplo en 10–12 reps con 35 kg: 14, 12 y 11 · Subir a 37,5 kg / 12, 12 y 12 · Mantener 35 kg»— y la de incremento cuántos ejercicios tienen el suyo; todas dicen «Cuenta desde el próximo entreno»; el nombre de la sección es el de la caja «Sugerencia de peso»), **Recordatorio diario** (avisar cada día y la hora), **Avisos y permisos** (§7.3), **Copia de seguridad** (§9) y **Modo pruebas**; al pie, la versión.

**Modo pruebas** (`settings.dev_mode`, desactivado por defecto desde que el usuario usa la app de verdad; la columna conserva `DEFAULT 1` de la migración 3, así que `importSeed` lo escribe a 0): en el primer arranque tras instalar un APK nuevo se borran todos los datos y la app queda como recién instalada (solo catálogos, §3). Se detecta comparando `Application.getLastUpdateTimeAsync()` (Android lo actualiza en cada instalación) con el valor guardado en `app_meta('install-stamp')`. Con el modo pruebas activo no se hacen copias automáticas a GitHub. En Ajustes hay un interruptor para activarlo si se vuelve a necesitar y un botón "Reiniciar datos ahora". Reiniciar (a mano o al instalar en modo pruebas) **conserva la configuración de la copia en GitHub** (usuario, repositorio, fichero; el token vive aparte, en secure-store) para poder restaurarla justo después, **y también el modo pruebas y la fecha de la última copia** (`resetData`): si no, la copia automática subiría los datos vacíos encima de la buena. Al final de Ajustes se ve la versión instalada (p. ej. `Entreno v1.2.0`).

---

## 9. Copia de seguridad

Código: `src/db/maintenance.ts` (exportar, validar, restaurar, borrar), `src/services/backup.ts` (ficheros, GitHub, modo pruebas), `src/services/githubBackup.ts` (cliente de la API de GitHub), UI en `src/components/DataSettings.tsx` (Ajustes).

1. **Exportar/Importar fichero**: volcado de las tablas de `BACKUP_TABLES` → `{ app: 'entreno', schemaVersion, exportedAt, tables }` en `entreno-backup-AAAA-MM-DD.json` (caché) compartido con el menú del sistema (`expo-sharing`). Importar con `File.pickFileAsync` de `expo-file-system` → `parseBackup` → confirmación → `restoreBackup`: borra e inserta **en una sola transacción** (si algo falla, los datos actuales no se tocan), ignora columnas desconocidas y rechaza copias de un `schemaVersion` más nuevo. Después se cancelan y reprograman las notificaciones.
2. **Copia automática en GitHub**: repo **privado** del usuario (usuario, repositorio y ruta del fichero en Ajustes) y un **fine-grained personal access token** con permiso *Contents: Read and write* solo sobre ese repo, guardado en **expo-secure-store** (nunca en la BD ni en el JSON).
   - Cuándo: al arrancar la app, al terminar un entreno o un cardio y al cerrar desde Hoy un entreno que llevaba más de 12 h abierto, como mucho una vez cada 24 h, nunca en modo pruebas; si falla, se guarda el error (`settings.last_backup_error`) y se reintenta la próxima vez. Manual: «Subir ahora».
   - Cómo: `GET /repos/{owner}/{repo}/contents/{path}` para obtener el `sha` → `PUT` con el JSON en base64 (`File.base64()`). Cada copia es un commit → historial de versiones.
   - Restaurar: descarga con `Accept: application/vnd.github.raw+json`, confirmación y `restoreBackup`.
3. **Copias cifradas** (1.3.4, 16.15; `src/domain/backupCipher.ts` puro y con tests, `src/services/backupCipher.ts`, pantalla `src/app/cifrado.tsx`): con una contraseña puesta en Ajustes («Cifrar las copias»), tanto la de GitHub como la exportada salen del móvil cifradas.
   - Formato: el mismo fichero JSON con `{ app, format: 'entreno-cifrada-1', kdf: { name: 'pbkdf2-sha256', iterations, salt }, cipher: 'AES-256-GCM', data }`; `data` es base64 de IV (12) · texto cifrado · etiqueta (16). Dentro va el JSON de siempre, con lo no ASCII escapado (`\u00e1`) para no depender de un codificador UTF-8.
   - Clave: PBKDF2-HMAC-SHA256 con 600 000 iteraciones (lo que recomienda OWASP) y sal de 16 bytes, de la contraseña normalizada (NFC) en UTF-8, mínimo 10 caracteres. Se calcula en nativo (`Pbkdf2.kt` en el módulo `rest-timer`, fuera del hilo de JS) al ponerla («Preparando la clave…») y se guarda la **clave derivada** en el Keystore (`expo-secure-store`); la contraseña no se guarda. Las copias automáticas cifran con esa clave sin preguntar. AES-GCM es nativo (`expo-crypto`).
   - Abrir: `openBackup` usa la clave guardada si la copia tiene su misma sal; si no (otro móvil, contraseña cambiada) pide la contraseña con un diálogo y la deriva con la sal y el coste de la copia. En un móvil sin contraseña, la que abrió la copia se queda para las siguientes. Una copia sin cifrar se sigue abriendo igual.
   - Sin la contraseña no hay forma de recuperar una copia cifrada (la pantalla lo dice). Las copias de antes siguen sin cifrar en el historial del repositorio de GitHub.
   - En el ordenador: `node scripts/decrypt-backup.mjs copia.json > descifrada.json` (solo Node; pide la contraseña sin mostrarla o la toma de `ENTRENO_PASSWORD`). Se comprobó en el OnePlus que la app abre una copia cifrada con Node. *(Primero fue scrypt en JavaScript, `@noble/hashes`: tardaba ~50 s en el OnePlus; se cambió antes de publicarlo.)*
   - Abrir una copia cifrada y cancelar la restauración no guarda su clave: solo se adopta al restaurar.
4. **Copia automática de Android** desactivada (`android.allowBackup: false`, 16.16): ni la base de datos ni el almacén seguro van a la nube de Google, y una base cifrada restaurada sin su clave no se podría abrir.

---

## 10. Modelo de datos (SQLite)

**Cifrada** (1.3.4, 16.17; `src/services/secureDatabase.ts`): SQLCipher (`expo-sqlite` con `useSQLCipher`), con una clave de 256 bits aleatoria creada en el móvil y guardada en el Keystore (`expo-secure-store`, `database-key`); nunca sale del móvil, tampoco en las copias. Se abre con `PRAGMA key = "x'…'"` (clave en bruto: sin derivarla en cada apertura) como primera sentencia de `onInit`; la tarea del GPS abre su propia conexión con la misma clave. Al arrancar, una base sin cifrar de una versión anterior se copia a una cifrada (`ATTACH … KEY` + `sqlcipher_export`, con su `user_version`), se comprueba que abre y tiene las mismas series, y solo entonces sustituye a la otra; si algo falla, se sigue con la de siempre y se reintenta en el próximo arranque. Si la base está cifrada pero el móvil ya no tiene su clave, se aparta (`entreno-ilegible-…db`) y se empieza vacía para restaurar una copia. Para mirar la base de un emulador con `sqlite3` ya no basta con copiarla.

Convenciones: ids `INTEGER PRIMARY KEY AUTOINCREMENT`; pesos en **kg (REAL)**; fechas locales `TEXT 'YYYY-MM-DD'`; instantes en **epoch ms (INTEGER)**; booleanos `INTEGER 0/1`; día de la semana **ISO 1–7**; `archived` para borrado lógico.

| Tabla | Columnas |
|---|---|
| `profile` (1 fila) | `id`=1, `name` (sin uso), `sex` ('male'/'female'), `birth_date`, `height_cm`, `activity_factor`, `deficit_kcal`, `protein_g_per_kg`, `fat_g_per_kg`, `water_l_per_kg` |
| `settings` (1 fila) | `id`=1, `rest_seconds_default`, `default_increment_kg`, `progression_mode`, `sessions_below_to_decrease`, `daily_reminder_enabled`, `daily_reminder_time` ('HH:mm'), `keep_awake`, `rest_overlay`, `dev_mode`, `backup_owner`, `backup_repo`, `backup_path`, `last_backup_at`, `last_backup_error`, `cardio_hero` (cifra grande de la caminata), `distance_unit` ('km'/'m'), `cardio_chart` ('pace'/'speed'/'altitude'), `cardio_live_panel` ('map'/'chart'/'splits') |
| `app_meta` | `key`, `value` — datos internos que sobreviven a un borrado (p. ej. `install-stamp` y las pistas de un solo uso `hint:*`) |
| `weight_log` | `id`, `date` (único), `weight_kg` |
| `exercise` | `id`, `name` (único), `type` ('external'/'bodyweight'), `equipment`, `increment_kg` (null = por defecto), `notes`, `archived`, `pair` (1 = con dos mancuernas: el peso es el de cada una y el volumen cuenta las dos) |
| `exercise_muscle` | `exercise_id`, `muscle` (clave de `MUSCLE_KEYS`: 'chest', 'lats', 'side_delts'…; las desconocidas se ignoran al leer), `role` ('primary'/'secondary') — PK (`exercise_id`, `muscle`) |
| `routine` | `id`, `name`, `position`, `archived` |
| `routine_weekday` | `routine_id`, `weekday` — PK (`routine_id`, `weekday`) |
| `routine_slot` | `id`, `routine_id`, `exercise_id`, `position`, `weight_kg` (peso actual; null = peso corporal sin lastre), `sets`, `target_kind` ('range'/'fixed'/'failure'), `rep_min`, `rep_max`, `fixed_reps`, `failure_minus`, `per_side`, `unit` ('reps'/'steps'/'seconds'), `progression` ('load'/'manual'), `allow_decrease`, `increment_kg`, `rest_seconds`, `note`, `archived` |
| `cardio_activity` | `id`, `weekday`, `name`, `target`, `intensity`, `notes`, `position`, `archived`, `tracking` ('check'/'gps'/'timer'/'sprint'), `plan` (JSON del temporizador o de los sprints, §6.8) |
| `cardio_log` | `id`, `date`, `activity_id` (nullable), `name`, `done`, `value`, `notes`, `session_id` (nullable → `cardio_session`) |
| `cardio_session` | `id`, `activity_id` (nullable), `name`, `date`, `tracking` ('gps'/'timer'/'sprint'), `status` ('in_progress'/'finished'), `started_at`, `finished_at`, `paused_at` (null = corriendo), `paused_ms`, `segment`, `plan` (copia del plan), `distance_m`, `route` (polilínea codificada), `samples` (JSON `[[s, d, a], …]`), `title` (null = `name`), `laps` (sprints: todo su estado, §6.8), `lap_fixes` (los puntos de cada sprint, para recalcular) |
| `cardio_point` | `id`, `session_id`, `segment`, `t`, `lat`, `lon`, `accuracy`, `speed`, `altitude`, `received_at` (cuándo lo guardó la tarea, para diagnosticar desfases) — puntos de la sesión en curso; se borran al terminar (no van en la copia) |
| `workout_session` | `id`, `routine_id` (nullable), `date`, `started_at`, `finished_at`, `status` ('in_progress'/'finished'; 'abandoned' existe en el tipo pero no se escribe: descartar borra la sesión y sus series), `imported`, `notes`, `rest_ends_at`, `rest_notification_id`, `current_slot_id`, `skipped_slot_ids` (JSON), `title` (null = nombre de la rutina) |
| `set_log` | `id`, `session_id`, `slot_id` (nullable: ejercicio puntual), `exercise_id`, `set_index`, `weight_kg` (copia del peso del slot al registrar; en las de aproximación, el peso usado; nullable), `reps`, `is_extra`, `is_warmup`, `completed_at` |
| `weight_change` | `id`, `slot_id`, `session_id` (nullable), `from_kg`, `to_kg`, `reason`, `source` ('progression'/'manual'/'import'), `status` ('pending'/'applied'/'dismissed'/'expired'), `created_at`, `decided_at` |
| `food` | `id`, `name` (único), `fat_per_100g`, `carbs_per_100g`, `protein_per_100g`, `archived` |
| `diet_item` | `id`, `weekday`, `meal` ('desayuno'/'comida'/'merienda'/'cena'), `food_id`, `grams`, `position` |
| `photo` | `id`, `cardio_session_id` (nullable), `workout_session_id` (nullable; exactamente uno de los dos, con `CHECK`), `file` (nombre en `Documents/photos/`), `width`, `height`, `taken_at` (nullable), `lat`, `lon` (nullable: su sitio en la ruta), `created_at` |

La migración 6 solo cambia datos: pone las tildes a los nombres del catálogo de alimentos (Plátano, Proteína…) si siguen con el nombre antiguo; restaurar una copia anterior aplica el mismo cambio.

La migración 7 añade `exercise.pair` y lo activa en los ejercicios cuyo material es «mancuernas» (Sentadilla búlgara lastrada, Zancadas caminando); el seed y la restauración de una copia anterior hacen lo mismo (`EXERCISE_PAIR_DEFAULTS`).

Una `workout_session` con `routine_id` NULL es una **sesión suelta** (1.3.4): sus ejercicios salen de `set_log.slot_id` y `current_slot_id`, sin columna nueva.

La migración 8 añade `cardio_session.laps`, `cardio_session.lap_fixes` y `cardio_point.received_at`, y pasa a sprints las actividades con «sprint» en el nombre que usaban el temporizador HIIT (`SPRINT_TRACKING_DEFAULTS`; también el seed y las copias anteriores a la 8).

La migración 10 (1.4.3) crea `photo` con sus índices `photo(cardio_session_id)` y `photo(workout_session_id)`. Va en la copia de seguridad (solo las filas, §6.10).

La migración 9 crea `exercise_muscle` y asigna los músculos de los 22 ejercicios del catálogo por su nombre, sin tocar un ejercicio que ya tenga (`EXERCISE_MUSCLE_DEFAULTS`; también el seed y las copias anteriores a la 9). Está congelada como la 6: corregir una asignación por defecto pide otra migración.

Índices: `set_log(session_id)`, `set_log(slot_id, completed_at)`, `set_log(exercise_id, completed_at)`, `workout_session(status)`, `workout_session(date)`, `diet_item(weekday)`, `cardio_log(date)`, `cardio_point(session_id, t)`, `cardio_session(status)`; y la restricción única `cardio_log(date, activity_id)`, que impide marcar dos veces la misma actividad el mismo día.

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
    (tabs)/historial.tsx            # entrenos · ejercicios · cardio
    progreso/[id].tsx               # progreso de un ejercicio: récords, gráficas, sesiones
    (tabs)/dieta.tsx                # plan semanal editable y totales frente a objetivos
    alimentos.tsx                   # catálogo de alimentos / selector al añadir a una comida
    alimento/[id].tsx               # crear (id = nuevo) o editar un alimento
    (tabs)/perfil.tsx               # datos, objetivos calculados, registro de peso
    workout/[sessionId].tsx         # modo entrenamiento (lista · serie · descanso)
    workout/resumen/[sessionId].tsx # resumen + recomendaciones
    cardio-sesion/[id].tsx          # caminata con GPS o temporizador por fases; detalle con métricas, mapa, gráfica y parciales
    ruta/[id].tsx                   # mapa a pantalla completa (2D/3D, satélite) con la gráfica sincronizada
    compartir/[tipo]/[id].tsx       # imagen para compartir (historia o cuadrado) de una caminata (tipo = cardio) o un entreno
    foto/[id].tsx                   # las fotos de una sesión, una por página; quitar una
    slot/[id].tsx                   # ejercicio de una rutina: peso, prescripción, recomendación, quitar
    rutina/[id].tsx                 # editor de rutina: nombre, días, orden, añadir, borrar
    ejercicios.tsx                  # catálogo de ejercicios / selector para añadir a una rutina
    ejercicio/[id].tsx              # crear (id = nuevo) o editar un ejercicio del catálogo
    cardio.tsx                      # cardio semanal; con ?dia=N, el editor de un día (rutinas y cardio)
    cardio/actividad/[id].tsx       # crear (id = nueva, ?dia=N) o editar una actividad de cardio
    pesos.tsx                       # todos los pesajes, por meses, cargando por páginas
    objetivos.tsx                   # objetivos del día con el objetivo y la actividad (desde Perfil y Dieta)
    musculos.tsx                    # series por músculo de la semana frente al plan
    ajustes.tsx                     # lista: entrenamiento, recordatorio, avisos y permisos, copia, modo pruebas
    dev/componentes.tsx             # catálogo de componentes en todos sus estados (solo en desarrollo)
  db/         db.ts (interfaz Db) · migrations.ts · seed.ts · seedData.ts · seedTypes.ts · maintenance.ts (backup/borrado) · repositories/*.ts · __tests__/
  domain/     progression.ts · progress.ts · nutrition.ts · bodyProfile.ts · schedule.ts · workoutMachine.ts · gps.ts · cardioPlan.ts · mapView.ts · trackChart.ts · walkStats.ts · warmup.ts · sprint.ts · muscles.ts · photos.ts · format.ts · types.ts · __tests__/
  services/   notifications.ts · restTimer.ts · dailyReminder.ts · backup.ts · githubBackup.ts · gpsTracker.ts · cardioTimer.ts · cardioSession.ts · sprintSession.ts · workoutInProgress.ts · photos.ts · shareImage.ts · network.ts · __tests__/
  components/ ui.tsx (el sistema de diseño, §12) · Dialog.tsx (diálogo, menú ⋮, diálogo de texto, Snackbar) · Sheet.tsx · layers.ts · Recommendation.tsx · RoutineCard.tsx · FormRow.tsx · DataSettings.tsx · LineChart.tsx · RouteMap.tsx · TrackChart.tsx · MetricBoard.tsx · InteractiveMap.tsx · ShareCard.tsx · Ring.tsx (anillo del descanso) · Sprint.tsx (tabla y detalle) · SprintLive.tsx (sprints en directo) · WeightSheet.tsx (hoja de un pesaje) · BodyMap.tsx (silueta, el único que importa la librería) · MuscleWeek.tsx (Esta semana del Perfil) · MusclePicker.tsx (hoja de músculos) · Photos.tsx (fotos de una sesión)
  hooks/      data.ts (useDb, useLoader, useNow) · walk.ts (useCardioSession) · editing.ts (escrituras en cola, «Guardar» y aviso al salir)
  theme.ts
modules/rest-timer/                 # módulo nativo local (Kotlin): cuenta atrás en bloqueo + burbuja flotante
assets/sounds/rest_end.wav          # generado (sin derechos)
data/seed/seed.json
```

Reglas: `src/domain` no importa nada de React Native ni de Expo (TS puro, 100 % testeable). Las pantallas no hablan con SQLite directamente: usan `src/db/repositories`. Las notificaciones solo se tocan desde `src/services` (excepción: `src/app/_layout.tsx` escucha el toque en una notificación con `expo-notifications` para abrir su ruta). Las pantallas no llaman a `Date.now()` (lo marca la regla de pureza del React Compiler): los repositorios y servicios reciben `now` con valor por defecto.

---

## 12. Interfaz

- Idioma **español (es-ES)**: decimales con coma ("37,5 kg"), espacio de no separación entre cifra y unidad, miles con espacio fino desde 5 cifras ("10 250"), fechas "mar 3 nov" y duraciones "58 min" o "1 h" (nunca "60 min").
- **Tema oscuro** por defecto (se entrena temprano), alto contraste, **botones grandes** usables con una mano y sudado; en modo entrenamiento, las reps y la cuenta atrás ocupan la pantalla.
- **Sistema de diseño** (fase 12, tras una revisión en la que varios agentes probaron cada pantalla en el emulador, propusieron cambios y otros los debatieron y decidieron). Todo sale de `src/theme.ts` y `src/components/ui.tsx`, y `eslint.config.js` prohíbe en pantallas y componentes el `Text` de React Native, los tamaños de letra numéricos, los colores literales, `kind="ghost"` y las flechas escritas.
  - **Tokens**: colores (`colors`; el verde solo para la acción principal, la selección, lo hecho y la ruta; el azul para «en curso» y lo que no cuenta; el ámbar para «decides tú» o atención; el rojo solo para lo destructivo y siempre con icono), espacios 4/8/12/16/24/32, radios 6/8/12/16/20 y la escala tipográfica `type`, de `countdown` (96) a `axis` (11): 500 en filas y etiquetas, 600 en títulos y botones, 700 en cifras y 800 solo en cifras grandes.
  - **Componentes**: `AppText` y `Value` (cifra con su unidad más pequeña, que nunca se parte), `Screen` con `footer` y `BottomBar` (la acción principal, fija abajo y con protección de 600 ms al cambiar), `Card` sin borde y `Block`, `ListGroup`/`ListRow` (filas de 56/72; las que navegan llevan chevron), `Section` (su etiqueta entra 4 dp respecto a las tarjetas: alineación óptica, porque una esquina redondeada hace que la superficie parezca más estrecha; dentro de una tarjeta, `flush`), `Button` (primary, secondary, tonal, tonalDanger, text y danger; md 48, lg 56, xl 64), `IconButton`, `FloatingButton` (sobre mapas y gráficas), `Segmented`, `DayPicker`, `Chip`, `Tag`, `CheckMark` (cuadrada para elegir; redonda para lo hecho en Hoy), `SwitchRow`, `Stepper`, `NumberRow`, `TextField`, `StatRow`, `ProgressBar` y `EmptyState`/`ErrorState`/`Loading`.
  - **Capas** (`Dialog.tsx`, `Sheet.tsx`): diálogo centrado (el de un texto, en el tercio superior con el teclado abierto); menú ⋮, solo para acciones destructivas o poco frecuentes, siempre con texto, y lo destructivo pide confirmación; hoja inferior sin asa, con steppers y listas pero nunca un campo de texto (lo que se borra desde una hoja se deshace); y Snackbar con «Deshacer» encima de la barra inferior o de las pestañas.
  - **Cabeceras**: un solo título por pantalla; en los detalles con título editable (caminata, resumen) la cabecera va sin título. Las acciones (compartir, ⋮, +, engranaje) van arriba a la derecha.
  - **Editores**: un «Guardar» abajo que guarda y vuelve (deshabilitado sin cambios) y, al salir con cambios, «¿Guardar los cambios?». Los controles sueltos guardan al momento.
  - **Textos**: ayuda mínima (pistas de un solo uso en `app_meta('hint:*')`), sin paréntesis ni «(opcional)», y los motivos en frases («Media de 14,7 reps, por encima de 12»).
  - **Catálogo** `/dev/componentes` (solo en desarrollo, desde Ajustes): cada componente en sus estados, para comprobar en el móvil y al sol que 500, 600 y 700 se distinguen y que las tarjetas sin borde se ven sobre el fondo.
- **Glosario**: Serie (de trabajo) · Aproximación (A1, A2…) · Sugerencia de peso (Subir a, Bajar a, Mantener, Deshacer) · Descanso · Ritmo y Ritmo medio (min/km) · Velocidad y Vel. media · Desnivel + · Parciales · Importado (entrenos del Excel) · Fases (el temporizador de cardio) · Sprint · Salida (el pitido) · Salida anulada · Vel. máx. · Ejercicio suelto («Suelto» en el historial) · Músculos principales y secundarios · Series por músculo · Esta semana · Foto («Añadir foto», «Hacer una foto», «Elegir de la galería», «Quitar foto») · Historia y Cuadrado (formatos de la imagen) · Borrar (en la interfaz nunca «Archivar», aunque por dentro se archive).
- **Iconos**: `Icon` dibuja la mancuerna reflejada (sube hacia la derecha, como el icono de la app), también en la pestaña Rutinas; cada tipo de cardio tiene su icono en `TRACKING_ICON` y cada movimiento de un ejercicio en `PATTERN_ICON` (`ui.tsx`, §6.9).
- **Iconos de ejercicio** (1.4.1, decidido con agentes: tres propuestas, dos críticos y un juez): `ExerciseIcon` (un tamaño, 40 dp, un color) va a la izquierda de toda fila o cabecera que es un ejercicio: catálogo, Historial → Ejercicios, `SlotRow` (Rutinas, Hoy, editor de rutina, «Ejercicio suelto»), «Siguiente» del descanso y tarjetas del resumen, con el texto a 72 dp (`ROW_ICON_INSET`). Sustituye lo que no informa (el número de orden, la flecha), nunca un dato. Nunca en la serie ni en la lista del entreno, en cabeceras, títulos, la imagen, la notificación ni en lo que es una rutina o un entreno. El estado (✓ verde) gana a la identidad. En una columna de cifras la carga va como cifra (`Figure`: «35 kg», «2 × 10 kg», «15 kg» con «lastre» debajo) y sin carga no se escribe nada; en frases sigue «Lastre 15 kg» / «Peso corporal». TalkBack lee la fila entera («Dominadas pronas, Peso corporal, 3 series, al fallo menos 1»). Descartado: una tira de glifos por rutina (a 20 dp empuje y core casi no se distinguen y cambia un número por glifos que contar) y abreviar («+15 kg», «Corporal»).
- **Músculos** (1.4.0): un violeta que no usa ningún estado. `muscleText`/`muscleTint` para un músculo principal y `muscleTintSoft` para un secundario (tonos `muscle` y `muscleSoft` de `Tag`), y la rampa `heat0`…`heat4` de la silueta y las barras (validada en oscuro sobre `card`). El verde sigue siendo «hecho» (✓ del plan cumplido) y el ámbar, «decides tú» (ejercicios sin músculos).

---

## 13. Hoja de ruta

Cada fase termina con `npm test`, `npm run lint` y `npx tsc --noEmit` en verde y un build probado en el móvil.

### Fase 0 — Bootstrap ✅
- [x] Proyecto Expo SDK 58 con TypeScript y expo-router en la raíz.
- [x] `tsconfig` estricto, alias `@/` → `src/`, ESLint (`eslint-config-expo`), scripts `test`, `lint`, `typecheck`.
- [x] jest-expo configurado.
- [x] `expo-dev-client`; `app.json`: nombre "Entreno", package `com.fabgs.entreno`, scheme `entreno`, permisos de §6.5, plugin `expo-notifications` con `sounds`.
- [x] Sonido `assets/sounds/rest_end.wav` (generado).
- [x] Build local de APK de release (`expo prebuild` + `gradlew assembleRelease`). En Windows requiere sustituir el `ninja` 1.10.2 del SDK por ≥ 1.12 (ver AGENTS.md → Compilar y probar).
- [x] Instalada en un Android real (OnePlus 7 Pro, Android 12).
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

### Fase 2 — Entrenar (MVP) ⭐ ✅
- [x] Pantalla Hoy (§6.3) con pesos de cada slot, recomendaciones pendientes y cardio.
- [x] Iniciar/continuar sesión; modo entrenamiento completo (§6.4) con input solo de reps.
- [x] Descanso con notificación programada (§6.5, `alarmClock`), −30/+30/Saltar, deep link.
- [x] Permiso de notificaciones al arrancar; alarmas exactas y batería desde Ajustes → Diagnóstico.
- [x] Corregir reps/borrar serie, serie extra, saltar ejercicio, acceso rápido a editar el peso del slot.
- [x] Añadir un ejercicio a la rutina desde el propio entreno ("+ Añadir ejercicio a la rutina").
- [ ] (Opcional) Ejercicio puntual solo para esa sesión, sin tocar la rutina. (→ §16; la 1.3.4 trae el ejercicio suelto, 16.11.)
- [x] Al terminar: crear recomendaciones pendientes; resumen con Aplicar / Ignorar / Aplicar todas; pendientes visibles en Hoy y en la primera serie del ejercicio.
- [x] Recuperación tras cerrar la app (estado en `workout_session`).
- [x] **Verificación en móvil real** (checklist de §14).

**Aceptación (móvil real)**: completar el Día 1 de principio a fin; con el móvil bloqueado el descanso suena a los 2:30 (≤ 3 s de retraso, 10/10); matar la app a mitad de descanso y reabrir → la cuenta atrás sigue bien y la notificación suena; al terminar se proponen los pesos de `recommend()` y el peso del slot **solo cambia al pulsar Aplicar**.

### Fase 3 — Recordatorio diario
- [x] `dailyReminder.ts` + ajustes de hora/activación.
- [x] Reprogramación al arrancar y al guardar ajustes (falta engancharla al editor de rutinas de la fase 4).
- [x] Pantalla de diagnóstico (§7.3) con exclusión de optimización de batería y botones de prueba.
- [ ] **Verificación en móvil real** (checklist de §14): falta reiniciar el móvil y modo avión. Ya probado: llega con la pantalla apagada y cambiar la hora no duplica.

**Aceptación**: en modo avión y con la app cerrada, la notificación llega a la hora configurada con el texto correcto del día; sigue llegando tras reiniciar el móvil.

### Fase 4 — Editor de rutinas ✅
- [x] Catálogo de ejercicios (`ejercicios.tsx`, `ejercicio/[id].tsx`): buscar, crear, editar, archivar; también sirve de selector al añadir a una rutina.
- [x] Editor de rutina (`rutina/[id].tsx`): crear, renombrar, días, reordenar (↑ ↓), añadir, archivar.
- [x] Editor del ejercicio de la rutina (`slot/[id].tsx`): peso, series, objetivo (rango/fijo/fallo), por lado, unidad, progresión, permitir bajar, incremento y descanso propios, nota, quitar.
- [x] Cardio semanal editable (`cardio.tsx`); la vista calendario está en la pestaña Rutinas.
- [x] Todo cambio de rutinas, días o cardio reprograma el recordatorio diario.
- [x] Verificación en móvil real: añadir un ejercicio al Día 2 y ponerle el domingo → Hoy lo muestra y el recordatorio dice «Domingo · Día 2: Pierna y Core».

**Aceptación**: añadir un ejercicio a una rutina, cambiarle el día y la hora → Hoy y la notificación diaria lo reflejan.

### Fase 5 — Historial y progreso ✅
- [x] Lista de sesiones y resumen de cada una.
- [x] Corregir series (reps y peso), borrar series o el entreno entero, con recálculo de la recomendación.
- [x] Progreso de cada ejercicio con récords, gráficas, tabla de sesiones y cambios de peso.
- [x] Historial de cardio.

### Fase 6 — Perfil y peso ✅
- [x] Aviso en Hoy si falta la fecha de nacimiento; formulario de perfil (la fecha se elige con el calendario nativo de Android, `@react-native-community/datetimepicker`).
- [x] Perfil con cálculos (§4) y registro de peso (lista).
- [x] Gráfica de evolución del peso corporal (reutiliza `LineChart`); mantener pulsado un pesaje lo borra (nunca el último).

### Fase 7 — Dieta ✅
- [x] Catálogo de alimentos: crear, editar, archivar, buscar.
- [x] Plan semanal editable: añadir alimento con gramos, cambiar gramos, quitar, "Copiar día a…".
- [x] Totales por comida/día/semana frente a objetivos (§5) con color por desviación.

### Fase 8 — Backup ✅
- [x] Exportar/Importar JSON (restauración atómica, compatible con copias antiguas).
- [x] Auto-backup a GitHub privado (§9) con token en secure-store; subir y restaurar a mano.
- [x] Modo pruebas (§8): borrar datos al instalar un APK nuevo; "Reiniciar datos ahora".
- [x] Probar la copia en GitHub con un repo y token reales del usuario (token *fine-grained* limitado a un repo privado, permiso Contents: lectura y escritura).

### Fase 9 — Pulido
- [x] Tema oscuro, hápticos, pantalla encendida durante el entreno.
- [x] Icono, splash e icono de notificación propios (mancuerna), generados con `scripts/generate_icons.py`.
- [x] Cuenta atrás del descanso en la pantalla de bloqueo (Live Update en Android 16) y burbuja flotante sobre otras apps (`modules/rest-timer`).
- [ ] Revisión de accesibilidad (tamaños de fuente, contraste).

### Fase 10 — Mejoras tras el primer entreno real
Notas del usuario del 2026-11-02, después de entrenar con la app. Cada casilla es una «issue».

**Errores**
- [x] 10.1 Atrás durante el descanso o una serie lleva a la **lista de ejercicios** (el descanso sigue contando y se ve en una barra arriba); tocar la notificación del descanso ya no apila otra copia del entreno (antes, tras varios ejercicios, «atrás» volvía al propio temporizador).
- [x] 10.2 Resumen: las cajas Duración · Series · Volumen tienen **la misma altura** aunque la duración sea «1 h 40 min».

**Interfaz** (mismo aspecto oscuro y verde, menos «app genérica»)
- [x] 10.3 Fin de la rutina con el estilo de la app: tarjeta «Rutina completada» en el entreno y diálogos propios (`ConfirmDialog`) en lugar de las alertas del sistema en el entreno y en Hoy.
- [x] 10.4 Hoy (§6.3): cada rutina se ve compacta (casilla ✓ si ya se hizo hoy, título, flecha para desplegar los ejercicios y botón «Empezar» visible sin bajar); el cardio pendiente va arriba y lo ya hecho (cardio o rutina) baja al final.
- [x] 10.5 Selectores de hora en una sola fila («06:00») que abren el reloj circular de Android; el descanso se elige con atajos (1:30, 2:00, 2:30, 3:00) además del − / +.

**Cardio** (§6.8)
- [x] 10.6 Caminar con GPS: Iniciar / Pausar / Terminar; graba la ruta, km, tiempo, velocidad y ritmo también con la pantalla bloqueada. Al terminar marca el cardio de hoy («5,2 km · 58 min»).
- [x] 10.7 Temporizador de cardio (bici, HIIT) por fases LISS / MISS / HIIT con aviso sonoro en cada cambio de fase aunque el móvil esté bloqueado, y cuenta atrás en la pantalla de bloqueo.
- [x] 10.8 Editor de cardio: tipo de seguimiento (solo marcar / GPS / temporizador) y plan del temporizador.
- [x] 10.9 Historial de cardio con distancia, tiempo, ritmo y mapa de la ruta.
- [x] 10.10 En la lista del entreno, la sugerencia de peso se ve en la propia línea («↑ Sugerido: 35 kg → 37,5 kg»).
- [x] 10.11 Alineación: los botones de solo texto no tienen margen lateral (quedan pegados al borde al que se alinean) y las filas izquierda/derecha usan `<Row between>` (la derecha nunca salta de línea).
- [x] 10.13 Detalle de la caminata con gráficas de velocidad y altitud (desnivel) y parciales por km; miniatura de la ruta en el historial de cardio.
- [x] 10.12 La app compilada solo lleva el catálogo de ejercicios y alimentos; los datos del Excel quedan como datos de prueba (§3).
- [x] Verificación en emulador (GPS simulado con `adb emu geo fix`).
- [ ] Verificación en móvil real: una caminata de verdad por la calle (distancia, ritmo, altitud) y los avisos del temporizador con la pantalla bloqueada. Ya probado en el OnePlus (1.1.2): alarmas del temporizador con la app en segundo plano (< 0,1 s de retraso), grabación GPS 40 s en segundo plano (el servicio sigue y el GPS pide posiciones cada 3 s) y liberación del GPS al terminar; ciclo copia → reiniciar → restaurar desde GitHub con todos los datos de vuelta.

### Fase 11 — Versión 1.2.0
Notas del usuario del 2026-11-02, después de usar la 1.1.
- [x] 11.1 Semana (pestaña Rutinas): tocar un día abre su editor, con las rutinas y el cardio de ese día; «Editar» arriba abre el cardio de toda la semana y sustituye al botón «Cardio semanal» del final.
- [x] 11.2 Ajustes muestra solo la versión (`Entreno v1.2.0`), sin el número de compilación.
- [x] 11.3 Fuera los botones «Probar descanso» y «Probar recordatorio» de Diagnóstico (§7.3).
- [x] Verificación en emulador.

### Fase 12 — Versión 1.3.0
Notas del usuario del 2026-11-03, después de su primera caminata de verdad con la app (migración 5).

**Caminata** (§6.8)
- [x] 12.1 Mapa 3D como Wikiloc: botón «3D» en la esquina del mapa y mapa a pantalla completa con 2D/3D (relieve), Mapa/Satélite, ver la ruta entera y norte.
- [x] 12.2 Gráficas y parciales en tiempo real mientras se graba.
- [x] 12.3 Tocar ritmo, velocidad, tiempo… lo pone en grande en lugar de la distancia (se recuerda).
- [x] 12.4 Tocar el mapa lo abre a pantalla completa con zoom.
- [x] 12.5 Una sola gráfica con selector (Ritmo · Velocidad · Altitud): pellizcar o doble toque para ampliar, botón en la esquina para volver, y el punto de la gráfica se marca en el mapa.
- [x] 12.7 Distancia en metros o km tocando la cifra.

**Entreno** (§6.4)
- [x] 12.6 Series de aproximación con su propio peso, fuera de series, volumen, récords y progresión.

**Compartir**
- [x] 12.8 Imagen resumen (historia de Instagram, 1080 × 1920) de una caminata o un entreno, con título editable que queda como título de la sesión.

**Interfaz** (§12; revisión con agentes: pruebas por pantalla, propuestas, debate y decisión)
- [x] 12.9 Sistema de diseño: tokens, escala tipográfica, componentes comunes, capas y regla de lint.
- [x] 12.10 Entreno: barra fija con la acción y protección del doble toque, SetTracker, descanso con anillo y corrección sin cortarlo, mini barra del descanso en la lista; «Empezar rutina» abre la primera serie.
- [x] 12.11 Caminata: en directo sin scroll (GPS en la cabecera, un panel cada vez), gráfica con gestos que no roban el scroll, mapa más nítido, hoja del mapa a pantalla completa sin asa y estado sin conexión.
- [x] 12.12 Listas en lugar de tarjetas en Historial, Rutinas, Ajustes, Perfil y Dieta; editores con un solo «Guardar»; «Deshacer» en lugar de confirmar.
- [x] 12.13 Compartir: «Guardar» en la galería; sin conexión, sin estilo Mapa.
- [x] 12.14 Tildes en el catálogo de alimentos (migración 6).

- [x] Verificación en emulador de las funciones (GPS simulado; el pellizco no se puede simular con adb: se prueba en el móvil).
- [x] Verificación en emulador del rediseño a 360 × 780 dp, con la fuente al 100 % y al 130 %. Corregido en ella: la leyenda de aproximaciones del resumen partía la palabra, la píldora del GPS se quedaba en la cabecera al terminar, el ritmo junto a las paradas caía como un pico (ahora es un hueco), y a 130 % las celdas en directo y «Terminar» se cortaban.
- [ ] Verificación en móvil real (lista de no regresión de §14).

### Fase 13 — Versión 1.3.1
Notas del usuario del 2026-11-03 al ver la 1.3.0: en la serie, la píldora «Subir a…» no parecía centrada y los textos de debajo «flotaban»; el anillo del descanso se vaciaba en sentido antihorario.

- [x] 13.1 Ficha de la serie (§6.4; revisión con agentes: 4 propuestas, 3 críticos y un juez): el peso con su sugerencia como botón ancho con el motivo dentro, «Objetivo | Última vez» en columnas y la nota en una misma superficie; «+ Aproximación» en la línea de la serie en lugar de un botón suelto al final; SetTracker a todo el ancho, hasta 6 celdas por fila.
- [x] 13.2 El anillo del descanso se vacía en el sentido de las agujas del reloj.
- [x] 13.3 La sugerencia ignorada también se puede deshacer desde la serie, y un doble toque ya no la aplica dos veces.
- [x] 13.4 La tira de aproximaciones ya no deja un hueco grande debajo cuando el contenido es corto.
- [x] Verificación en emulador a 360 × 780 dp, con la fuente al 100 % y al 130 %: subir y bajar, aplicar, deshacer, doble toque, peso a mano con la sugerencia aplicada, peso corporal, «al fallo», «por lado», 7 series, nota larga y aproximaciones.
- [ ] Verificación en móvil real: lo de la fase 12 y la vibración al aplicar y deshacer la sugerencia.

### Fase 14 — Versión 1.3.2
Notas del usuario del 2026-11-03 tras actualizar el móvil a la 1.3.1.

- [x] 14.1 Resumen: «2 sugerencias / Aplicar las 2» quedaba más bajo y suelto; ahora es una fila con su icono, «1 sube · 1 baja» y el botón tonal centrado. Aplicarlas (aquí y en Hoy) ignora el doble toque.
- [x] 14.2 Hoy: el cardio hecho lleva el mismo ✓ redondo que las rutinas (antes una casilla cuadrada, que además descuadraba el título).
- [x] 14.3 Etiquetas de sección («NOVIEMBRE · 2 entrenos», «HECHO»…) 4 dp hacia dentro de las tarjetas (alineación óptica).
- [x] 14.4 Gráfica de la caminata: el desnivel «+91 m · −86 m» se partía en dos líneas.
- [x] 14.5 Resumen: los ejercicios sin regla (al fallo o manuales) decían «Se mantiene: sin sugerencia: …»; ahora solo «Sin sugerencia: intenta superar tus reps».
- [x] 14.6 Encontrado en la prueba en el móvil: con el teclado abierto, la barra inferior subía unos 100 dp de menos y el teclado tapaba «Serie hecha» (y el «Guardar» de los editores). `Screen` pasa la altura de la cabecera como `keyboardVerticalOffset`.
- [x] Verificación en emulador.
- [x] Verificación en móvil real (OnePlus 7 Pro, 2026-11-03): sugerencia con doble toque, descanso bloqueado, en segundo plano y cerrado, notificación, matar la app, atrás y teclado (§14). Pendiente: caminata de 15 min e imagen «Sin fondo» en Instagram.

### Fase 15 — Versión 1.3.3
Notas del usuario del 2026-11-03 tras usar la 1.3.2.

- [x] 15.1 Dos mancuernas (`exercise.pair`, migración 7): el peso es el de cada una («2 × 10 kg», «Cada mancuerna» en la serie) y el volumen del resumen, de la imagen y del récord «Mayor volumen» cuenta las dos (`volumeOf`). Se activa solo con material «mancuernas» y se cambia en el editor del ejercicio. Las «reps por lado» siguen contando una vez.
- [x] 15.2 El anillo del descanso (y el de la mini barra) avanza de forma continua, no a saltos de 250 ms.
- [x] 15.3 Debajo del anillo, una tarjeta con dos filas: «Serie 1 hecha · Lastre 7,5 kg × 9» (toca para corregir) y «Siguiente».
- [x] 15.4 Gráfica de la caminata: dos datos con etiqueta encima, cada uno centrado en su mitad (en la hoja del mapa, con un hueco a la izquierda igual al botón de desplegar), en lugar de «Medio 11:32 /km» y «+55 m · −55 m»; la nota de la altitud, debajo de la gráfica.
- [x] Verificación en emulador.
- [ ] Verificación en móvil real.

### Fase 16 — Versión 1.3.4
Notas del usuario del 2026-11-04 tras usar la 1.3.3 (versionCode 11, migración 8).

- [x] 16.1 Notificación fija «Entreno en curso» durante todo el entreno, con lo que toca y el tiempo; el descanso se pone encima y vuelve a ella al acabar. Sin burbuja (§6.5).
- [x] 16.2 Sprints: pitido de salida, «Parar» al terminar, distancia y velocidad máxima por GPS, descanso de 1:30 con un pitido corto propio e imagen para compartir (§6.8). Diseñado con agentes (cuatro propuestas, tres críticos y un juez).
- [x] 16.3 La tarjeta Semana de Rutinas viene plegada en una tira de 7 días (§6.7).
- [x] 16.4 La miniatura de la ruta del historial va centrada en la columna de los iconos.
- [x] 16.5 La lectura de las gráficas de progreso y de peso se alinea con el área del dibujo.
- [x] 16.6 La sugerencia de peso de Rutinas va en una caja con «Aplicar» dentro.
- [x] 16.7 Hoy: una frase de ánimo distinta cada día en lugar de «Lo de hoy está abajo».
- [x] 16.8 Pesajes del Perfil: solo los 3 últimos; «Todos los pesajes» abre una pantalla con todos, por meses y con carga por páginas al bajar (§4).
- [x] 16.9 La mancuerna sube hacia la derecha, como el icono de la app.
- [x] 16.10 «Hacer otro cardio»: el cardio de la semana que hoy no toca, en una hoja, para marcarlo o iniciarlo (§6.3, §6.8). Diseñado con agentes (propuestas, dos críticas y un juez), igual que 16.11–16.13.
- [x] 16.11 «Hacer un ejercicio suelto»: cualquier ejercicio de las rutinas, con su peso y su sugerencia, y «Añadir otro ejercicio» (§6.4).
- [x] 16.12 «Hecho» con una fila por entreno, «Continuar entreno» solo en su rutina, los estados vacíos («Día de descanso», «Monta tu semana») y el descanso que ya no dice «Primera serie» de un ejercicio a medias (§6.3, §6.4).
- [x] 16.13 Las Fases se excluyen con el entreno, como los sprints, y borrar una sesión de cardio terminada borra su registro del día (§6.8).
- [x] 16.14 Pitido de salida nativo: por notificación llegaba de 0,4 a 0,8 s tarde en el OnePlus (§14); ahora lo toca la app a su hora (§6.8).
- [x] 16.15 Copias cifradas con una contraseña (PBKDF2-HMAC-SHA256 nativo + AES-256-GCM), en GitHub y al exportar; script para descifrarlas en el ordenador (§9). Pedido por el usuario el 2026-11-04 (puntos 1 a 3 de la propuesta de seguridad; el 4, huella y clave de firma, lo descarta).
- [x] 16.16 Sin copia automática de Android (`allowBackup: false`, §9).
- [x] 16.17 Base de datos cifrada con SQLCipher y clave en el Keystore, con la migración de la base sin cifrar (§10).
- [x] 16.18 En «Hacer otro cardio», los días van en su propia línea (se cortaban).
- [x] Verificación en emulador.
- [ ] Verificación en móvil real (§14, «Sprints» y «Entreno en curso»).

### Fase 17 — Versión 1.4.0
Idea del usuario del 2026-11-04 (inspirada en exercemus): iconos para los ejercicios, músculos principales y secundarios y un mapa del cuerpo en el Perfil; «pon a debate cómo organizarlo bien». Migración 9.

- [x] 17.1 Músculos principales y secundarios por ejercicio (`exercise_muscle`, migración 9), con los 22 del catálogo ya asignados y su editor (§6.7, §6.9).
- [x] 17.2 Iconos por movimiento en el catálogo y en Historial → Ejercicios; búsqueda por músculo en el catálogo y en «Ejercicio suelto»; etiquetas de músculos en el progreso.
- [x] 17.3 Perfil reorganizado: Esta semana (silueta y lectura), peso, la fila Objetivos del día y Mis datos (§4).
- [x] 17.4 Pantallas Músculos (barras frente al plan y la hoja de lo que suma a cada músculo) y Objetivos del día (con el objetivo y la actividad); entradas desde Rutinas y el ⋮ de Dieta.
- [x] Verificación en emulador (datos del Excel y un entreno de pierna): silueta vacía con «Semana pasada», coloreada tras el entreno, toques (también la región doble), detalle, hoja, objetivos en vivo, ejercicio sin músculos (fila ámbar, editor y catálogo filtrado), fuente al 130 %.
- [ ] Verificación en móvil real: la silueta al sol y que la migración 9 asigna los músculos a los ejercicios del usuario (si renombró alguno, saldrá en la fila ámbar).

### Fase 18 — Versión 1.4.1
Pedido del usuario del 2026-11-04 tras usar la 1.4.0: los iconos de los ejercicios también en las rutinas y demás sitios, «más visual y menos bloque de texto», decidido con un equipo de agentes (tres propuestas, dos críticos y un juez).

- [x] 18.1 `SlotRow`: icono, nombre, la carga como cifra a la derecha (`loadFigure`: «35 kg», «2 × 10 kg», «15 kg / lastre», nada sin carga) y la prescripción debajo, en las tarjetas de Rutinas y Hoy, el editor de rutina (también en «Ordenar», donde los nombres ya no se cortan) y «Ejercicio suelto» (donde el nombre se cortaba).
- [x] 18.2 El icono del ejercicio siguiente en el descanso (en lugar de la flecha) y en la cabecera de cada tarjeta del resumen, con sus series en el mismo bloque.
- [x] 18.3 Menos texto: el subtítulo del ejercicio de la rutina sin la prescripción repetida; Historial → Ejercicios «3 sesiones · 4 nov» (se cortaba «última el …»).
- [x] 18.4 Volver a Hoy con `router.dismissTo('/')` en lugar de `replace('/')` («Listo» del resumen y del cardio, descartar, reiniciar datos): creaba otra copia de las pestañas y hacían falta dos «Atrás» para salir de la app. Encontrado al escribir [ARCHITECTURE.md](ARCHITECTURE.md).
- [x] 18.5 [ARCHITECTURE.md](ARCHITECTURE.md): capas, cada pantalla con desde dónde se llega y a dónde lleva, mapas de navegación, base de datos, flujos y segundo plano; AGENTS.md pide mantenerlo al día.
- [x] Verificación en emulador a 360 × 780 dp con la fuente al 100 % y al 130 %: tarjetas de los Días 1 y 2, editor y «Ordenar», «Ejercicio suelto», descanso, resumen, Historial → Ejercicios y «Atrás» tras «Listo».
- [ ] Verificación en móvil real.

### Fase 19 — Versión 1.4.2
Pedido del usuario del 2026-11-05: que PLAN.md refleje lo que hay en la app, con el recordatorio por defecto a las 07:00, y que se puedan editar los datos que solo tenía él («quizás otra persona prefiere algo distinto»), diseñado con agentes (tres propuestas, dos críticos y un juez). Sin migración.

- [x] 19.1 PLAN.md al día con el código (diferencias que encontró ARCHITECTURE.md): ⋮ del ejercicio de la rutina, GPS solo en uso, canal `daily-reminder-v1`, estado `abandoned`, ficheros de sonido, tablas e índices, cuándo se hace la copia automática, recordatorio a las 07:00 en una instalación nueva y la excepción de `_layout.tsx` con las notificaciones.
- [x] 19.2 Proteína, grasa y agua por kilo editables en Objetivos del día, con su efecto en gramos y lo que queda para hidratos (§4).
- [x] 19.3 Ajustes → «Sugerencias de peso»: incremento, cuándo subir y cuándo bajar, con ejemplos calculados por el motor (§6.2, §8); paso de 0,25 kg también en los editores.
- [x] 19.4 Hidratos nunca negativos y aviso «No quedan hidratos» (§4).
- [x] 19.5 Motivos que mentían: «Todas las series» decía «dentro de 10–12» con la media por encima; «si se repite» con 3 o 4 sesiones; el resumen podía decir «Se mantiene» con un motivo de subida (§6.2). Valores imposibles de una copia se limpian al leerlos.
- [x] Verificación en emulador: las tres hojas por kilo con el peso real (la tarjeta cambia en vivo, «Volver a…», tope de 3 g/kg, «No quedan hidratos» con 1,9 g/kg de grasa), las tres hojas de «Sugerencias de peso» con sus ejemplos y el arreglo de la caja de opciones de «Cuándo subir», que se salía por los lados de la hoja (aviso del usuario).
- [ ] Verificación en móvil real. Aplazada al 2026-11-06 a petición del usuario («es tarde, mañana te lo conectaré»); la 1.4.2 ya quedó instalada en su móvil el 2026-11-05. Qué probar:
  - [ ] Se instala encima de la 1.4.1 sin perder nada y Objetivos del día enseña sus valores de siempre (2 g/kg, 1 g/kg, 35 ml/kg) y sus gramos con su último peso.
  - [ ] Cambiar la proteína mueve la tarjeta, Dieta enseña los objetivos nuevos y «Volver a 2 g/kg» deja todo como estaba.
  - [ ] Ajustes → «Sugerencias de peso» enseña 2,5 kg, «Por la media» y «Tras 2 sesiones», con las hojas a su tamaño de letra; la de incremento cuenta sus ejercicios con incremento propio.
  - [ ] Cambiar una regla no toca la sugerencia abierta de Rutinas; en el siguiente entreno, − y + del peso usan el incremento (dejarlo en 2,5 kg al terminar).
  - [ ] Aprovechar para lo pendiente en móvil de las fases 16 a 18.
- [ ] Revisar con una fuente los músculos de los 22 ejercicios (`CATALOG_MUSCLES`, migración 9). Se asignaron a criterio en la 1.4.0: de exercemus solo se tomó la lista de músculos, no el reparto de cada ejercicio. Comparar con los principales y secundarios de exercemus y de ExRx y enseñar las diferencias al usuario antes de cambiar nada. Si hay que corregir, va en una migración nueva que no pise lo que él haya cambiado en el editor.


### Fase 20 — Versión 1.4.3
Pedido del usuario del 2026-11-05 con la captura de una historia de «Ver hormigas»: fotos en las caminatas y actividades, la marca y «© OpenStreetMap» abajo del todo en la imagen y elegir formato (cuadrado o 9:16); y, solo como ideas, rutas a lo Wikiloc (§16). Migración 10; módulos nativos nuevos (`expo-image-picker`, `expo-image-manipulator`): hace falta recompilar.

- [x] 20.1 Fotos en el detalle de cualquier sesión de cardio y en el resumen del entreno: hacer una o elegirlas de la galería, verlas una por página y quitarlas (§6.10).
- [x] 20.2 Cámara durante la caminata: la foto se queda en ese punto de la ruta y sale en el mapa; las de la galería, por su GPS o su hora (§6.10).
- [x] 20.3 Imagen para compartir: formato Historia · 9:16 o Cuadrado · 1:1, estilo Foto (la foto de fondo) y la marca y «© OpenStreetMap» en la última línea (§6.8).
- [x] Verificación en emulador (Android 16, 360 × 780 dp): elegir 3 fotos de la galería (una guardada de lado con EXIF 6 sale derecha; copias de 2160 px sin EXIF), cámara del sistema desde el resumen (permiso, copia y original en la galería), cámara a mitad de una caminata con GPS simulado («Foto añadida en la ruta» y la cámara en el mapa del directo y del detalle), una foto de la galería fechada dentro de esa caminata sin pausas se coloca sola en su punto, visor (deslizar, fecha, «Quitar foto»), borrar la caminata borra sus ficheros, e imágenes Mapa, Foto, Oscuro y Sin fondo de caminata y de entreno en los dos formatos. Corregido en ella: el visor se quedaba en negro o decía «No se encontró esta foto» al quitar la foto con la que se abrió; su pie quedaba bajo la barra de gestos; en el cuadrado con mapa la ruta salía a un cuarto de tamaño (el zoom va a saltos: más alto de mapa y menos margen); con una foto clara, el texto del entreno se leía mal (se oscurece toda la foto); la vista previa se cortaba por abajo con la fila de fotos.
- [ ] Verificación en móvil real: foto con la cámara a mitad de una caminata (la cámara en su sitio del mapa y el original en la galería), elegir varias de la galería, que una caminata sin pausas coloque las fotos de su hora, quitar una, imagen Foto en historia y en cuadrado en Instagram, y copia → modo pruebas → restaurar con las fotos de vuelta.

---

## 14. Pruebas

- **Unitarias** (Jest, `src/domain/__tests__`): nutrición, progresión, calendario/mensajes, máquina de estados, conversión de días, formateo es-ES. Son los fixtures de §4, §5 y §6.2.
- **Integración** (`src/db/__tests__`): importación del seed, sesiones y recomendaciones sobre SQLite real en memoria (`node:sqlite` vía `createTestDb()`).
- **Manual en dispositivo** (checklist antes de cerrar las fases 2 y 3):
  - [x] Descanso suena con pantalla bloqueada (≤ 3 s). OnePlus 7 Pro, Android 12: 1,7 s y 1,1 s de retraso medidos con `dumpsys`.
  - [x] Descanso suena con la app cerrada desde multitarea (el servicio de la cuenta atrás mantiene vivo el proceso; la alarma es de `AlarmManager`).
  - [x] −30/+30/Saltar reprograman o cancelan bien (no suena una notificación antigua).
  - [x] Matar la app durante el descanso y reabrir: estado correcto. Con `am crash` la alarma sigue, suena (1,9 s de retraso) y al reabrir sale «¡Descanso terminado!». La cuenta atrás y la burbuja mueren con el proceso.
  - [ ] Recordatorio diario en modo avión y tras reiniciar.
  - [x] Cambiar la hora del recordatorio no deja notificaciones duplicadas (siempre 7 alarmas).
  - [x] Modo silencio / No molestar: el fin del descanso suena con No molestar activo (canal con uso de alarma). Probado en el OnePlus.
  - [x] Con el móvil bloqueado se ve la cuenta atrás del descanso y desaparece al llegar a 0. Para que salga arriba y al momento en Android 12+, la notificación es coloreada, tiene grupo propio y `FOREGROUND_SERVICE_IMMEDIATE`.
  - [x] Al salir de la app durante el descanso aparece la burbuja; se puede arrastrar; tocarla vuelve al entreno; desaparece al volver a la app. En OnePlus el permiso abre la lista general de apps (la app lo indica).
- **No regresión de la 1.3.0** (en el OnePlus, antes de darla por buena):
  - [x] Descanso con la pantalla bloqueada, con la app en segundo plano y con la app cerrada: suena con 3 s de retraso como mucho. 2026-11-03, 1.3.2 (descansos acortados con −30 s, móvil cargando por USB): 0,16 s, 0,14 s y 0,16 s; tras matar la app, 0,11 s.
  - [x] Tocar la notificación vuelve al descanso, con la acción correcta en la barra.
  - [x] Matar la app en mitad de una serie y en mitad de un descanso: vuelve igual (Hoy ofrece «Continuar entreno», que abre la serie o el descanso con el tiempo que quedaba; la alarma sigue programada).
  - [x] Doble toque rápido en «Serie hecha»: una sola serie y el descanso en marcha.
  - [x] Atrás con una hoja o el ⋮ abiertos: se cierra la capa sin salir de la pantalla.
  - [ ] Caminata de 15 min, 5 de ellos con el móvil bloqueado, con pausa y reanudación.
  - [x] Teclado: reps en la barra, título y «Guardar» siguen visibles. Falló en el OnePlus (el teclado tapaba la parte de abajo de la barra); corregido en la 1.3.2 (14.6).
  - [ ] Imagen «Sin fondo» en Instagram (¿respeta la transparencia?).
- **Entreno en curso (1.3.4)**, en el OnePlus:
  - [x] La notificación sale arriba al empezar, cambia a la cuenta atrás en el descanso y vuelve sola al acabar; desaparece al descartar. 2026-11-04, OnePlus (Android 12), con un ejercicio suelto: «Ejercicio suelto · Serie 1 de 3 · Remo con barra (90º) · 35 kg» → «Descanso» → «Serie 2 de 3…».
- **Hacer otra cosa (1.3.4)**, en el OnePlus:
  - [ ] Un cardio del pool (marcar e iniciar una caminata): sale en «Hecho» y desaparece del pool; el ✓ lo devuelve. *(El pool con los datos reales sí: Caminar L-M-J-V agrupada, las dos bicis y Descanso / Caminar.)*
  - [x] Ejercicio suelto: la notificación «Ejercicio suelto» cambia con cada serie y desaparece al descartar.
  - [ ] Matar la app (`am crash`) con un ejercicio suelto en curso y reabrirla: vuelve la notificación con el título y el texto correctos.
- **Seguridad (1.3.4)**, en el OnePlus, con los datos copiados en GitHub:
  - [ ] Instalar encima de la versión con la base sin cifrar (sin modo pruebas): todo sigue igual y la base ya no empieza por «SQLite format 3».
  - [ ] Poner contraseña → la copia de GitHub es ilegible; `scripts/decrypt-backup.mjs` la abre con la contraseña; restaurarla en el móvil no la pide (misma sal) y en uno sin la clave sí. Cuánto tarda la clave en el OnePlus.
  - [x] Pitido nativo: `[sprint] pitido N ms` con la app delante, bloqueada y matada (≤ 0,05 s y variación ≤ 0,05 s). 2026-11-04 en el OnePlus: delante 41, 8 y 13 ms; con la pantalla bloqueada, 3 ms; matando la app en el descanso, 2 ms (la alarma de respaldo). Antes, por notificación, de 360 a 840 ms. Aprende una latencia de salida de ~75 ms.
  - [ ] Oírlo: suena en modo silencio y con No molestar, y una salida anulada no suena.
- **Sprints (1.3.4)**, en el OnePlus, con los datos copiados en GitHub y el modo pruebas activo:
  - [x] Retraso del pitido con la app delante, con la pantalla bloqueada y con la app matada: ≤ 0,3 s y variación ≤ 0,1 s, 10 de 10. **No se cumple** (2026-11-04, 5 salidas): la alarma llega a su hora, pero Android retiene la notificación ~200 ms antes de sonar (`mCreationTimeMs` → `mInterruptionTimeMs`, la espera del asistente de notificaciones) y SystemUI prepara el reproductor después. El sonido queda listo de +0,36 a +0,84 s tras la salida (delante: +0,36, +0,57 y +0,84; bloqueado: +0,47; con la app matada: +0,68). La línea `[sprint] pitido N ms` del JS engaña (dice 9–123 ms): mide cuándo llega a la app, no cuándo suena. → pitido nativo (16.14).
  - [ ] Suena con el volumen de alarma, en modo silencio y con No molestar, y se distingue a la primera del sonido del descanso. *(Va por el flujo de alarma, `streamType=4`; la política de No molestar del OnePlus deja pasar las alarmas. Falta oírlo.)*
  - [ ] Volver a la app menos de 1 s antes de la salida: el pitido suena una sola vez.
  - [ ] Doppler: en `lap_fixes`, qué parte de los puntos en movimiento trae velocidad; desfase `received_at − t`.
  - [ ] De 3 a 6 sprints sobre 60–100 m medidos al aire libre: error ≤ 5 m en los de calidad buena y una punta creíble; ajustar `GPS_LAG_MS`. **Pendiente: lo hará el usuario en un día de sprints.** Después, leer `laps` y `lap_fixes` de esas sesiones en su copia de GitHub y compararlos con la distancia real que diga.
  - [x] Bloquear con PIN en el descanso: el pitido suena y el botón de encendido muestra «Parar» sin pedir el PIN; tocarlo para el sprint y empieza el descanso con el móvil bloqueado.
  - [x] Matar la app (`am crash`) en la cuenta atrás: la alarma levanta el proceso, el pitido suena y al abrir la app el sprint sigue corriendo desde la salida; a los 60 s, «¿Se te olvidó parar?» y «Quitar este sprint» funcionan. Al terminar no queda ninguna notificación.
  - [ ] Doble toque en «Parar», «Deshacer», salida anulada, ±30 s, Saltar descanso, Otro sprint, Terminar ahora y «Seguir sin GPS».
  - [ ] Imagen Oscuro y Sin fondo en Instagram.

---

## 15. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Alarmas retrasadas por Doze o por la capa del fabricante | Permiso de alarma exacta, exclusión de optimización de batería, diagnóstico, Plan B nativo (§7.4). |
| OnePlus/ColorOS (Android 12) convierte las alarmas exactas de apps que no están en su lista interna en inexactas (ventana del 75 % del tiempo restante, máx. 1 h); quitar la optimización de batería no lo cambia | El descanso usa `setAlarmClock` (`delivery: 'alarmClock'`), que no se toca. El recordatorio diario puede llegar hasta 1 h tarde: pendiente de decidir si pasarlo también a `alarmClock` (icono de alarma fijo en la barra). |
| Canales de Android inmutables | Versionar el id del canal al cambiar sonido/importancia. |
| Desfase de convención de días (ISO vs expo) | Conversión única en el borde + test. |
| Pérdida de datos (móvil perdido o reinstalación) | Export JSON y auto-backup GitHub (§9). |
| Migraciones de BD que rompan datos | Migraciones versionadas con `PRAGMA user_version` (`src/db/migrations.ts`), solo se añaden al final; nunca editar una ya publicada; exportar backup antes de actualizar. |
| Datos personales en un repo público | Excel, backups y tokens fuera del repo (`.gitignore`); el seed no incluye fecha de nacimiento. |
| Pitido de salida de los sprints con retraso o irregular con la app delante (va por una notificación) | Medirlo en el OnePlus (§14); si falla, pitido nativo con `SoundPool` (§16). |
| GPS de móvil en sprints de 10–15 s (precisión, Doppler que falta, desfase de reloj) | Calidad «débil» (≈) visible, puntos guardados (`lap_fixes`) para recalcular y constantes que se ajustan tras medir en pista. |
| Enfriamiento de notificaciones de Android 15+ (baja el volumen de avisos seguidos de la misma app) | Comprobar que el pitido no baja de un sprint a otro. |
| Dos notificaciones fijas a la vez en sprints (GPS y cuenta atrás) | Asumido: la del GPS sirve para volver a la app. |
| Olvidar la contraseña de las copias cifradas | No hay recuperación (es la idea): la pantalla pide guardarla en un gestor de contraseñas. La base del móvil no depende de ella. |
| Perder la clave de la base cifrada (Keystore borrado sin desinstalar) | La base se aparta y se restaura la última copia de GitHub; sin copia, se pierde lo del móvil. |
| El pitido nativo no suena si se mata la app en los 2 s antes de la salida (la alarma ya saltó) | Asumido: matarla justo ahí es raro; al volver, el sprint está en marcha desde su hora. |
| Las imágenes de las fotos no van en la copia de GitHub | Las de la galería siguen en la galería y las de la cámara se guardan también allí; perder el móvil pierde solo qué foto era de qué sesión. Subirlas a GitHub, idea en §16. |
| Android destruye la actividad mientras la cámara o el selector están abiertos (poca memoria) y se pierde la foto | Asumido de momento (no se usa `getPendingResultAsync`); durante una caminata el servicio del GPS mantiene vivo el proceso. |

---

## 16. Ideas futuras (fuera de alcance)

**A debatir (seguridad y servidor; el usuario lo pidió el 2026-11-04, antes de quitar GitHub):**
- Autenticación con un proveedor (Supabase Auth, Firebase Auth u otro OIDC), no hecha a mano: sesiones cortas, el token de refresco en el almacén seguro y la sesión iniciada para siempre en el móvil (el usuario descarta el bloqueo con huella).
- Datos en Postgres con seguridad por filas (`user_id` en cada fila y una política que solo deje verla a su dueño); solo HTTPS; cifrado en reposo y en las copias del servidor.
- ¿Cifrado de extremo a extremo? El móvil cifra antes de enviar y el servidor solo guarda datos ilegibles: aunque lo roben, no se lee nada. El precio: sin la contraseña no hay recuperación, y el servidor no puede buscar ni hacer estadísticas.
- Límites de peticiones, secretos fuera del repositorio y registro de accesos. Peso y fecha de nacimiento son datos de salud: guardar solo lo necesario.
- Descartado por ahora: bloqueo con huella al abrir la app y clave de firma propia del APK.

**Rutas a lo Wikiloc** (pedido del usuario del 2026-11-05, solo ideas; sin hacer):
- **Mis rutas**: «Guardar como ruta» en una caminata (o automático al repetirla) y una lista con su mapa, distancia, desnivel, cuántas veces y el mejor tiempo; cada vez que la repites, la comparas con las anteriores (tiempo, ritmo, la gráfica de todas).
- **¿Es la misma ruta?**: primero un filtro barato (salida y llegada a menos de 200 m, distancia ±15 %); después la forma: dividir el mapa en cuadrados de ~25 m, marcar los que pisa cada caminata (con uno de margen por el error del GPS) y comparar: si comparten ≥ 85 % en los dos sentidos, es la misma; al revés, «la misma, en sentido contrario»; entre 50 y 85 %, «variante de…» y que decida el usuario. La primera vez se pregunta; después, solo. Función pura con tests (`routeMatch`).
- **Seguir una ruta**: al iniciar una caminata, elegir una de Mis rutas (o un GPX importado de Wikiloc) y verla en gris bajo la tuya, con lo que llevas y lo que queda. **Aviso al salirte** (activable): distancia del punto a la ruta > 40 m con precisión buena durante 3 lecturas seguidas → vibración y notificación «Te has salido de la ruta» (también con la pantalla bloqueada: lo comprueba la tarea del GPS, que ya corre cada 3 s); al volver, una vibración corta. Con histéresis para no avisar en cada curva.
- **GPX**: exportar una caminata como GPX (compartir) e importar uno para seguirlo. El mapa necesita internet; para el campo sin cobertura, guardar las teselas del pasillo de la ruta antes de salir. El aviso no necesita mapa.
- Las fotos con sitio (1.4.3) serían los puntos de interés de la ruta.

**Fotos** (fase 20): subir también las imágenes a GitHub (un fichero por foto, cifrado si hay contraseña, solo las nuevas); recuperar una foto si Android cierra la app con la cámara abierta (`getPendingResultAsync`); recortar o elegir el encuadre en la imagen para compartir; formato 4:5 de Instagram; limpiar las imágenes sin fila.

**Músculos** (fase 17): la silueta de cada entreno en su resumen y en la imagen para compartir; avisos del plan en el editor de rutinas (un músculo una sola vez por semana, sprints menos de 24 h después de trabajo excéntrico de isquios); constancia (series hechas frente a las planificadas por semana) y récords en vez de niveles. Descartado: importar exercemus, radar, niveles e insignias por volumen, rankings con amigos (piden servidor), semáforo de recuperación de 48 h y «generar entreno» (sin slot no hay peso ni progresión).

Registro diario de comidas reales y lista de la compra · estimación de 1RM · deload automático tras estancamiento · widget de pantalla de inicio con "lo de hoy" · integración con Health Connect (pasos, peso) · versión iOS · horario de estudio del Excel (pestaña "Rutina") como agenda diaria · sprints: parar con el botón de volumen o desde la notificación, detectar la parada con el GPS, cuenta previa configurable, distancia marcada, gráfica de velocidad por sprint, récords entre sesiones y recalcular sesiones antiguas desde `lap_fixes` · hacer otra cosa: ejercicio «solo hoy» dentro de un entreno de rutina, ejercicio del catálogo que no está en ninguna rutina, peso solo para esa sesión, repetir el mismo cardio el mismo día, cardio sin día (catálogo de cardio) y marcar una actividad con GPS desde el pool sin grabarla.

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
- 2026-11-01 — Fase 5: historial con entrenos, ejercicios y cardio; progreso por ejercicio con récords y gráficas (`react-native-svg`); corregir o borrar entrenos terminados con recálculo de recomendaciones.
- 2026-11-01 — Fase 7: dieta editable (catálogo de alimentos, añadir/cambiar/quitar en el plan, copiar día) con totales coloreados frente a objetivos.
- 2026-11-01 — Fase 6: gráfica del peso corporal en Perfil. Fase 9: icono propio (mancuerna) para lanzador, icono adaptativo/monocromo, splash y barra de notificaciones.
- 2026-11-01 — Pruebas en móvil real (OnePlus 7 Pro, Android 12): copia en GitHub, burbuja, cuenta atrás en la pantalla de bloqueo, ±30 s/Saltar y cierre desde multitarea. Cuenta atrás coloreada, inmediata y con el icono de la app; burbuja sin borde; aviso del permiso de la burbuja en OnePlus. Encontrado: OnePlus retrasa las alarmas exactas normales (ver §15).
- 2026-11-01 — **Versión 1.0.0.** Modo pruebas desactivado por defecto (y siempre apagado tras restaurar una copia): el usuario empieza a usar la app con sus datos reales. El recordatorio diario se queda sin `alarmClock` de momento (el usuario prefiere ver si llega a su hora).
- 2026-11-02 — **Fase 10** (notas del primer entreno real). Errores: «atrás» en el descanso o en una serie lleva a la lista de ejercicios (con el descanso visible arriba) y las notificaciones ya no apilan copias del entreno (`router.navigate`); las cajas del resumen tienen la misma altura. Interfaz: Hoy agrupa «Para hoy» / «Hecho» con rutinas compactas y casilla de hecho; tarjeta «Rutina completada» y diálogos propios (`showDialog`) en toda la app; hora del recordatorio con el reloj nativo; atajos de descanso; sugerencia de peso en la línea del ejercicio; botones de texto alineados al borde. Cardio (§6.8, migración 4): caminatas con GPS en segundo plano (`expo-location` con servicio en primer plano, sin permiso «siempre») y mapa de OpenStreetMap; temporizador LISS/MISS/HIIT con alarmas por fase. Detalle de la caminata con gráficas de velocidad y altitud y parciales por km. La app compilada ya no incluye los datos del Excel (solo catálogos). Probado en el emulador (Android 16); falta probar GPS y alarmas del temporizador en el móvil real. **Versión 1.1.0** (versionCode 2).
- 2026-11-02 — **Versión 1.1.1.** El historial de cardio lista cada sesión terminada (antes, dos caminatas de la misma actividad el mismo día dejaban solo la última enlazada; la otra quedaba guardada pero sin acceso). Una caminata sin recorrido explica por qué no tiene gráficas ni parciales.
- 2026-11-02 — **Versión 1.1.2.** La versión instalada aparece al final de Ajustes. Reiniciar los datos conserva la configuración de la copia en GitHub.
- 2026-11-02 — **Versión 1.1.3**, tras probar la 1.1.2 en el OnePlus con el ciclo copia en GitHub → modo pruebas → reiniciar → probar → restaurar (todo volvió igual). Encontrado y corregido: reiniciar los datos apagaba el modo pruebas y vaciaba la fecha de la última copia, así que la copia automática habría subido los datos vacíos encima de la buena (no llegó a pasar; ahora `resetData` conserva ambos). Etiquetas de los números del plan de cardio en una línea («Calentamiento» se partía) y aviso de «señal del GPS débil» cuando la precisión no vale para medir.
- 2026-11-02 — **Versión 1.2.0** (fase 11). En la tarjeta Semana de Rutinas, tocar un día abre su editor (rutinas de ese día como casillas y su cardio) y «Editar» arriba abre el cardio de toda la semana, en lugar del botón «Cardio semanal» al final. Ajustes muestra solo la versión. Fuera los botones «Probar descanso» y «Probar recordatorio».
- 2026-11-03 — **Versión 1.3.0** (fase 12, versionCode 7, migraciones 5 y 6), tras la primera caminata de verdad. Caminata: mapa con 3D y ampliar en la esquina y mapa a pantalla completa (MapLibre en un WebView, 2D/3D con relieve, satélite PNOA, marcas de km), una sola gráfica con selector, cursor sincronizado con el mapa, pellizco y doble toque; panel de métricas en el que cualquier dato pasa a la cifra grande y la distancia cambia entre km y metros; en directo, gráfica y parciales en vivo sin scroll. Entreno: series de aproximación que no cuentan, título editable e imagen para compartir (historia de 1080 × 1920, estilos Mapa, Oscuro y Sin fondo; guardar en la galería o compartir). Interfaz: sistema de diseño común (§12) decidido tras una revisión con agentes que probaron cada pantalla, debatieron las propuestas y un juez las cerró; regla de lint que lo hace cumplir; barra de acción fija con protección del doble toque, «Empezar rutina» que abre la primera serie, descanso con anillo y corrección sin cortarlo, listas en lugar de tarjetas, editores con un solo «Guardar» y «Deshacer» en lugar de confirmar. Nuevo módulo nativo `expo-media-library` y `isIgnoringBatteryOptimizations()` en `rest-timer`: hace falta recompilar. Verificado en el emulador a 360 × 780 dp con la fuente al 100 % y al 130 %; falta la lista de no regresión en el móvil (§14).
- 2026-11-03 — **Versión 1.3.1** (fase 13, versionCode 8). Pantalla de la serie rediseñada con agentes (propuestas, debate y juez): una ficha con el peso y su sugerencia como botón ancho con el motivo dentro, «Objetivo | Última vez» en columnas y la nota; «+ Aproximación» junto a «Serie 1 de N». El anillo del descanso se vacía en sentido horario. Encontrado y corregido en el emulador: un doble toque en la sugerencia lanzaba dos escrituras a la vez («cannot start a transaction within a transaction») y la tira de aproximaciones (de la 1.3.0) dejaba un hueco grande debajo.
- 2026-11-03 — **Versión 1.3.2** (fase 14, versionCode 9). Resumen con una fila para aplicar varias sugerencias (con cuántas suben y bajan), ✓ redondo también para el cardio hecho en Hoy, etiquetas de sección con alineación óptica, desnivel de la gráfica en una línea y sin el doble «Se mantiene: sin sugerencia:». «Aplicar las N» (resumen y Hoy) tenía el mismo fallo de doble toque que la sugerencia de la serie. En el OnePlus, el teclado tapaba la parte de abajo de la barra inferior (faltaba restar la cabecera). Descanso en el OnePlus: 0,16 s de retraso con la pantalla bloqueada, 0,14 s en segundo plano, 0,16 s cerrada desde multitarea y 0,11 s tras matar la app.
- 2026-11-03 — **Versión 1.3.3** (fase 15, versionCode 10, migración 7). Ejercicios con dos mancuernas: el volumen las cuenta a las dos y el peso se muestra como «2 × 10 kg». Anillo del descanso continuo (Reanimated) y lo de debajo en una tarjeta. Gráfica de la caminata con dos datos (media y mejor km, media y máxima, subida y bajada) y la nota de la altitud debajo.
- 2026-11-04 — **Versión 1.3.4** (fase 16, versionCode 11, migración 8). Notificación fija «Entreno en curso» durante el entreno (nuevo modo del módulo `rest-timer`: `startOngoing` / `stopOngoing`, con la cuenta atrás del descanso encima). **Sprints**: cuarto tipo de seguimiento, con pitido de salida propio, «Parar», medición por GPS (distancia y velocidad máxima), descanso, tabla, historial e imagen para compartir; diseñado con agentes (cuatro propuestas, tres críticos y un juez). La actividad «Sprints + Bouncing» pasa sola a Sprints (6 × 1:30); para volver, Fases → HIIT. «Temporizador» se llama ahora «Fases». Semana plegable en Rutinas, Perfil con los 3 últimos pesajes y una pantalla con todos (carga por páginas), sugerencias en caja, frase de ánimo en Hoy, miniatura de la ruta centrada, lectura de las gráficas alineada con el dibujo y mancuerna hacia la derecha. El Snackbar no acepta su acción hasta 600 ms después de aparecer. Hace falta recompilar (sonido, canal y módulo nativo). Verificado en el emulador (Android 16): notificación del entreno con descanso encima y vuelta sola; sprints con GPS simulado (`scripts/simulate_sprint.py`): pitido a su hora (de −40 a +236 ms en el registro con la app delante), Parar, salida anulada, sprint olvidado, Terminar ahora, detalle, historial, Hoy e imagen. Sin Doppler, el emulador mide desde las posiciones (≈ 69 m, máx. ≈ 29,7 km/h en la recta de prueba); falta el móvil (§14).
- 2026-11-04 — **1.3.4, «Hacer otra cosa»** (16.10–16.13; analizado, diseñado y juzgado con agentes). En Hoy, «Hacer otro cardio» (el cardio de la semana que hoy no toca, agrupado y sin repetir, `cardioPool`) y «Hacer un ejercicio suelto» junto a «Entrenar otra rutina». Un ejercicio suelto es una sesión sin rutina con slots prestados (sin migración): su peso, su sugerencia y «Añadir otro ejercicio»; cuenta para la progresión, pero un «mantener» suelto no borra la sugerencia de la rutina. «Hecho» lista cada entreno del día. Las Fases tampoco pueden ir a la vez que un entreno, y borrar una sesión de cardio terminada borra su registro. Encontrado y corregido en el emulador: el descanso decía «Primera serie» al volver a un ejercicio a medias (también en las rutinas). Solo cambia el JS. Verificado en el emulador: pool, exclusiones, selector, Atrás que descarta, Añadir otro ejercicio, «Cambiar peso», resumen, Hoy e historial; falta el móvil (§14).
- 2026-11-04 — **1.3.4, seguridad y pitido nativo** (16.14–16.18), tras probar en el OnePlus. El pitido por notificación llegaba de 0,4 a 0,8 s tarde y cada vez distinto (Android retiene ~200 ms la notificación y SystemUI prepara el reproductor después): ahora lo toca la app desde su propio proceso con un `AudioTrack` ya cargado (y una alarma de respaldo si el proceso muere), y mide y aprende su latencia: en el OnePlus suena de 2 a 41 ms después de la salida. Copias cifradas con contraseña (PBKDF2-HMAC-SHA256 nativo, 600 000 iteraciones, + AES-256-GCM; scrypt en JavaScript tardaba ~50 s en el OnePlus) en GitHub y al exportar, con `scripts/decrypt-backup.mjs` para el ordenador; base de datos cifrada con SQLCipher y clave en el Keystore, migrando la que había; sin copia automática de Android. Los días del pool de cardio en su línea. Apuntado para debatir (§16): autenticación y servidor. En el OnePlus (Android 12) se comprobó: «Entreno en curso», «Parar» sobre la pantalla de bloqueo con PIN, `am crash` en la cuenta atrás, «¿Se te olvidó parar?» y el pool con los datos reales; ciclo copia → modo pruebas → pruebas → restaurar sin perder nada. Hace falta recompilar (SQLCipher, módulo nativo).
- 2026-11-04 — **Versión 1.4.0** (fase 17, versionCode 12, migración 9). Músculos principales y secundarios en cada ejercicio (18 en español, el hombro en tres partes; los 22 del catálogo ya asignados), con su editor, iconos por movimiento, búsqueda por músculo y etiquetas en el progreso. Perfil reorganizado tras un debate con agentes: «Esta semana» con la silueta de frente y de espalda (`react-native-body-highlighter`) pintada por las series hechas (1 por serie al principal, 0,5 al secundario; cortes en 3, 6 y 10) y el plan en las cifras; pantallas Músculos (barras frente al plan con la franja de 10 a 20) y Objetivos del día (con el objetivo y la actividad, también desde Dieta). Solo cambia el JS (la librería es JS puro): basta con recargar el bundle o recompilar el APK. Verificado en el emulador; falta el móvil.
- 2026-11-04 — **Versión 1.4.1** (fase 18, versionCode 13, sin migración). Iconos de ejercicio en las rutinas y demás sitios, decididos con agentes (tres propuestas, dos críticos y un juez): una fila común `SlotRow` (icono, nombre, la carga como cifra y la prescripción debajo) en las tarjetas de Rutinas y Hoy, el editor de rutina y «Ejercicio suelto»; el icono del siguiente en el descanso y en las tarjetas del resumen; menos texto repetido. Volver a Hoy con `dismissTo` (con `replace` quedaban dos pilas de pestañas). Nuevo [ARCHITECTURE.md](ARCHITECTURE.md). Solo cambia el JS.
- 2026-11-05 — **Versión 1.4.2** (fase 19, versionCode 14, sin migración). PLAN.md al día con el código. Proteína, grasa y agua por kilo editables en Objetivos del día (con su efecto en gramos y los hidratos que quedan, que ya no salen negativos), y en Ajustes la sección «Sugerencias de peso» (incremento de 0,25 en 0,25, cuándo subir, cuándo bajar), con ejemplos calculados por el motor; las reglas valen desde el próximo entreno. Arreglados motivos que mentían en el modo «Todas las series» y con 3 o 4 sesiones para bajar. Diseñado con agentes. Solo cambia el JS.
- 2026-11-05 — **Versión 1.4.3** (fase 20, versionCode 15, migración 10). **Fotos** en cualquier sesión de cardio y en el resumen del entreno: con la cámara (el original va también a la galería) o de la galería, una copia de 2160 px en la app, visor una por página y «Quitar foto»; durante la caminata, una cámara en la cabecera deja la foto en ese punto de la ruta, y las de la galería se colocan por su GPS o su hora (caminatas sin pausas). La copia de GitHub lleva las filas, no las imágenes. **Imagen para compartir**: formato Historia · 9:16 o Cuadrado · 1:1, estilo Foto con la foto de fondo, y la marca y «© OpenStreetMap» en la última línea, abajo del todo (aviso del usuario con su historia de «Ver hormigas»). Ideas de rutas a lo Wikiloc en §16, sin hacer. Módulos nativos nuevos (`expo-image-picker`, `expo-image-manipulator`): hace falta recompilar. Verificado en el emulador; falta el móvil.
