import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export default async function handler(req, res) {
  const path = req.query.path || [];

  try {
    if (path[0] === 'check-status') return checkStatus(req, res);
    if (path[0] === 'verify-code') return verifyCode(req, res);
    if (path[0] === 'candidates') return getCandidates(req, res);
    if (path[0] === 'vote') return castVote(req, res);

    return res.status(404).json({ error: 'Ruta no encontrada' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}

// ================================
// CHECK STATUS
// ================================
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

// ================================
// VERIFY CODE
// ================================
async function verifyCode(req, res) {
  const supabase = getSupabase();

  const { access_code } = req.body || {};

  if (!access_code)
    return res.status(400).json({ error: 'Código requerido' });

  const { data: student, error } = await supabase
    .from('students')
    .select(
      'id, full_name, grade, course, has_voted_personero, has_voted_contralor'
    )
    .eq('access_code', access_code)
    .single();

  if (error || !student)
    return res.status(404).json({ error: 'Código inválido' });

  const { data: config } = await supabase
    .from('config')
    .select('election_mode')
    .eq('id', 1)
    .single();

  if (config.election_mode === 'personero' && student.has_voted_personero)
    return res.status(403).json({ error: 'Ya votaste para Personero' });

  if (config.election_mode === 'contralor' && student.has_voted_contralor)
    return res.status(403).json({ error: 'Ya votaste para Contralor' });

  if (
    config.election_mode === 'both' &&
    (student.has_voted_personero || student.has_voted_contralor)
  )
    return res.status(403).json({ error: 'Ya votaste en esta elección' });

  return res.status(200).json({
    student: {
      name: student.full_name,
      grade: student.grade,
      course: student.course
    }
  });
}

// ================================
// GET CANDIDATES
// ================================
async function getCandidates(req, res) {
  const supabase = getSupabase();

  const { data: config } = await supabase
    .from('config')
    .select('election_mode')
    .eq('id', 1)
    .single();

  const { data, error } = await supabase
    .from('candidates')
    .select('id, name, party, photo_url, election_roles(name)')
    .order('name');

  if (error)
    return res.status(500).json({ error: 'Error al cargar candidatos' });

  if (config.election_mode === 'personero') {
    return res.status(200).json({
      candidates: data.filter(
        (c) => c.election_roles.name === 'personero'
      )
    });
  }

  if (config.election_mode === 'contralor') {
    return res.status(200).json({
      candidates: data.filter(
        (c) => c.election_roles.name === 'contralor'
      )
    });
  }

  // both
  return res.status(200).json({ candidates: data });
}

// ================================
// CAST VOTE
// ================================
async function castVote(req, res) {
  const supabase = getSupabase();

  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Método no permitido' });

  const {
    access_code,
    candidate_id,
    personero_id,
    contralor_id
  } = req.body || {};

  if (!access_code)
    return res.status(400).json({ error: 'Código requerido' });

  const { data: config } = await supabase
    .from('config')
    .select('election_mode')
    .eq('id', 1)
    .single();

  // ========================
  // MODO BOTH
  // ========================
  if (config.election_mode === 'both') {
    if (!personero_id || !contralor_id)
      return res
        .status(400)
        .json({ error: 'Debe votar ambos cargos' });

    const { data, error } = await supabase.rpc('cast_vote_both', {
      p_access_code: access_code,
      p_personero_id: personero_id,
      p_contralor_id: contralor_id
    });

    if (error)
      return res.status(500).json({ error: error.message });

    if (!data.success)
      return res.status(400).json({ error: data.error });

    return res.status(200).json({ success: true });
  }

  // ========================
  // MODO SIMPLE
  // ========================
  if (!candidate_id)
    return res
      .status(400)
      .json({ error: 'Debe seleccionar candidato' });

  const role = config.election_mode;

  const { data, error } = await supabase.rpc('cast_vote', {
    p_access_code: access_code,
    p_candidate_id: candidate_id,
    p_role_name: role
  });

  if (error)
    return res.status(500).json({ error: error.message });

  if (!data.success)
    return res.status(400).json({ error: data.error });

  return res.status(200).json({ success: true });
}
