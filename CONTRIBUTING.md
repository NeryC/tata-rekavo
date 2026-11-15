# Cómo trabajar en Tata Rekavo sin pisarnos

Somos varios en el mismo repo y además un bot publica datos todos los días. Estas reglas son para que nadie pierda trabajo.

## 1. Antes de empezar: tomá un issue

- Todo el trabajo pendiente está en [Issues](https://github.com/NeryC/tata-rekavo/issues). Elegí uno, **asignátelo** y dejá un comentario ("lo tomo").
- Si ya tiene a alguien asignado, no lo empieces: comentá ahí y coordinen.
- Si lo que querés hacer no tiene issue, abrí uno antes de arrancar.
- Un issue es una rama y un PR. Los PR chicos se revisan y se mergean rápido, y eso evita conflictos.

## 2. Ramas y PR

- Nombres de rama: `pais/<iso3>` (por ejemplo `pais/chl`), `feat/<tema>`, `fix/<tema>`, `docs/<tema>`.
- **Nadie pushea directo a `main`.** La única excepción es el bot de datos (`github-actions[bot]`). Todo lo demás entra por PR.
- El PR menciona el issue ("Closes #N") y lleva una línea sobre cómo lo probaste.
- Para mergear, usá "Squash and merge" o "Rebase and merge" (sin commits de merge). Después borrá la rama.

### Antes de cada push

```bash
git fetch origin
git rebase origin/main      # nunca push --force sobre main ni sobre ramas ajenas
# correr los tests (sección 5)
git push                    # en tu rama; si rebaseaste una rama ya publicada: git push --force-with-lease
```

## 3. Archivos que tocamos todos (zona de choque)

| Archivo | Quién lo cambia | Cómo cambiarlo sin chocar |
|---|---|---|
| `data/app/**/current.json`, `current_hotspots.csv` | El bot, todos los días a las 09:17 UTC | **No editarlos a mano.** Si chocan en un rebase, quedate con la versión de `main` (`git checkout origin/main -- <archivo>`) y seguí. |
| `countries.json` (raíz) | Cada país nuevo | Agregá **solo** el bloque de tu país y no reordenes los demás. |
| `data/app/countries.json` | Cada país nuevo | No editarlo a mano: se regenera con `node countries_index.mjs data/app`. Si choca, regenerálo después del rebase. |
| `countries_index.mjs` (`EXTRA`) | Cada país nuevo | Una línea por país: nombre en español, zona horaria y punto de ejemplo. |
| `app/src/i18n.ts` | Cualquier texto visible | Agregá claves sin mover las demás. Siempre en `en` **y** `es`. |
| `.github/workflows/update-data.yml` | Casi nadie | No hace falta tocarlo para agregar un país: `scripts/update-countries.sh` recorre solo los países de `data/app/countries.json` (dos veces por día). Un país que falla conserva sus datos anteriores, los demás se publican igual y la corrida termina en rojo para avisar. |
| `README.md` | Cada país o método | Escribí en tu propia sección (`### <País>`) y no reescribas las ajenas. |
| `tests/test_pipeline.py` | Cada país nuevo | Sumá tu país a las listas de `parametrize`. |

Si dos personas agregan países a la vez, el segundo PR va a chocar en estos archivos. Es normal: hacé rebase, resolvé conservando **los dos** países y regenerá `data/app/countries.json`.

## 4. Agregar un país

Usá los mismos comandos que para Bolivia, Uruguay y Perú (README, sección "More countries"):

1. Agregá el bloque del país a `countries.json`. Necesita:
   - `firms_name`, verificado contra el listado de archivos de FIRMS;
   - `bbox`;
   - `deg`: 0.1 para países chicos y 0.25 para grandes;
   - `regions` con nombres de biomas explícitos;
   - el bloque `departments`.
2. Corré el pipeline (los datos crudos van en `data/raw/<ISO3>`, que no está en git):
   ```bash
   python firms_pipeline.py download      --country XXX --data data/raw/XXX
   python firms_pipeline.py build         --country XXX --data data/raw/XXX --out data/app/XXX
   python firms_pipeline.py validate      --country XXX --data data/raw/XXX --out data/app/XXX
   python firms_pipeline.py build-regions --country XXX --out data/app/XXX
   python firms_pipeline.py build-season  --country XXX --data data/raw/XXX --out data/app/XXX
   python firms_pipeline.py build-frp     --country XXX --data data/raw/XXX --out data/app/XXX
   FIRMS_MAP_KEY=... python firms_pipeline.py fetch-current --country XXX --out data/app/XXX
   node countries_index.mjs data/app
   node test_contract.mjs data/app/XXX
   ```
   Para ver los argumentos exactos de cada comando: `python firms_pipeline.py <comando> --help`.
3. **Límites (gates):**
   - `grid.json` por debajo de 15 MB, y ningún archivo por encima de 50 MB (GitHub rechaza más de 100 MB);
   - el error mediano del país (`mdape`) va en el README; si pasa de 15 %, se documenta como limitación sin ocultarlo.
4. Sumá en `app/src/i18n.ts` las etiquetas de los biomas nuevos, en `countries_index.mjs` la línea de `EXTRA`, tu sección en el README y la fuente de los límites en "Space Agency Partner & Other Data".
5. Un commit por paso (`data: <País>`, `test: ...`, `ci: ...`). Probalo en la app antes de abrir el PR.

Alcance: **solo Sudamérica.**

## 5. Entorno y tests

```bash
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt -r requirements-dev.txt   # Linux/Mac: .venv/bin/pip
npm --prefix app ci

.venv/Scripts/python -m pytest tests -q          # rápidos
.venv/Scripts/python -m pytest tests -q -m slow  # golden de Paraguay (~2 min, necesita data/raw)
node --test "tests/**/*.test.mjs"
npm --prefix app test
npm --prefix app run build
node test_contract.mjs data/app                  # y data/app/<ISO3> para cada país
npm --prefix app run dev                         # probar en escritorio y a 375 px, con ?lang=en y ?lang=es
```

**Paraguay no puede cambiar sin querer.** Si tu PR toca `firms_pipeline.py`, corré el golden (`-m slow`) antes de pedir revisión.

## 6. Reglas que no se negocian

- **La MAP_KEY de FIRMS nunca va al repo**, que es público: ni en el código, ni en logs, ni en issues. Se lee de la variable de entorno `FIRMS_MAP_KEY`. En GitHub está cargada como secreto. Para trabajar en local, sacá una gratis en https://firms.modaps.eosdis.nasa.gov/api/map_key/
- Los commits y PR no llevan coautorías ni referencias a herramientas de IA.
- Toda fuente de datos nueva se declara en "Space Agency Partner & Other Data" (README y footer de la app), con nombre, URL, licencia y fecha.
- **WDPA (áreas protegidas):** solo se publican estadísticas de fuego por área, **nunca la geometría**, porque la licencia lo prohíbe.
- Ningún mes va como índice en URLs ni en archivos nuevos: se escribe `YYYY-MM`.
