====================================================================
INSTRUCCIONES PARA CONFIGURAR SUPABASE - VOTACIÓN MULTIROL
====================================================================

PASO 1: CREAR PROYECTO EN SUPABASE
-----------------------------------
1. Ve a https://supabase.com
2. Crea una cuenta o inicia sesión
3. Clic en "New Project"
4. Completa los datos:
   - Name: votacion-escolar
   - Database Password: [Elige una contraseña segura y GUÁRDALA]
   - Region: Elige la más cercana a Colombia
5. Espera a que se cree el proyecto (2-3 minutos)

PASO 2: EJECUTAR SQL EN SUPABASE
---------------------------------
1. En tu proyecto de Supabase, ve al menú izquierdo → "SQL Editor"
2. Clic en "+ New query"
3. Copia TODO el contenido del archivo "1_schema.sql"
4. Pégalo en el editor
5. Clic en "Run" (botón verde abajo a la derecha)
6. Verifica que diga "Success. No rows returned" (es normal)

PASO 3: OBTENER CREDENCIALES
-----------------------------
1. Ve al menú izquierdo → "Project Settings" (ícono de engranaje)
2. En el menú lateral → "API"
3. Busca la sección "Project URL" y copia la URL
   Ejemplo: https://xxxxxxxxxxxxx.supabase.co
4. Busca la sección "Project API keys" → "anon public"
5. Copia la clave que empieza con "eyJ..."

PASO 4: CONFIGURAR EL PROYECTO
-------------------------------
Necesitarás estas 2 variables para configurar tu aplicación:

SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

Estas credenciales las usarás en:
- admin.html (líneas al inicio del JavaScript)
- index.html (líneas al inicio del JavaScript)
- generar-qr.html (líneas al inicio del JavaScript)

PASO 5: VERIFICAR INSTALACIÓN
------------------------------
1. Ve a "Table Editor" en el menú izquierdo
2. Deberías ver estas tablas creadas:
   ✓ config
   ✓ election_roles
   ✓ students
   ✓ candidates
   ✓ votes

3. Clic en la tabla "config"
   Deberías ver 1 fila con:
   - election_status: closed
   - election_mode: personero
   - admin_code: ADMIN2026

4. Clic en la tabla "election_roles"
   Deberías ver 2 filas:
   - personero | Personero Estudiantil
   - contralor | Contralor Estudiantil

====================================================================
IMPORTANTE - SEGURIDAD
====================================================================

⚠️ NUNCA compartas públicamente tu:
   - Database Password
   - service_role key (NO uses esta, solo la anon key)

✅ Puedes compartir de forma segura:
   - Project URL
   - anon public key (es de solo lectura limitada)

====================================================================
CAMBIAR CÓDIGO DE ADMINISTRADOR
====================================================================

Si quieres cambiar el código "ADMIN2026":

1. Ve a "Table Editor" → tabla "config"
2. Edita la fila (clic en la fila)
3. Cambia el campo "admin_code"
4. Guarda los cambios

====================================================================
MODO DE ELECCIÓN
====================================================================

El campo "election_mode" puede tener 3 valores:
- 'personero'  → Solo se vota para Personero
- 'contralor'  → Solo se vota para Contralor
- 'both'       → Se vota para ambos cargos

Este valor se configura automáticamente desde el panel de admin.

====================================================================
SIGUIENTE PASO
====================================================================

Una vez completados estos pasos:
1. Actualiza las credenciales en los archivos HTML
2. Despliega en Vercel siguiendo las instrucciones
3. Accede al panel de admin con el código ADMIN2026
