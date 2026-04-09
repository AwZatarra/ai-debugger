# 🧠 AI Debugger

Backend que funciona como un **debugger inteligente para incidentes de producción**.

Permite detectar incidentes, construir contexto automáticamente, analizar causa raíz con reglas y LLMs, buscar incidentes similares, recuperar conocimiento útil y llegar hasta una **propuesta de PR con aprobación humana**.  
En el flujo ya validado, incluso puede terminar creando un **Pull Request real en GitHub** con guardrails.

En pocas palabras: este proyecto busca que el debugging en producción sea **más rápido, más guiado y menos dependiente de revisión manual desde cero**.

---

## 🚀 Qué hace

El sistema recorre un flujo como este:

- ingiere logs y errores de servicios
- detecta incidentes automáticamente
- construye contexto técnico del incidente
- ejecuta RCA heurístico
- ejecuta RCA con LLM
- busca incidentes similares
- recupera conocimiento y runbooks relacionados
- rankea causas probables
- permite feedback humano
- genera una PR proposal
- exige aprobación humana antes de continuar
- valida edits y checks locales
- puede abrir un **PR real en GitHub**

---

## ✨ Diferencial técnico

- mezcla **reglas deterministas + LLM**
- incorpora **human-in-the-loop**
- usa **guardrails** antes de tocar GitHub
- separa claramente:
  - análisis
  - proposal
  - validación
  - ejecución
- deja trazabilidad del pipeline completo

---

## 🛠️ Tecnologías

- **Node.js**
- **TypeScript**
- **Express**
- **ClickHouse**
- **OpenTelemetry**
- **OpenAI Responses API**
- **Next.js** *(UI mínima)*
- **GitHub REST API**
- **Docker**

---

## 📦 Cómo instalarlo

### 1. Clonar el repositorio

```bash
git clone https://github.com/AwZatarra/ai-debugger.git
cd ai-debugger
```

### 2. Instalar dependencias

En la raíz y en los servicios que corresponda:

```bash
npm install
```

> Pendiente de validación: el proyecto puede tener instalación por paquetes/servicios según la estructura actual del repo.

### 3. Configurar variables de entorno

Crea y ajusta tu archivo `.env` / `.env.local` según tu entorno.

Variables relevantes confirmadas en el flujo del proyecto:

```env
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=aiuser
CLICKHOUSE_PASSWORD=aipass123
LOG_INGESTOR_URL=http://localhost:3010/ingest-log
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
NODE_ENV=development
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4
EMBEDDING_MODEL=text-embedding-3-small

GITHUB_TOKEN=
GITHUB_API_BASE_URL=https://api.github.com
GITHUB_COMMITTER_NAME=AI Debugger Bot
GITHUB_COMMITTER_EMAIL=bot@ai-debugger.local
PR_PROPOSAL_DEFAULT_REPOSITORY=AwZatarra/ai-debugger
```

> También debes tener configuradas las variables necesarias para OpenAI, ClickHouse y observabilidad según tu entorno local.

---

## ▶️ Cómo arrancarlo

### 1. Levantar infraestructura

Si estás usando contenedores para observabilidad y base de datos:

```bash
docker compose up -d
```

### 2. Levantar servicios backend

Ejemplo de servicios usados en el flujo validado:

- `service-a` → `http://localhost:3001`
- `service-b` → `http://localhost:3002`
- `incident-detector` → `http://localhost:3020`

Ejemplo para `service-b`:

```bash
cd services/service-b
npm run dev
```

### 3. Levantar la UI mínima

```bash
cd frontend
npm run dev
```

UI:
```text
http://localhost:3000
```

---

## ✅ Cómo probarlo rápido

### 1. Verificar salud de `service-b`

```bash
curl http://localhost:3002/health
```

### 2. Generar un incidente de ejemplo

```bash
curl http://localhost:3001/checkout
```

Cuando ocurre el fallo esperado, el flujo validado puede responder algo así:

```json
{
  "ok": false,
  "error": "CHECKOUT_FAILED",
  "detail": {
    "ok": false,
    "error": "DB_TIMEOUT"
  }
}
```

### 3. Detectar incidente

```http
POST http://localhost:3020/detect
```

### 4. Abrir la UI mínima

Ve a:

```text
http://localhost:3000
```

Y recorre el flujo:

- incidentes
- contexto
- RCA heurístico
- RCA LLM
- PR proposal
- approve / reject
- prepare execution
- generate / regenerate edits
- validate
- run local checks
- create GitHub PR

---

## 📌 Estado actual

Implementado y validado en el proyecto:

- incident detection
- context builder
- RCA heurístico
- RCA con LLM
- analysis summary
- similar incidents
- knowledge retrieval
- cause ranking determinista
- cause ranking LLM
- feedback humano
- evaluación por incidente
- stats globales
- UI mínima
- PR proposal con aprobación humana
- prepare-execution
- generate-file-edits
- regenerate-file-edits
- validate-file-edits
- run-local-checks
- create-github-pr

---

## 🧱 Stack del flujo validado

### Backend
- Node.js + TypeScript
- Express
- ClickHouse
- OpenTelemetry
- OpenAI Responses API

### UI mínima
- Next.js + TypeScript

### Integraciones
- GitHub API para creación de PR real con guardrails

---

## 🛡️ Guardrails

Este proyecto **no** se va directo a cambiar código sin control.

Antes de crear un PR real, el flujo exige:

- proposal estructurada
- aprobación humana
- prepare-execution
- generación/regeneración de edits
- validación contra el repo real
- local checks
- creación de branch y PR solo al final

---

## 💡 Valor del proyecto

AI Debugger demuestra experiencia real en:

- backend engineering
- debugging asistido por IA
- observabilidad
- análisis de incidentes
- LLM workflows
- guardrails para automatización
- integración segura con GitHub
- diseño de pipelines técnicos end-to-end

No es solo un chatbot sobre logs.  
Es un flujo operativo que conecta **incidente → análisis → decisión humana → PR real**.

---

## 👨‍💻 Autor

**Pool Rivera Molina**

- GitHub: [poolriveramolina](https://github.com/AwZatarra)
- LinkedIn: [Pool Rivera Molina](https://www.linkedin.com/in/pool-rivera-molina/)

---

## ⚡ Quickstart ultra corto

```bash
# 1. levantar infraestructura
docker compose up -d

# 2. levantar service-b
cd services/service-b
npm run dev

# 3. levantar service-a, incident-detector y frontend
# (según scripts/config actual del repo)

# 4. generar incidente
curl http://localhost:3001/checkout

# 5. detectar incidente
curl -X POST http://localhost:3020/detect

# 6. operar desde la UI mínima
# http://localhost:3000
```
