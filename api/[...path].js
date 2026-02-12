import { createClient } from '@supabase/supabase-js';

// Lazy init (para evitar crashes si faltan env vars)
let supabase = null;

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
  }

  return supabase;
}

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Health check (NO depende de Supabase)
  if (url.pathname === '/api/health' || url.pathname === '/api/health/') {
    return res.status(200).json({ ok: true });
  }

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-code');
    return res.status(200).end();
  }

  // ======== RUTAS EXPLÍCITAS (FIX 404 ADMIN) ========
  if (url.pathname === '/api/admin/login' || url.pathname === '/api/admin/login/') {
    return await handleAdmin(req, res, 'login');
  }
  if (url.pathname === '/api/admin/students' || url.pathname === '/api/admin/students/') {
    return await handleAdmin(req, res, 'students');
  }
  if (url.pathname === '/api/admin/candidates' || url.pathname === '/api/admin/candidates/') {
    return await handleAdmin(req, res, 'candidates');
  }
  if (url.pathname === '/api/admin/election' || url.pathname === '/api/admin/election/') {
    return await handleAdmin(req, res, 'election');
  }
  if (url.pathname === '/api/admin/import' || url.pathname === '/api/admin/import/') {
    return await handleAdmin(req, res, 'import');
  }
  if (url.pathname === '/api/admin/reset-codes' || url.pathname === '/api/admin/reset-codes/') {
    return await handleAdmin(req, res, 'reset-codes');
  }
  if (url.pathname === '/api/admin/reset-votes' || url.pathname === '/api/admin/reset-votes/') {
    return await handleAdmin(req, res, 'reset-votes');
  }
  if (url.pathname === '/api/admin/clear-data' || url.pathname === '/api/admin/clear-data/') {
    return await handleAdmin(req, res, 'clear-data');
  }
  if (url.pathname === '/api/admin/clear-students' || url.pathname === '/api/admin/clear-students/') {
    return await handleAdmin(req, res, 'clear-students');
  }

  // ======== ROUTER GENERAL ========
  const pathParts = url.pathname.replace('/api/', '').split('/').filter(Boolean);
  const endpoint = pathParts[0];
  const subEndpoint = pathParts[1];

  try {
    switch (endpoint) {
      case 'check-status': return await checkStatus(req, res);
      case 'verify-code': return await verifyCode(req, res);
      case 'cast-vote': return await castVote(req, res);
      case 'get-candidates': return await getCandidates(req, res);
      case 'admin': return await handleAdmin(req, res, subEndpoint);
      case 'stats': return await getStats(req, res);
      case 'config': return await handleConfig(req, res);
      case 'results': return await getFinalResults(req, res);
      case 'monitor': return await getMonitorData(req, res);
      default: return res.status(404).json({ error: 'Endpoint no encontrado' });
    }
  } catch (error) {
    console.error('Error:', error.message || error);
    return res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
}

// =====================================================
// PUBLIC ENDPOINTS
// =====================================================

async function checkStatus(req, res) {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('config')
    .select('election_status, election_mode, school_logo_url, school_name')
    .eq('id', 1)
    .single();

  if (error) return res.status(500).json({ error: 'Error al consultar estado' });

  return res.status(200).json({
    open: data.election_status === 'open',
    status: data.election_status,
    mode: data.election_mode,
    school_logo: data.school_logo_url,
    school_name: data.school_name
  });
}

async function verifyCode(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { access_code } = req.body || {};
  if (!access_code || !/^\d{5}$/.test(access_code)) {
    return res.status(400).json({ error: 'Código inválido (debe tener 5 dígitos)' });
  }

  const { data: student, error } = await supabase
    .from('students')
    .select('id, full_name, grade, course, has_voted_personero, has_voted_contralor')
    .eq('access_code', access_code)
    .single();

  if (error || !student) return res.status(404).json({ error: 'Código no encontrado' });

  // Validar si ya votó según modo
  const { data: config } = await supabase
    .from('config')
    .select('election_mode')
    .eq('id', 1)
    .single();

  const mode = config?.election_mode || 'personero';

  if (mode === 'personero' && student.has_voted_personero) {
    return res.status(403).json({ error: 'Este código ya ha sido utilizado para Personero' });
  }
  if (mode === 'contralor' && student.has_voted_contralor) {
    return res.status(403).json({ error: 'Este código ya ha sido utilizado para Contralor' });
  }
  if (mode === 'both' && (student.has_voted_personero || student.has_voted_contralor)) {
    return res.status(403).json({ error: 'Este código ya ha sido utilizado en esta elección' });
  }

  return res.status(200).json({
    valid: true,
    student: { name: student.full_name, grade: student.grade, course: student.course }
  });
}

async function castVote(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { access_code, candidate_id, personero_id, contralor_id } = req.body || {};
  if (!access_code) return res.status(400).json({ error: 'Datos incompletos' });

  // Modo de elección
  const { data: config } = await supabase
    .from('config')
    .select('election_mode')
    .eq('id', 1)
    .single();

  const mode = config?.election_mode || 'personero';

  let data;
  let error;

  if (mode === 'both') {
    if (!personero_id || !contralor_id) {
      return res.status(400).json({ error: 'Debes votar por Personero y Contralor' });
    }

    const rpc = await supabase.rpc('cast_vote_both', {
      p_access_code: access_code,
      p_personero_id: personero_id,
      p_contralor_id: contralor_id
    });
    data = rpc.data;
    error = rpc.error;
  } else {
    if (!candidate_id) return res.status(400).json({ error: 'Datos incompletos' });

    const rpc = await supabase.rpc('cast_vote', {
      p_access_code: access_code,
      p_candidate_id: candidate_id,
      p_role_name: mode
    });
    data = rpc.data;
    error = rpc.error;
  }

  if (error) return res.status(500).json({ error: 'Error al procesar voto', details: error.message });

  const result = data;
  if (!result.success) return res.status(400).json({ error: result.error });

  return res.status(200).json({
    success: true,
    message: 'Voto registrado correctamente',
    student: result.student
  });
}

async function getCandidates(req, res) {
  const supabase = getSupabase();

  // Leer modo
  const { data: config } = await supabase
    .from('config')
    .select('election_mode')
    .eq('id', 1)
    .single();

  const mode = config?.election_mode || 'personero';

  // Traer candidatos con su rol
  const { data, error } = await supabase
    .from('candidates')
    .select('id, name, party, photo_url, election_roles(name)')
    .order('name');

  if (error) return res.status(500).json({ error: 'Error al cargar candidatos' });

  if (mode === 'personero') {
    return res.status(200).json({
      candidates: (data || []).filter(c => c.election_roles?.name === 'personero')
    });
  }

  if (mode === 'contralor') {
    return res.status(200).json({
      candidates: (data || []).filter(c => c.election_roles?.name === 'contralor')
    });
  }

  // both
  return res.status(200).json({ candidates: data || [] });
}

async function handleConfig(req, res) {
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('config')
      .select('school_logo_url, school_name')
      .eq('id', 1)
      .single();

    if (error) return res.status(500).json({ error: 'Error' });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const adminCode = req.headers['x-admin-code'];

    const { data: config, error: cfgErr } = await supabase
      .from('config')
      .select('admin_code')
      .eq('id', 1)
      .single();

    if (cfgErr || !config || adminCode !== config.admin_code) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    const { school_logo_url, school_name } = req.body || {};

    const { error } = await supabase
      .from('config')
      .update({
        school_logo_url: school_logo_url || null,
        school_name: school_name || 'Colegio'
      })
      .eq('id', 1);

    if (error) return res.status(500).json({ error: 'Error al actualizar' });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

// =====================================================
// ADMIN
// =====================================================

async function handleAdmin(req, res, subEndpoint) {
  const supabase = getSupabase();

  // LOGIN: NO bloquea (solo confirma que backend responde)
  if (subEndpoint === 'login') {
    return res.status(200).json({ success: true });
  }

  // Para TODO lo demás, sí validamos admin_code
  const adminCode = req.headers['x-admin-code'] || req.body?.admin_code;

  const { data: config, error } = await supabase
    .from('config')
    .select('admin_code')
    .eq('id', 1)
    .single();

  if (error || !config || adminCode !== config.admin_code) {
    return res.status(401).json({ error: 'Código de administrador inválido' });
  }

  switch (subEndpoint) {
    case 'students': return await handleStudents(req, res);
    case 'candidates': return await handleCandidates(req, res);
    case 'election': return await handleElection(req, res);
    case 'import': return await importStudents(req, res);
    case 'reset-codes': return await resetCodes(req, res);
    case 'reset-votes': return await resetVotes(req, res);
    case 'clear-data': return await clearData(req, res);
    case 'clear-students': return await clearStudents(req, res);
    default: return res.status(404).json({ error: 'Sub-endpoint no encontrado' });
  }
}

async function handleStudents(req, res) {
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('students')
      .select('id, full_name, grade, course, list_number, access_code, has_voted_personero, has_voted_contralor')
      .order('grade')
      .order('course')
      .order('list_number');

    if (error) return res.status(500).json({ error: 'Error al cargar estudiantes' });
    return res.status(200).json({ students: data });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const { error } = await supabase.from('students').delete().eq('id', id);
    if (error) return res.status(500).json({ error: 'Error al eliminar' });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

async function handleCandidates(req, res) {
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('candidates')
      .select('id, name, party, photo_url, votes, created_at, election_roles(name, display_name)')
      .order('name');
    if (error) return res.status(500).json({ error: 'Error al cargar candidatos' });
    return res.status(200).json({ candidates: data });
  }

  if (req.method === 'POST') {
    const { name, party, photo_url, role_name } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    // Si no viene role_name, por compatibilidad asumimos personero
    const role = role_name || 'personero';

    const { data: roleRow, error: roleErr } = await supabase
      .from('election_roles')
      .select('id')
      .eq('name', role)
      .single();

    if (roleErr || !roleRow) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const { data, error } = await supabase
      .from('candidates')
      .insert([
        {
          name,
          party: party || '',
          photo_url: photo_url || '',
          role_id: roleRow.id
        }
      ])
      .select()
      .single();

    if (error) return res.status(500).json({ error: 'Error al crear candidato' });
    return res.status(200).json({ candidate: data });
  }

  if (req.method === 'PUT') {
    const { id, photo_url } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const { error } = await supabase.from('candidates').update({ photo_url }).eq('id', id);
    if (error) return res.status(500).json({ error: 'Error al actualizar foto' });

    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    await supabase.from('votes').delete().eq('candidate_id', id);

    const { error } = await supabase.from('candidates').delete().eq('id', id);
    if (error) return res.status(500).json({ error: 'Error al eliminar' });

    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

async function handleElection(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { action, election_mode } = req.body || {};
  if (!['open', 'close'].includes(action)) return res.status(400).json({ error: 'Acción inválida' });

  // Si van a abrir, obligar a que venga el modo
  const updatePayload = {
    election_status: action === 'open' ? 'open' : 'closed'
  };

  if (action === 'open') {
    if (!election_mode || !['personero', 'contralor', 'both'].includes(election_mode)) {
      return res.status(400).json({ error: 'Debe seleccionar un modo de elección válido' });
    }
    updatePayload.election_mode = election_mode;
  }

  const { error } = await supabase
    .from('config')
    .update(updatePayload)
    .eq('id', 1);

  if (error) return res.status(500).json({ error: 'Error al cambiar estado' });
  return res.status(200).json({ success: true, status: action === 'open' ? 'open' : 'closed' });
}

// Genera el access_code formato GGCLL
function makeAccessCode(grade, course, list) {
  return `${String(grade).padStart(2, '0')}${course}${String(list).padStart(2, '0')}`;
}

// Import: inserta estudiantes asignando list_number que no genere colisión de access_code
async function importStudents(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { students } = req.body || {};

  if (!Array.isArray(students)) {
    return res.status(400).json({ error: 'Formato inválido: se esperaba un array de estudiantes' });
  }
  if (students.length === 0) {
    return res.status(400).json({ error: 'No hay estudiantes para importar' });
  }

  // Filtrar y normalizar
  const validStudents = [];
  students.forEach((s) => {
    const nombre = s.full_name;
    const grado = parseInt(s.grade, 10);
    const curso = parseInt(s.course, 10) || 1;
    if (!nombre || isNaN(grado) || grado < 0) return;
    if (curso < 1 || curso > 9) return;
    validStudents.push({ full_name: String(nombre).trim(), grade: grado, course: curso });
  });

  if (validStudents.length === 0) {
    return res.status(400).json({ error: 'No hay estudiantes válidos para importar' });
  }

  // Obtener TODOS los estudiantes existentes de una sola consulta
  const { data: existing, error: fetchError } = await supabase
    .from('students')
    .select('full_name, grade, course, list_number, access_code, has_voted_personero, has_voted_contralor');

  if (fetchError) {
    return res.status(500).json({ error: 'Error al consultar estudiantes existentes', details: fetchError.message });
  }

  // Construir Set de códigos usados, mapa de máximo list_number por grupo
  // y Set de "nombre|grado|curso" para detectar duplicados
  const usedCodes = new Set();
  const maxListPerGroup = {};
  const existingStudentKeys = new Set();

  for (const s of (existing || [])) {
    if (s.access_code) usedCodes.add(String(s.access_code));
    const key = `${s.grade}-${s.course}`;
    if ((s.list_number || 0) > (maxListPerGroup[key] || 0)) {
      maxListPerGroup[key] = s.list_number;
    }
    const studentKey = `${String(s.full_name).trim().toLowerCase()}|${s.grade}|${s.course}`;
    existingStudentKeys.add(studentKey);
  }

  // Filtrar estudiantes que ya existen (mismo nombre + grado + curso)
  let skipped = 0;
  const newStudents = validStudents.filter(s => {
    const studentKey = `${s.full_name.toLowerCase()}|${s.grade}|${s.course}`;
    if (existingStudentKeys.has(studentKey)) {
      skipped++;
      return false;
    }
    return true;
  });

  if (newStudents.length === 0) {
    return res.status(200).json({
      success: true,
      imported: 0,
      skipped,
      total: students.length,
      valid: 0,
      groups: 0,
      message: 'Todos los estudiantes ya estaban registrados',
      errors: [],
      hasErrors: false,
    });
  }

  // Agrupar solo los nuevos por grado-curso
  const groups = {};
  for (const s of newStudents) {
    const key = `${s.grade}-${s.course}`;
    if (!groups[key]) groups[key] = { grade: s.grade, course: s.course, students: [] };
    groups[key].students.push(s);
  }

  // Asignar list_number y access_code sin colisiones
  const toInsert = [];

  for (const group of Object.values(groups)) {
    const key = `${group.grade}-${group.course}`;
    let nextList = (maxListPerGroup[key] || 0) + 1;

    for (const student of group.students) {
      // Avanzar hasta encontrar un código libre
      while (nextList <= 99 && usedCodes.has(makeAccessCode(group.grade, group.course, nextList))) {
        nextList++;
      }
      if (nextList > 99) {
        // Sin espacio — saltar este estudiante
        continue;
      }

      const accessCode = makeAccessCode(group.grade, group.course, nextList);
      usedCodes.add(accessCode); // Reservar para el resto del lote en memoria

      toInsert.push({
        full_name: student.full_name,
        grade: group.grade,
        course: group.course,
        list_number: nextList,
        access_code: accessCode,
      });
      nextList++;
    }
  }

  if (toInsert.length === 0) {
    return res.status(400).json({ error: 'No se pudieron asignar códigos disponibles para los estudiantes' });
  }

  // Insertar uno por uno para manejar errores individuales sin detener el lote
  let inserted = 0;
  const insertErrors = [];

  for (const student of toInsert) {
    const { error } = await supabase.from('students').insert(student);
    if (error) {
      // Si aún así hay duplicate key (condición de carrera), reintentar con siguiente código
      if (error.code === '23505') {
        // Buscar siguiente código libre y reintentar
        const key = `${student.grade}-${student.course}`;
        let retryList = student.list_number + 1;
        let retried = false;
        while (retryList <= 99) {
          const retryCode = makeAccessCode(student.grade, student.course, retryList);
          if (!usedCodes.has(retryCode)) {
            const { error: retryError } = await supabase.from('students').insert({
              ...student,
              list_number: retryList,
              access_code: retryCode,
            });
            if (!retryError) {
              usedCodes.add(retryCode);
              inserted++;
              retried = true;
              break;
            }
          }
          retryList++;
        }
        if (!retried) {
          insertErrors.push(`${student.full_name}: sin código disponible`);
        }
      } else {
        insertErrors.push(`${student.full_name}: ${error.message}`);
      }
    } else {
      inserted++;
    }
  }

  return res.status(200).json({
    success: inserted > 0 || skipped > 0,
    imported: inserted,
    skipped,
    total: students.length,
    valid: toInsert.length,
    groups: Object.keys(groups).length,
    errors: insertErrors.slice(0, 10),
    hasErrors: insertErrors.length > 0,
  });
}

async function resetCodes(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { data: students, error: fetchError } = await supabase
    .from('students')
    .select('id, grade, course, list_number');

  if (fetchError) return res.status(500).json({ error: 'Error al cargar estudiantes' });

  let updated = 0;

  for (const student of students) {
    const newCode =
      `${String(student.grade).padStart(2, '0')}` +
      `${student.course}` +
      `${String(student.list_number).padStart(2, '0')}`;

    const { error } = await supabase.from('students').update({ access_code: newCode }).eq('id', student.id);
    if (!error) updated++;
  }

  return res.status(200).json({ success: true, message: `${updated} códigos regenerados` });
}

// ========== RESTABLECER VOTACIÓN (NUEVO) ==========
// Restablece los votos a cero sin eliminar estudiantes ni candidatos
async function resetVotes(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    // 1. Restablecer flags de voto para todos los estudiantes
    const { error: studentsError } = await supabase
      .from('students')
      .update({ has_voted_personero: false, has_voted_contralor: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (studentsError) {
      return res.status(500).json({ error: 'Error al restablecer estudiantes', details: studentsError.message });
    }

    // 2. Restablecer votes a 0 para todos los candidatos
    const { error: candidatesError } = await supabase
      .from('candidates')
      .update({ votes: 0 })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (candidatesError) {
      return res.status(500).json({ error: 'Error al restablecer candidatos', details: candidatesError.message });
    }

    // 3. Eliminar todos los registros de votos (histórico)
    const { error: votesError } = await supabase
      .from('votes')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (votesError) {
      console.warn('Warning: No se pudieron eliminar los registros históricos de votos:', votesError.message);
      // No fallamos por esto, ya que los votos se restablecieron
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Votación restablecida correctamente. Los estudiantes pueden volver a votar.' 
    });
  } catch (err) {
    console.error('Error en resetVotes:', err);
    return res.status(500).json({ error: 'Error interno al restablecer votación', details: err.message });
  }
}

async function clearData(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { confirm } = req.body || {};
  if (confirm !== 'ELIMINAR TODO') return res.status(400).json({ error: 'Confirmación requerida' });

  await supabase.from('votes').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('students').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('candidates').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('config').update({ election_status: 'closed' }).eq('id', 1);

  return res.status(200).json({ success: true, message: 'Datos eliminados' });
}

async function clearStudents(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  // Eliminar solo estudiantes (NO candidatos, NO votos, NO config)
  await supabase.from('students').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  return res.status(200).json({ success: true, message: 'Estudiantes eliminados' });
}

// =====================================================
// STATS / MONITOR / RESULTS
// =====================================================

async function getStats(req, res) {
  const supabase = getSupabase();

  const adminCode = req.headers['x-admin-code'];

  const { data: config } = await supabase
    .from('config')
    .select('admin_code')
    .eq('id', 1)
    .single();

  if (!config || adminCode !== config.admin_code) return res.status(401).json({ error: 'No autorizado' });

  const { count: totalStudents } = await supabase.from('students').select('*', { count: 'exact', head: true });
  // En multirol, consideramos "votó" si votó al menos uno de los cargos
  const { count: votedStudents } = await supabase
    .from('students')
    .select('*', { count: 'exact', head: true })
    .or('has_voted_personero.eq.true,has_voted_contralor.eq.true');

  const { data: totalVotes } = await supabase.from('candidates').select('votes');
  const sumVotes = totalVotes?.reduce((a, b) => a + (b.votes || 0), 0) || 0;

  const { data: byGrade } = await supabase.from('participation_by_grade').select('*');
  const { data: results } = await supabase.from('election_results_by_role').select('*');

  return res.status(200).json({
    general: {
      totalStudents: totalStudents || 0,
      totalVoted: votedStudents || 0,
      totalVotes: sumVotes,
      participation: (totalStudents || 0) > 0 ? Math.round(((votedStudents || 0) / totalStudents) * 100) : 0
    },
    byGrade: byGrade || [],
    results: results || []
  });
}

async function getMonitorData(req, res) {
  const supabase = getSupabase();

  const adminCode = req.headers['x-admin-code'];
  const { data: config } = await supabase.from('config').select('admin_code').eq('id', 1).single();
  if (!config || adminCode !== config.admin_code) return res.status(401).json({ error: 'No autorizado' });

  try {
    const { data: students } = await supabase
      .from('students')
      .select('grade, course, has_voted_personero, has_voted_contralor')
      .order('grade')
      .order('course');

    const monitorData = {};
    students.forEach(s => {
      const key = `${s.grade}-${s.course}`;
      if (!monitorData[key]) {
        monitorData[key] = { grade: s.grade, course: s.course, total: 0, voted: 0 };
      }
      monitorData[key].total++;
      if (s.has_voted_personero || s.has_voted_contralor) monitorData[key].voted++;
    });

    const courses = Object.values(monitorData).map(c => ({
      ...c,
      pending: c.total - c.voted,
      participation: c.total > 0 ? Math.round((c.voted / c.total) * 100) : 0
    }));

    const gradeSummary = {};
    courses.forEach(c => {
      if (!gradeSummary[c.grade]) {
        gradeSummary[c.grade] = { grade: c.grade, total: 0, voted: 0 };
      }
      gradeSummary[c.grade].total += c.total;
      gradeSummary[c.grade].voted += c.voted;
    });

    const grades = Object.values(gradeSummary).map(g => ({
      ...g,
      pending: g.total - g.voted,
      participation: g.total > 0 ? Math.round((g.voted / g.total) * 100) : 0
    })).sort((a, b) => a.grade - b.grade);

    const totalGeneral = grades.reduce(
      (acc, g) => ({ total: acc.total + g.total, voted: acc.voted + g.voted }),
      { total: 0, voted: 0 }
    );

    return res.status(200).json({
      courses: courses.sort((a, b) => a.grade - b.grade || a.course - b.course),
      grades: grades,
      summary: {
        total: totalGeneral.total,
        voted: totalGeneral.voted,
        pending: totalGeneral.total - totalGeneral.voted,
        participation: totalGeneral.total > 0 ? Math.round((totalGeneral.voted / totalGeneral.total) * 100) : 0
      },
      lastUpdate: new Date().toLocaleTimeString()
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener datos de monitoreo' });
  }
}

async function getFinalResults(req, res) {
  const supabase = getSupabase();

  try {
    const { data: totalVotes } = await supabase.from('candidates').select('votes');
    const sumVotes = totalVotes?.reduce((a, b) => a + (b.votes || 0), 0) || 0;

    if (sumVotes === 0) {
      return res.status(200).json({
        message: 'No hay votos registrados aún',
        results: [],
        totalVotes: 0,
        totalStudents: 0,
        participation: 0
      });
    }

  // Nueva vista multirol
  const { data: results } = await supabase.from('election_results_by_role').select('*');
    const { count: totalStudents } = await supabase.from('students').select('*', { count: 'exact', head: true });
    const { count: votedStudents } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .or('has_voted_personero.eq.true,has_voted_contralor.eq.true');

    const maxVotes = Math.max(...results.map(r => r.votes));
    const winners = results.filter(r => r.votes === maxVotes && r.votes > 0);

    return res.status(200).json({
      results: results || [],
      totalVotes: sumVotes,
      totalStudents: totalStudents || 0,
      totalVoted: votedStudents || 0,
      participation: (totalStudents || 0) > 0 ? Math.round(((votedStudents || 0) / totalStudents) * 100) : 0,
      winners: winners,
      isTie: winners.length > 1,
      electionClosed: true
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener resultados' });
  }
}
