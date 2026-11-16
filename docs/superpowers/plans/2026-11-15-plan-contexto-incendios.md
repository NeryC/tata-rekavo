# Plan de implementación: focos, áreas quemadas y contexto territorial

> Plan para ejecutar por etapas independientes. Este documento no implementa ni publica cambios.

## Estado de ejecución — 15/11/2026

| Etapa | Estado | Evidencia o siguiente paso |
|---|---|---|
| 1. Claridad de datos | Terminada (PR #31) | Textos y período real revisados; 93 pruebas, compilación y navegador en español/inglés a 375 y 1440 px correctos. |
| 2. Fecha y procedencia | Terminada (PR #33) | 103 pruebas y compilación correctas; navegador en español/inglés a 320, 375 y 1440 px con Paraguay (GMT-3) y Bolivia (GMT-4). Ventana emergente del foco comprobada: abre con clic o toque y cierra al tocar fuera. |
| 3. Área quemada | Terminada (piloto Paraguay) | `data/app/burned_area.json`: hectáreas por año y mes, país y 17 departamentos, 1999–2024, a 30 m. Validación con MODIS MCD64A1 (2001–2024): correlación interanual r = 0,81; MapBiomas da una mediana de 0,74 veces el área de MODIS. Las versiones muestreadas (90–300 m) se descartaron: usan pirámides de la imagen y difieren hasta 40 %. |
| 4. Caso Cerro Corá | Bloqueada | Requiere permiso de los autores del póster para reutilizar imágenes, fotos y límites; sin permiso, solo un resumen propio con referencia. |
| 5. Compartir para verificación | Terminada (PR #35) | Enlace `f=lat,lon,hora UTC` con ubicación redondeada a ~1 km; tarjeta para quien lo recibe; 108 pruebas, compilación y navegador a 320 y 1440 px en español e inglés. |

**Copia de trabajo:** rama `feat/contexto-incendios` basada en `origin/main`. Los 15 archivos locales de etapas anteriores coincidían con lo publicado y se guardaron en el respaldo de Git `respaldo de archivos ya publicados`; no había archivos preparados para commit. La configuración `.claude/settings.local.json` se conserva sin modificar.

Actualizar esta tabla al comenzar y terminar cada etapa, con pruebas, PR y bloqueos reales.

**Objetivo:** ayudar a interpretar qué detectó el satélite, qué superficie se identificó como quemada y qué información requiere confirmación, sin convertir Tata Rekavo en un sistema de despacho de emergencias.

**Arquitectura:** conservar la serie armonizada actual; añadir mensajes y filtros sobre sus datos existentes; preparar un producto opcional de área quemada con MapBiomas para Paraguay; y presentar Cerro Corá como caso histórico con fuentes y permisos identificados. Cada etapa debe poder integrarse y revertirse por separado.

**Tecnología existente:** React, TypeScript, Vite, MapLibre, Python, datos estáticos y almacenamiento R2. Respetar `CONTRIBUTING.md`: rama y PR por etapa, sin cambios directos a `main`.

**Alcance:** Paraguay primero; español e inglés; escritorio y móvil. Mantener el funcionamiento de Bolivia, Ecuador, Perú y Uruguay, así como los enlaces compartidos, las descargas y las capas actuales.

## Hallazgos del 15/11/2026

**MapBiomas Fuego Paraguay (etapa 3A).** Colección 1, 1999–2024, productos anual, mensual, acumulado y frecuencia, Landsat 30 m; en el producto anual 1 = quemado, 0 = no quemado. Licencia CC BY 4.0 («uso público, abierto y gratuito, sujetos a citación»); falta el texto exacto de cita. La página de descargas solo enlaza la plataforma en línea; los datos están en Earth Engine, por ejemplo `projects/mapbiomas-public/assets/paraguay/fire/collection1/mapbiomas_paraguay_fire_collection1_annual_burned_v1` y `..._monthly_burned_v1` (confirmar en Earth Engine). Las estadísticas publicadas solo cubren cobertura y transiciones, no área quemada. Para validar el piloto habrá que comparar con la plataforma oficial o con MODIS MCD64A1. [Descargas](https://paraguay.mapbiomas.org/descargas/mapbiomas-fuego/).

**Tierras Indígenas del Paraguay (posible mejora de la capa indígena).** El visor tierrasindigenas.org.py usa la capa pública `comunidades_indigenas_08_02_2024` (usuario de ArcGIS `fapi2018`): 846 polígonos con comunidad, pueblo, familias, situación de titulación, departamento, distrito, superficie legal y fuente; última edición 06/06/2024. No declara licencia ni cita. No usarla hasta tener autorización escrita de FAPI con licencia y forma de cita. Sus alertas de incendios son VIIRS de NASA, las mismas que ya usa Tata Rekavo.

## Principios y límites

- Un foco es una detección satelital de una anomalía térmica, no un incendio confirmado, una superficie quemada ni una persona afectada.
- Una ausencia de detecciones no demuestra ausencia de fuego. Explicar nubes, horario de pasada, resolución y cobertura histórica.
- MapBiomas es una estimación histórica de superficie quemada; no presentarla como incendio actual ni como una delimitación operativa de un evento.
- No sumar focos de distintas fuentes sin deduplicación y validación. Los datos compartidos entre productos pueden impedir una validación independiente.
- Etiquetar fuente, fecha o período, unidad, cobertura, método y limitaciones. Si el producto no cubre una fecha o zona, mostrar «sin datos», nunca cero.
- No redistribuir geometrías restringidas ni fotografías de terceros sin confirmar derechos. No cargar secretos ni datos personales al repositorio.
- La interfaz no sustituye avisos oficiales, verificación en terreno ni decisiones operativas de emergencia.

## Punto de partida

- `app/src/i18n.ts` contiene actualmente «Fuego en lugares nuevos» y frases que pueden interpretarse como ausencia histórica de incendios. `app/src/App.tsx` y `app/src/data.ts` usan una prueba de vecindad de detecciones históricas.
- `Hotspot` en `app/src/data.ts` conserva fecha y una fila CSV, pero hora, satélite y confianza aún no son campos tipados independientes. El histórico descargable y los puntos mostrados en el mapa no tienen necesariamente la misma cobertura temporal.
- La app ya ofrece área, mes, estadísticas de áreas protegidas y territorios indígenas, historia, descarga y enlace compartible. MapBiomas debe sumarse como un producto diferente, no reemplazar la serie armonizada ni cambiar el significado de sus cifras.
- Colección 1 de MapBiomas Fuego Paraguay: 1999–2024, datos anuales y mensuales derivados de Landsat a 30 m; verificar disponibilidad y versión vigentes al ejecutar. [Metodología](https://paraguay.mapbiomas.org/iniciativas-y-productos/fuego/metodologia/caracteristicas-generales/) · [Acceso y atribución](https://paraguay.mapbiomas.org/descargas/mapbiomas-fuego/).

## Etapa 1 — Aclarar los datos existentes

**Resultado:** nadie necesita interpretar «lugar nuevo» como prueba de que nunca hubo fuego allí.

**Archivos previstos:** `app/src/i18n.ts`, `app/src/App.tsx`, `app/src/data.ts`, `README.md` y pruebas relacionadas. El algoritmo existente y el nombre de la columna `new_place` del CSV se conservan por compatibilidad.

- [x] Cambiar los títulos y explicaciones en español e inglés a «Focos sin detecciones cercanas en el registro histórico» y su equivalente en inglés.
- [x] Mostrar el período real disponible del archivo `burn_history.json`, la vecindad aproximada de 1 km y que se comparan detecciones, no todas las áreas quemadas. No usar un año fijo cuando la fuente declare otro período.
- [x] Sustituir las frases que atribuyen el resultado a desmonte o vegetación que «no se había quemado» por una invitación neutral a consultar imágenes y fuentes de campo.
- [x] Revisar las explicaciones de foco, «normal» y «bajo»: aclarar que no equivalen a ausencia de peligro y mantener visible la fecha de actualización.
- [x] Comprobar casos con cero resultados, datos históricos ausentes y países sin `burn_history.json`; no mostrar que todos los focos son nuevos cuando falte el archivo.
- [x] Probar textos y estados en inglés y español, en móvil y escritorio. Verificar que los CSV y enlaces antiguos no cambien de significado.

**Aceptación:** la pantalla menciona detecciones y período; no afirma que antes no hubo fuego, ni infiere la causa. `npm.cmd test` y `npm.cmd run build` pasan desde `app`.

## Etapa 2 — Fecha y procedencia de los focos

**Resultado:** las personas pueden consultar cuándo y con qué sensor se detectó un foco y filtrar la información reciente sin confundirla con el análisis mensual.

**Archivos previstos:** `app/src/data.ts`, pruebas de datos, `app/src/MapView.tsx`, `app/src/App.tsx`, `app/src/i18n.ts`, `app/src/urlState.ts` y sus pruebas. Crear un módulo pequeño de filtrado de focos si permite probarlo de forma independiente.

- [x] Extender `Hotspot` con hora de adquisición, satélite, instrumento, confianza y producto cuando estén disponibles; conservar el CSV original y tratar los campos ausentes como desconocidos, no como cero.
- [x] Convertir fecha y hora de adquisición de FIRMS desde UTC de forma explícita y mostrar hora local del país **y zona horaria**. Para horas ausentes o inválidas, mostrar la fecha y «hora no disponible»; no inventar medianoche.
- [x] Añadir filtros de mapa «Mes seleccionado», «Últimas 24 horas» y «Últimos 7 días». Los intervalos recientes son ventanas móviles exactas contadas desde el momento actual; no son sinónimos de «hoy» o «ayer».
- [x] Mostrar rango horario, última actualización y cantidad filtrada junto al mapa. Si los datos están atrasados, disponibles solo para un intervalo menor o no hay puntos, informar la cobertura y no sugerir vigilancia en tiempo real.
- [x] Presentar fecha, hora, satélite y fuente al seleccionar un foco con ratón, tacto o teclado; añadir una alternativa accesible si el mapa no permite seleccionar puntos con teclado.
- [x] Mantener independiente el veredicto mensual: filtrar puntos recientes no debe cambiar el total mensual ni atribuirlo al período de 24 horas.
- [x] Si se guarda el filtro en la URL, añadirlo de modo compatible y comprobar que enlaces anteriores mantengan el mismo resultado. La descarga debe indicar claramente si respeta el filtro o el rango de análisis.
- [x] Cubrir cruces de medianoche y cambio de mes, fecha UTC frente a hora local, valores faltantes, archivos atrasados, selección rápida de país y petición fallida.

**Aceptación:** un foco del CSV con `acq_date=2026-01-01`, `acq_time=0030` se interpreta como 00:30 UTC y se muestra con su fecha local correcta; el filtro de 24 horas incluye exactamente las detecciones dentro de la ventana y no modifica el conteo mensual. Sin datos visibles, se informa la limitación y no se afirma que no hay incendios.

**No incluye en esta etapa:** sumar automáticamente focos de INPE a FIRMS. Primero comparar cobertura, sensores, identificadores, términos y duplicados; si no se demuestra valor adicional, mantener un enlace externo a INPE.

## Etapa 3 — Piloto de área quemada de MapBiomas

**Resultado:** para Paraguay se puede consultar superficie quemada histórica como un producto separado de las detecciones activas.

### 3A. Viabilidad y contrato de datos

- [ ] Verificar la colección, períodos anual y mensual, leyenda, banda de datos, cobertura, licencia CC BY y cita exigida en la fuente vigente. Registrar fecha de acceso, versión, URL y restricciones de uso.
- [ ] Comprobar acceso técnico a los datos y cuotas; si se utiliza Google Earth Engine, verificar sus condiciones de acceso. Si requiere cuenta, autorización o recursos no disponibles, documentar el bloqueo antes de construir la integración.
- [ ] Elegir y documentar un piloto reproducible: Paraguay nacional y un departamento con límites redistribuibles. Definir CRS de área, tratamiento de píxeles de borde y de valores sin observación. La superficie se calcula en hectáreas mediante área geodésica o una proyección equivalente apropiada; no multiplicar ciegamente por 30 × 30 m.
- [ ] Separar suma anual de la suma mensual: definir si cada píxel se cuenta una sola vez por año y cómo se evitan dobles conteos al agregar períodos. El área quemada y el número de focos nunca comparten unidad ni se convierten uno en otro.
- [ ] Definir un archivo opcional `data/app/burned_area.json` y un esquema versionado con `source`, `collection`, `retrieved`, `license`, `spatial_resolution_m`, `first_year`, `last_year`, `unit: "ha"`, `method` y registros por zona y período. Usar `null` para períodos sin cobertura y `0` solo con cobertura válida y ninguna área detectada.
- [ ] Antes de publicar, contrastar al menos dos agregados del piloto con la herramienta o datos oficiales, documentando zona, período, diferencias esperadas por límites y tolerancia acordada. No usar los mismos datos como prueba de validación independiente.

### 3B. Integración condicionada al piloto

**Archivos previstos:** nuevo generador y pruebas en `scripts/` y `tests/`; `data/app/countries.json`, `app/src/data.ts`, validación de contrato, componente de área quemada, `app/src/i18n.ts`, `README.md` y `test_contract.mjs`. Los nombres definitivos del generador y componente se fijarán al completar 3A.

- [ ] Generar y validar el producto de Paraguay de forma reproducible. No descargar ni servir geometrías con licencias restrictivas.
- [ ] Añadir una capacidad opcional al índice de países: si la fuente no existe, no se pide ni se inventa una cifra. Los demás países conservan su comportamiento actual.
- [ ] Mostrar «Superficie quemada estimada», área, unidad, zona, período, fecha de cobertura y fuente. Para fechas posteriores a la colección o datos ausentes, mostrar «sin datos».
- [ ] Mantener el panel bajo una sección opcional y dejar explícito que es información histórica distinta de los focos. Si se añade una capa cartográfica, hacerla conmutación separada y atribución visible.
- [ ] Probar cero frente a dato faltante, zona fuera de cobertura, límites de período, errores de contrato, descarga fallida, país sin capacidad y suma anual sin duplicados.
- [ ] Verificar tamaño, tiempo de carga en móvil y una comparación visual con el producto oficial; documentar cómo regenerar los datos y sus límites.

**Aceptación:** el piloto coincide con los controles oficiales dentro de la tolerancia documentada; 2025 o fechas posteriores aparecen sin datos si no están en la colección; la app no cambia sus focos ni solicita este archivo en países que no lo ofrecen.

## Etapa 4 — Caso guiado Cerro Corá

**Resultado:** un caso histórico explica cómo se interpretan juntos focos, imágenes y superficie quemada, sin afirmar causalidad que los datos no prueban.

**Base:** el póster local `MODIFICADO INCIDENCIA DE FOCOS DE CALOR - GRUPO 4.pdf` estudia el incendio de septiembre de 2017 con focos, imágenes Sentinel-2 anteriores y posteriores e información de campo.

- [ ] Registrar autores, fechas, fuentes y permisos de reutilización de imágenes, fotografías y geometrías. Si no hay autorización, escribir un resumen propio con enlace o referencia, sin republicar los materiales.
- [ ] Verificar zona y fechas: evento 8–12 de septiembre de 2017; imágenes indicadas en el póster, 6 y 26 de septiembre. Distinguir fecha de imagen, fecha de detección y fecha estimada del área quemada.
- [ ] Diseñar tres pasos breves: antes, focos detectados y después/área estimada. Mostrar límites de nubes, resolución y validación. No afirmar que cada foco se convirtió en incendio ni que se conoce su causa.
- [ ] Usar las fuentes publicables que existan. Si el producto disponible no permite una comparación temporal o espacial fiable, presentar un caso textual y explicar la limitación en lugar de simular precisión.
- [ ] Mantenerlo como ejemplo opcional, enlazable y accesible con teclado; probar lectura, referencias y enlaces en ambos idiomas y anchos.

**Aceptación:** el caso cita sus fuentes y fechas, funciona en móvil y escritorio y no distribuye material sin derechos comprobados.

## Etapa 5 — Compartir para verificación en terreno

**Resultado:** compartir una observación con el contexto necesario para que otra persona la revise.

- [x] Aprovechar el enlace existente para incluir zona, período y, si corresponde, un foco identificable sin exponer coordenadas precisas de ubicaciones sensibles sin revisar su pertinencia.
- [x] Presentar fecha, hora y sensor disponibles, fuente, última actualización y texto «detección satelital; no verificada en terreno».
- [x] Probar copia y apertura del enlace en ambos idiomas, validación de parámetros, datos ausentes y compatibilidad con enlaces anteriores.
- [x] No añadir cuentas, fotos, foros, notificaciones automáticas ni una etiqueta de «verificado» en esta etapa. Para ello se necesitarían acuerdos institucionales, moderación, identidad y tratamiento de datos.

**Aceptación:** la persona receptora puede identificar qué se observó, dónde y cuándo, y distinguir una detección de una confirmación de campo.

## Verificación y entrega de cada etapa

1. Comprobar el estado de `main`, preparar una rama aislada y preservar cambios locales existentes.
2. Añadir pruebas significativas para la lógica nueva y ejecutar `npm.cmd test` y `npm.cmd run build` desde `app`. Para cambios de datos ejecutar además `node test_contract.mjs data/app` y los contratos de los otros países afectados; para cambios de Python ejecutar `.venv\Scripts\python.exe -m pytest tests -q` y el golden lento cuando afecte Paraguay.
3. Probar español e inglés, 320/375 px y escritorio; teclado, carga, sin datos y errores de red. Comprobar en particular los enlaces compartidos y que la aplicación siga operativa si falla una capa opcional.
4. Abrir un PR por etapa con ejemplo de resultado, fuentes, cobertura y pruebas. Revisar la vista previa y el estado del despliegue antes de integrar. No presentar una prueba automática como estudio con personas reales.

## Orden y dependencias

1. **Etapa 1**: inmediata y sin fuente nueva.
2. **Etapa 2**: se puede hacer después de la 1; depende de definir bien tiempo, zona y cobertura de los focos.
3. **Etapa 3A**: investigación técnica y de licencias; no depende de completar la 2. **3B** solo continúa si 3A confirma acceso, calidad y alcance.
4. **Etapa 4**: después de confirmar fuentes y derechos; se beneficia de 3, pero puede ser textual si 3 no está disponible.
5. **Etapa 5**: después de 2 para poder incluir metadatos confiables; no depende de incorporar una red de reportes.

No se estiman fechas ni costos hasta comprobar el acceso real a MapBiomas y el volumen de datos. Mantener una lista de decisiones y resultados por cada PR.
