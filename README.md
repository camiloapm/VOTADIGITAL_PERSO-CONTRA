# 🗳️ SISTEMA DE VOTACIÓN MULTIROL - PERSONERO + CONTRALOR

## 📋 CAMBIOS IMPLEMENTADOS

### ✅ NUEVAS FUNCIONALIDADES

1. **Sistema de Roles Independientes**
   - Personero Estudiantil
   - Contralor Estudiantil
   - Soporte para votación individual o combinada

2. **Selector de Modo de Elección (Panel Admin)**
   - ⚪ Solo Personero
   - ⚪ Solo Contralor
   - ⚪ Personero + Contralor (ambos)

3. **Flujo de Votación Secuencial**
   - Si el modo es "both", el estudiante vota primero para un cargo, luego para el otro
   - Indicador de progreso: "Cargo 1 de 2"
   - Validación obligatoria: debe completar ambos votos

4. **Resultados Separados por Cargo**
   - Estadísticas independientes
   - Ganadores por cada rol
   - Reportes diferenciados

5. **Base de Datos Actualizada**
   - Nueva tabla: `election_roles`
   - Campo `role_id` en `candidates`
   - Campos `has_voted_personero` y `has_voted_contralor` en `students`
   - Función `cast_vote()` actualizada con parámetro `role_name`

---

## 🚀 PASOS DE INSTALACIÓN

### PASO 1: CONFIGURAR SUPABASE

1. Crear proyecto en https://supabase.com
2. Ejecutar el script SQL: `Supabase/1_schema.sql`
3. Obtener credenciales:
   - **SUPABASE_URL**: https://xxxxx.supabase.co
   - **SUPABASE_ANON_KEY**: eyJhbG...

### PASO 2: CONFIGURAR ARCHIVOS HTML

Necesitas actualizar 3 archivos con tus credenciales de Supabase:

#### A) `public/index.html`

Busca cerca de la línea 210 (dentro del tag `<script>`):

```javascript
// ⚠️ CONFIGURACIÓN - Reemplaza con tus credenciales de Supabase
const SUPABASE_URL = 'https://tu-proyecto.supabase.co';
const SUPABASE_ANON_KEY = 'tu-anon-key-aqui';
```

#### B) `public/admin.html`

Busca cerca de la línea 200:

```javascript
// ⚠️ CONFIGURACIÓN - Reemplaza con tus credenciales de Supabase
const SUPABASE_URL = 'https://tu-proyecto.supabase.co';
const SUPABASE_ANON_KEY = 'tu-anon-key-aqui';
```

#### C) `public/generar-qr.html`

Busca al inicio del JavaScript:

```javascript
// ⚠️ CONFIGURACIÓN
const SUPABASE_URL = 'https://tu-proyecto.supabase.co';
const SUPABASE_ANON_KEY = 'tu-anon-key-aqui';
```

### PASO 3: DESPLEGAR EN VERCEL

#### Opción A: Desde GitHub (Recomendado)

1. Sube el proyecto a GitHub
2. Ve a https://vercel.com
3. Importa el repositorio
4. Configura las variables de entorno:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (⚠️ NO la anon key, usa la service_role)
5. Despliega

#### Opción B: CLI de Vercel

```bash
npm install -g vercel
cd votadigital_updated
vercel
```

Cuando te pida las environment variables, agrega:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 📖 GUÍA DE USO

### PANEL DE ADMINISTRACIÓN

**Acceso:** `https://tu-dominio.vercel.app/admin.html`

**Código por defecto:** `ADMIN2026`

#### 1. CONFIGURAR MODO DE ELECCIÓN

Antes de abrir la votación:

1. Ve a la sección "Configuración de Elección"
2. Selecciona el modo:
   - **Solo Personero**: Solo se votará para Personero
   - **Solo Contralor**: Solo se votará para Contralor
   - **Ambos Cargos**: Se votará para Personero Y Contralor

3. Asegúrate de tener candidatos registrados para los cargos seleccionados

#### 2. GESTIONAR CANDIDATOS

En la sección "Candidatos":

1. Agregar candidato:
   - Nombre
   - Partido/Lista
   - **Cargo** (Personero o Contralor)
   - URL de foto (opcional)

2. Los candidatos se mostrarán agrupados por cargo

#### 3. ABRIR VOTACIÓN

1. Revisa que todo esté configurado correctamente
2. Clic en "🟢 Abrir Votación"
3. ⚠️ **Una vez abierta, NO puedes cambiar el modo de elección**

#### 4. MONITOREAR VOTACIÓN

En tiempo real verás:
- Participación por Personero
- Participación por Contralor
- Estadísticas por grado y curso

#### 5. CERRAR Y VER RESULTADOS

1. Clic en "🔴 Cerrar Votación"
2. Ve a la sección "Resultados Finales"
3. Verás ganadores separados para cada cargo
4. Puedes exportar reportes en PDF o Excel

---

### PANEL DE VOTACIÓN

**Acceso:** `https://tu-dominio.vercel.app/index.html`

#### Flujo cuando el modo es "Personero + Contralor":

1. **Estudiante ingresa código**
   ```
   El sistema verifica: ¿ya votó para Personero? ¿ya votó para Contralor?
   ```

2. **Primera votación (Personero)**
   ```
   📋 Candidatos a Personero Estudiantil
   [Lista de candidatos solo de Personero]
   
   Selecciona → Confirma → ✅ Voto registrado
   ```

3. **Segunda votación (Contralor)**
   ```
   📋 Candidatos a Contralor Estudiantil
   [Lista de candidatos solo de Contralor]
   
   Selecciona → Confirma → ✅ Voto registrado
   ```

4. **Confirmación final**
   ```
   ✅ ¡Has completado tu votación!
   Has votado para:
   • Personero Estudiantil ✓
   • Contralor Estudiantil ✓
   ```

---

## 🔧 FUNCIONES DE LA BASE DE DATOS

### `cast_vote(p_access_code, p_candidate_id, p_role_name)`

Registra un voto para un cargo específico.

**Parámetros:**
- `p_access_code`: Código de 5 dígitos del estudiante
- `p_candidate_id`: UUID del candidato
- `p_role_name`: `'personero'` o `'contralor'`

**Retorna:**
```json
{
  "success": true,
  "student": { "name": "...", "grade": 6, "course": 1 },
  "role": "personero"
}
```

### `check_student_voting_status(p_access_code)`

Verifica el estado de votación del estudiante.

**Retorna:**
```json
{
  "success": true,
  "student": {
    "name": "...",
    "has_voted_personero": false,
    "has_voted_contralor": false
  },
  "election_mode": "both"
}
```

---

## 📊 REPORTES Y ESTADÍSTICAS

### Participación General

```
Total estudiantes: 500
Votaron Personero: 450 (90%)
Votaron Contralor: 430 (86%)
```

### Resultados por Cargo

**Personero Estudiantil:**
```
1º Juan Pérez - Lista A: 250 votos (55.6%)
2º María López - Lista B: 200 votos (44.4%)
```

**Contralor Estudiantil:**
```
1º Carlos Gómez - Lista C: 230 votos (53.5%)
2º Ana Martínez - Lista D: 200 votos (46.5%)
```

---

## ⚠️ NOTAS IMPORTANTES

### Restricciones del Sistema

1. **Cambio de modo bloqueado:** Una vez abierta la votación, el modo NO se puede cambiar
2. **Votos obligatorios:** Si el modo es "both", el estudiante DEBE votar para ambos cargos
3. **Un voto por cargo:** Cada estudiante puede votar UNA VEZ por cada cargo activo
4. **Códigos únicos:** Los códigos QR sirven para todos los cargos activos

### Seguridad

- Los votos son anónimos (no se guarda quién votó por quién en detalle)
- Las funciones SQL usan transacciones atómicas
- Row Level Security (RLS) activado en todas las tablas

### Recomendaciones

1. Haz pruebas con datos de prueba antes del día de votación
2. Usa "Restablecer Votación" para limpiar votos de prueba
3. Capacita a los encargados del proceso antes del día D
4. Ten un plan B (papel) por si falla internet

---

## 🐛 SOLUCIÓN DE PROBLEMAS

### "No hay candidatos para Personero/Contralor"

**Solución:** Asegúrate de agregar al menos 1 candidato por cada cargo que vas a activar.

### "Este código ya ha sido utilizado"

**Solución:** El estudiante ya votó para todos los cargos activos. Verifica en el panel de admin.

### "La votación está cerrada"

**Solución:** Abre la votación desde el panel de admin.

### Los candidatos no aparecen

**Solución:** 
1. Verifica que estén registrados en la base de datos
2. Revisa la consola del navegador (F12) por errores
3. Confirma que las credenciales de Supabase sean correctas

---

## 📞 SOPORTE

Para problemas técnicos:

1. Revisa la consola del navegador (F12 → Console)
2. Verifica los logs en Vercel
3. Consulta la documentación de Supabase

---

## 📝 CHANGELOG

### Versión 2.0.0 (Multirol)

**Agregado:**
- Sistema de roles (Personero + Contralor)
- Selector de modo de elección
- Flujo de votación secuencial
- Resultados separados por cargo
- Estadísticas diferenciadas

**Modificado:**
- Base de datos con nuevas tablas y campos
- API con endpoints actualizados
- Interfaz de admin con nuevas secciones
- Panel de votación con indicadores de progreso

**Mejorado:**
- Validaciones de integridad
- Mensajes de error más claros
- UX del flujo de votación

---

## 🎯 PRÓXIMOS PASOS RECOMENDADOS

1. ✅ Configurar Supabase
2. ✅ Actualizar credenciales en archivos HTML
3. ✅ Desplegar en Vercel
4. ✅ Importar estudiantes desde Excel
5. ✅ Agregar candidatos para cada cargo
6. ✅ Hacer pruebas con códigos de prueba
7. ✅ Restablecer votación
8. ✅ Abrir votación oficial
9. ✅ Monitorear en tiempo real
10. ✅ Cerrar y generar reportes

---

**¡Éxito en tu elección estudiantil! 🎉**
