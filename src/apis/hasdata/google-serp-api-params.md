# Parámetros de la Google SERP API (HasData)

> Resumen estructurado a partir de la documentación oficial de HasData para la **Google SERP API**.

- **Obligatorio:** siempre debes enviar el parámetro `q` (query de búsqueda).
- **Opcional:** todos los demás parámetros son opcionales y se usan para afinar la búsqueda.

---

## 1. Consulta de búsqueda

| Parámetro | Tipo   | Obligatorio | Descripción                                      | Ejemplo            |
|----------|--------|-------------|--------------------------------------------------|--------------------|
| `q`      | string | Sí          | Término que quieres buscar en Google.           | `coffee beans`     |

---

## 2. Ubicación geográfica

| Parámetro | Tipo   | Descripción                                                                 | Ejemplo                                |
|----------|--------|-----------------------------------------------------------------------------|----------------------------------------|
| `location` | string | **Ubicación canónica** de Google para la búsqueda.                         | `Austin,Texas,United States`           |
| `uule`     | string | Cadena codificada de ubicación en formato interno de Google.               | (valor codificado)                     |

---

## 3. Localización (idioma, país, dominio)

| Parámetro | Tipo   | Default          | Descripción                                                                 |
|----------|--------|------------------|-----------------------------------------------------------------------------|
| `domain` | string | `google.com`     | Dominio de Google a usar (`google.es`, `google.fr`, etc.).                 |
| `gl`     | string | —                | Código de país (2 letras) para limitar los resultados a ese país.          |
| `hl`     | string | —                | Código de idioma (2 letras) para la interfaz de búsqueda.                  |
| `lr`     | string | —                | Filtra resultados según el idioma del contenido de las páginas.            |

---

## 4. Filtros avanzados

### 4.1. `tbs` – Time/filters

`tbs` es un string que acepta **varios filtros combinados** separados por comas. Ejemplos:

- **Rango de fechas concreto:**
  - `cdr:1,cd_min:10/17/2018,cd_max:3/8/2021`  
    → Muestra resultados solo dentro de ese rango de fechas.
- **Ordenación:**
  - `sbd:1` → Ordena por fecha (más recientes primero).  
  - `sbd:0` → Ordena por relevancia.
- **Páginas con imágenes:**
  - `img:1` → Solo resultados de páginas que contienen imágenes.

**Atajo de rango rápido (`qdr`):**

- `qdr:h` → Última hora  
- `qdr:d` → Último día  
- `qdr:w` → Última semana  
- `qdr:m` → Último mes  
- `qdr:y` → Último año  
- `qdr:h10`, `qdr:d10`, `qdr:w10`, `qdr:m10`, `qdr:y10` → Últimas *N* horas/días/semanas/meses/años (en el ejemplo, 10).

---

### 4.2. Otros filtros

| Parámetro | Tipo   | Valores / Default | Descripción                                                                                   |
|----------|--------|-------------------|-----------------------------------------------------------------------------------------------|
| `safe`   | enum   | `active`, `off`   | Filtro de contenido adulto (SafeSearch).                                                      |
| `filter` | number | `1` (por defecto) | Activa (`1`) o desactiva (`0`) filtros de “resultados similares” y “omitidos”.               |
| `nfpr`   | number | `0` (por defecto) | Controla autocorrección: `0` incluye resultados autocorregidos; `1` fuerza la consulta original. |

---

## 5. Paginación

| Parámetro | Tipo   | Default | Descripción                                                                                                                                                            |
|----------|--------|---------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `start`  | number | `0`     | Número de resultados a **saltar**. Sirve para paginar: `0` = primera página, `10` = segunda, `20` = tercera, etc. En resultados locales (`tbm=lcl`), debe ser múltiplo de 20. |
| `num`    | number | `10`    | Número de resultados por página, entre `10` y `100`.                                                                                                                   |

---

## 6. Tipo de búsqueda (`tbm`)

| Parámetro | Tipo | Descripción                               | Opciones                       |
|----------|------|--------------------------------------------|--------------------------------|
| `tbm`    | enum | Tipo de vertical de búsqueda de Google.    | `isch` (imágenes), `vid` (vídeo), `nws` (news), `shop` (shopping), `lcl` (local) |

---

## 7. Tipo de dispositivo

| Parámetro   | Tipo   | Descripción                                                 | Opciones                               |
|------------|--------|-------------------------------------------------------------|----------------------------------------|
| `deviceType` | string | Emula los resultados de Google en un tipo de dispositivo. | `desktop`, `mobile`, `tablet`          |

---

## 8. Parámetros avanzados de entidad / lugar

| Parámetro | Tipo   | Descripción                                        |
|----------|--------|----------------------------------------------------|
| `ludocid` | string | Google Place ID de una ubicación específica.       |
| `lsig`    | string | ID adicional relacionado con Google Places.        |
| `kgmid`   | string | ID de Google Knowledge Graph para una entidad.     |
| `si`      | string | ID de parámetros de búsqueda en caché de Google.   |

---

## 9. Resumen rápido de uso mínimo

Para una llamada mínima a la API:

```http
GET https://api.hasdata.com/google-serp?api_key=TU_API_KEY&q=cafe%20en%20granada
```

Y a partir de ahí, puedes añadir:

- Localización: `location`, `gl`, `hl`, `domain`
- Rango temporal y filtros: `tbs`, `safe`, `filter`, `nfpr`
- Paginación: `start`, `num`
- Vertical: `tbm`
- Dispositivo: `deviceType`
- Parámetros avanzados: `ludocid`, `kgmid`, etc.
