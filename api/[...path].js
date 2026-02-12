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

  // Leer estudiante con los nuevos flags
  const { data: student, error } = await supabase
    .from('students')
    .select('id, full_name, grade, course, has_voted_personero, has_voted_contralor')
    .eq('access_code', access_code)
    .single();

  if (error || !student) return res.status(404).json({ error: 'Código no encontrado' });

  // Leer modo de elección
  const { data: cfg, error: cfgErr } = await supabase
    .from('config')
    .select('election_mode, election_status')
    .eq('id', 1)
    .single();

  if (cfgErr || !cfg) return res.status(500).json({ error: 'Error al consultar configuración' });

  if (cfg.election_status !== 'open') {
    return res.status(403).json({ error: 'La votación está cerrada' });
  }

  // Validar uso del código según el modo
  if (cfg.election_mode === 'personero' && student.has_voted_personero) {
    return res.status(403).json({ error: 'Este código ya ha sido utilizado (Personero)' });
  }
  if (cfg.election_mode === 'contralor' && student.has_voted_contralor) {
    return res.status(403).json({ error: 'Este código ya ha sido utilizado (Contralor)' });
  }
  if (cfg.election_mode === 'both' && (student.has_voted_personero || student.has_voted_contralor)) {
    return res.status(403).json({ error: 'Este código ya ha sido utilizado' });
  }

  return res.status(200).json({
    valid: true,
    student: { name: student.full_name, grade: student.grade, course: student.course },
    mode: cfg.election_mode
  });
}


async function castVote(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { access_code, candidate_id, personero_id, contralor_id } = req.body || {};
  if (!access_code) return res.status(400).json({ error: 'Datos incompletos' });

  // Leer modo de elección
  const { data: cfg, error: cfgErr } = await supabase
    .from('config')
    .select('election_mode, election_status')
    .eq('id', 1)
    .single();

  if (cfgErr || !cfg) return res.status(500).json({ error: 'Error al consultar configuración' });
  if (cfg.election_status !== 'open') return res.status(403).json({ error: 'La votación está cerrada' });

  // Modo ambos: voto atómico (Opción 1)
  if (cfg.election_mode === 'both') {
    if (!personero_id || !contralor_id) {
      return res.status(400).json({ error: 'Debes seleccionar Personero y Contralor' });
    }

    const { data, error } = await supabase.rpc('cast_vote_both', {
      p_access_code: access_code,
      p_personero_id: personero_id,
      p_contralor_id: contralor_id
    });

    if (error) return res.status(500).json({ error: 'Error al procesar voto', details: error.message });

    const result = data;
    if (!result?.success) return res.status(400).json({ error: result?.error || 'Error al registrar' });

    return res.status(200).json({
      success: true,
      message: 'Votos registrados correctamente',
      student: result.student
    });
  }

  // Modo simple: Personero o Contralor (role se infiere del modo)
  if (!candidate_id) return res.status(400).json({ error: 'Datos incompletos' });

  const { data, error } = await supabase.rpc('cast_vote', {
    p_access_code: access_code,
    p_candidate_id: candidate_id,
    p_role_name: cfg.election_mode
  });

  if (error) return res.status(500).json({ error: 'Error al procesar voto', details: error.message });

  const result = data;
  if (!result?.success) return res.status(400).json({ error: result?.error || 'Error al registrar' });

  return res.status(200).json({
    success: true,
    message: 'Voto registrado correctamente',
    student: result.student
  });
}


async function getCandidates(req, res) {
  const supabase = getSupabase();

  // Leer modo de elección para filtrar en modos simples
  const { data: cfg, error: cfgErr } = await supabase
    .from('config')
    .select('election_mode')
    .eq('id', 1)
    .single();

  if (cfgErr || !cfg) return res.status(500).json({ error: 'Error al consultar configuración' });

  // Traer candidatos con rol
  const { data, error } = await supabase
    .from('candidates')
    .select('id, name, party, photo_url, role_id, election_roles(name, display_name)')
    .order('name');

  if (error) return res.status(500).json({ error: 'Error al cargar candidatos' });

  const normalized = (data || []).map(c => ({
    id: c.id,
    name: c.name,
    party: c.party,
    photo_url: c.photo_url,
    role_id: c.role_id,
    role_name: c.election_roles?.name || null,
    role_display_name: c.election_roles?.display_name || null
  }));

  if (cfg.election_mode === 'personero') {
    return res.status(200).json({ candidates: normalized.filter(c => c.role_name === 'personero'), mode: cfg.election_mode });
  }
  if (cfg.election_mode === 'contralor') {
    return res.status(200).json({ candidates: normalized.filter(c => c.role_name === 'contralor'), mode: cfg.election_mode });
  }

  // both: enviar todos (frontend lo separa)
  return res.status(200).json({ candidates: normalized, mode: cfg.election_mode });
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

    // Compatibilidad con admin antiguo: exponer "has_voted" como si fuera un solo boolean
    const students = (data || []).map(s => ({
      ...s,
      has_voted: !!(s.has_voted_personero || s.has_voted_contralor)
    }));

    return res.status(200).json({ students });
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
      .select('id, name, party, photo_url, role_id, votes, created_at, election_roles(name, display_name)')
      .order('name');

    if (error) return res.status(500).json({ error: 'Error al cargar candidatos' });

    const candidates = (data || []).map(c => ({
      ...c,
      role_name: c.election_roles?.name || null,
      role_display_name: c.election_roles?.display_name || null
    }));

    return res.status(200).json({ candidates });
  }

  if (req.method === 'POST') {
    const { name, party, photo_url, role_name, role_id } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    let resolvedRoleId = role_id;

    // Si viene role_name, resolverlo a role_id
    if (!resolvedRoleId) {
      const rn = (role_name || 'personero').toLowerCase();
      const { data: role, error: roleErr } = await supabase
        .from('election_roles')
        .select('id')
        .eq('name', rn)
        .single();

      if (roleErr || !role) return res.status(400).json({ error: 'Rol inválido' });
      resolvedRoleId = role.id;
    }

    const { data, error } = await supabase
      .from('candidates')
      .insert([{
        name,
        party: party || '',
        photo_url: photo_url || '',
        role_id: resolvedRoleId
      }])
      .select('id, name, party, photo_url, role_id, votes, created_at')
      .single();

    if (error) return res.status(500).json({ error: 'Error al crear candidato' });
    return res.status(200).json({ candidate: data });
  }

  if (req.method === 'PUT') {
    const { id, photo_url, name, party, role_id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const patch = {};
    if (photo_url !== undefined) patch.photo_url = photo_url;
    if (name !== undefined) patch.name = name;
    if (party !== undefined) patch.party = party;
    if (role_id !== undefined) patch.role_id = role_id;

    const { error } = await supabase.from('candidates').update(patch).eq('id', id);
    if (error) return res.status(500).json({ error: 'Error al actualizar candidato' });

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

  const { action, mode } = req.body || {};
  if (!['open', 'close'].includes(action)) return res.status(400).json({ error: 'Acción inválida' });

  // Leer estado actual
  const { data: cfg, error: cfgErr } = await supabase
    .from('config')
    .select('election_status, election_mode')
    .eq('id', 1)
    .single();

  if (cfgErr || !cfg) return res.status(500).json({ error: 'Error al consultar configuración' });

  // Permitir cambiar modo SOLO si está cerrada y el admin lo manda (requisito)
  const patch = {};
  if (action === 'open') {
    patch.election_status = 'open';
    patch.election_started_at = new Date().toISOString();
    patch.election_closed_at = null;

    if (mode) {
      const m = String(mode).toLowerCase();
      if (!['personero', 'contralor', 'both'].includes(m)) {
        return res.status(400).json({ error: 'Modo inválido' });
      }
      if (cfg.election_status === 'open' && cfg.election_mode !== m) {
        return res.status(400).json({ error: 'No se puede cambiar el modo con la elección abierta' });
      }
      // Si está cerrada, sí lo cambiamos antes de abrir
      if (cfg.election_status !== 'open') patch.election_mode = m;
    }
  } else {
    patch.election_status = 'closed';
    patch.election_closed_at = new Date().toISOString();
  }

  const { error } = await supabase.from('config').update(patch).eq('id', 1);

  if (error) return res.status(500).json({ error: 'Error al cambiar estado', details: error.message });

  return res.status(200).json({
    success: true,
    status: patch.election_status,
    mode: patch.election_mode || cfg.election_mode
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
    // 1. Restablecer flags de votación para todos los estudiantes
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

    // 3. Eliminar histórico de votos
    const { error: votesError } = await supabase
      .from('votes')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (votesError) {
      console.warn('Warning: No se pudieron eliminar los registros históricos de votos:', votesError.message);
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
    .select('admin_code, election_mode')
    .eq('id', 1)
    .single();

  if (!config || adminCode !== config.admin_code) return res.status(401).json({ error: 'No autorizado' });

  const mode = config.election_mode || 'personero';

  const { count: totalStudents } = await supabase.from('students').select('*', { count: 'exact', head: true });

  let votedStudents = 0;
  if (mode === 'personero') {
    const { count } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('has_voted_personero', true);
    votedStudents = count || 0;
  } else if (mode === 'contralor') {
    const { count } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('has_voted_contralor', true);
    votedStudents = count || 0;
  } else {
    const { count } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('has_voted_personero', true)
      .eq('has_voted_contralor', true);
    votedStudents = count || 0;
  }

  // Total de votos según modo
  const { data: totalVotesData } = await supabase
    .from('candidates')
    .select('votes, election_roles(name)')
    .order('created_at');

  const sumVotes = (totalVotesData || []).reduce((acc, c) => {
    const role = c.election_roles?.name;
    if (mode === 'personero' && role !== 'personero') return acc;
    if (mode === 'contralor' && role !== 'contralor') return acc;
    // both: suma todo
    return acc + (c.votes || 0);
  }, 0);

  const { data: byGrade } = await supabase.from('participation_by_grade').select('*');

  const { data: resultsAll } = await supabase.from('election_results_by_role').select('*');

  const resultsByRole = {
    personero: (resultsAll || []).filter(r => r.role_name === 'personero'),
    contralor: (resultsAll || []).filter(r => r.role_name === 'contralor'),
  };

  const results =
    mode === 'personero' ? resultsByRole.personero :
    mode === 'contralor' ? resultsByRole.contralor :
    (resultsAll || []);

  return res.status(200).json({
    general: {
      mode,
      totalStudents: totalStudents || 0,
      totalVoted: votedStudents || 0,
      totalVotes: sumVotes,
      participation: (totalStudents || 0) > 0 ? Math.round(((votedStudents || 0) / totalStudents) * 100) : 0
    },
    byGrade: byGrade || [],
    results: results || [],
    resultsByRole
  });
}


async function getMonitorData(req, res) {
  const supabase = getSupabase();

  const adminCode = req.headers['x-admin-code'];
  const { data: config } = await supabase.from('config').select('admin_code, election_mode').eq('id', 1).single();
  if (!config || adminCode !== config.admin_code) return res.status(401).json({ error: 'No autorizado' });

  const mode = config.election_mode || 'personero';

  try {
    const { data: students, error } = await supabase
      .from('students')
      .select('grade, course, has_voted_personero, has_voted_contralor')
      .order('grade')
      .order('course');

    if (error) return res.status(500).json({ error: 'Error al obtener estudiantes', details: error.message });

    const hasVotedInMode = (s) => {
      if (mode === 'personero') return !!s.has_voted_personero;
      if (mode === 'contralor') return !!s.has_voted_contralor;
      return !!(s.has_voted_personero && s.has_voted_contralor);
    };

    const monitorData = {};
    (students || []).forEach(s => {
      const key = `${s.grade}-${s.course}`;
      if (!monitorData[key]) {
        monitorData[key] = { grade: s.grade, course: s.course, total: 0, voted: 0 };
      }
      monitorData[key].total++;
      if (hasVotedInMode(s)) monitorData[key].voted++;
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
      mode,
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
    const { data: cfg } = await supabase
      .from('config')
      .select('election_mode')
      .eq('id', 1)
      .single();

    const mode = cfg?.election_mode || 'personero';

    const { data: resultsAll, error: resErr } = await supabase
      .from('election_results_by_role')
      .select('*');

    if (resErr) return res.status(500).json({ error: 'Error al obtener resultados', details: resErr.message });

    const resultsByRole = {
      personero: (resultsAll || []).filter(r => r.role_name === 'personero'),
      contralor: (resultsAll || []).filter(r => r.role_name === 'contralor')
    };

    // Total votos según modo
    const sumVotes =
      mode === 'personero'
        ? resultsByRole.personero.reduce((a, r) => a + (r.votes || 0), 0)
        : mode === 'contralor'
          ? resultsByRole.contralor.reduce((a, r) => a + (r.votes || 0), 0)
          : (resultsAll || []).reduce((a, r) => a + (r.votes || 0), 0);

    if (sumVotes === 0) {
      return res.status(200).json({
        message: 'No hay votos registrados aún',
        results: [],
        resultsByRole,
        totalVotes: 0,
        totalStudents: 0,
        participation: 0,
        mode
      });
    }

    const { count: totalStudents } = await supabase.from('students').select('*', { count: 'exact', head: true });

    let votedStudents = 0;
    if (mode === 'personero') {
      const { count } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('has_voted_personero', true);
      votedStudents = count || 0;
    } else if (mode === 'contralor') {
      const { count } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('has_voted_contralor', true);
      votedStudents = count || 0;
    } else {
      const { count } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('has_voted_personero', true)
        .eq('has_voted_contralor', true);
      votedStudents = count || 0;
    }

    const winnersByRole = {};
    for (const role of ['personero', 'contralor']) {
      const arr = resultsByRole[role] || [];
      const maxVotes = arr.length ? Math.max(...arr.map(r => r.votes || 0)) : 0;
      const winners = arr.filter(r => (r.votes || 0) === maxVotes && maxVotes > 0);
      winnersByRole[role] = { winners, isTie: winners.length > 1 };
    }

    const results =
      mode === 'personero' ? resultsByRole.personero :
      mode === 'contralor' ? resultsByRole.contralor :
      (resultsAll || []);

    return res.status(200).json({
      mode,
      results: results || [],
      resultsByRole,
      totalVotes: sumVotes,
      totalStudents: totalStudents || 0,
      totalVoted: votedStudents || 0,
      participation: (totalStudents || 0) > 0 ? Math.round(((votedStudents || 0) / totalStudents) * 100) : 0,
      winners: mode === 'both' ? null : winnersByRole[mode]?.winners || [],
      winnersByRole,
      electionClosed: true
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al obtener resultados' });
  }
}
