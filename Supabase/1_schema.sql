-- ============================================================
-- SISTEMA DE VOTACIÓN ESCOLAR - MULTIROL (PERSONERO + CONTRALOR)
-- ============================================================
-- Formato de código:
--   <grado 2 dígitos><curso 1 dígito><lista 2 dígitos>
-- Ejemplos:
--   6-1 lista 5  -> 06105
--   7-3 lista 12 -> 07312
--   11-2 lista 3 -> 11203
-- ============================================================

-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TABLA ELECTION_ROLES (CARGOS)
-- ============================================================
CREATE TABLE IF NOT EXISTS election_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE, -- 'Personero' o 'Contralor'
  display_name TEXT NOT NULL, -- 'Personero Estudiantil' o 'Contralor Estudiantil'
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insertar los dos roles por defecto
INSERT INTO election_roles (name, display_name, is_active)
VALUES 
  ('personero', 'Personero Estudiantil', FALSE),
  ('contralor', 'Contralor Estudiantil', FALSE)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- TABLA CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  election_status TEXT NOT NULL DEFAULT 'closed'
    CHECK (election_status IN ('open', 'closed')),
  election_mode TEXT NOT NULL DEFAULT 'personero'
    CHECK (election_mode IN ('personero', 'contralor', 'both')),
  admin_code TEXT NOT NULL DEFAULT 'ADMIN2026',
  school_logo_url TEXT,
  school_name TEXT NOT NULL DEFAULT 'Colegio',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  election_started_at TIMESTAMP WITH TIME ZONE,
  election_closed_at TIMESTAMP WITH TIME ZONE
);

INSERT INTO config (id, election_status, election_mode, admin_code, school_logo_url, school_name)
VALUES (1, 'closed', 'personero', 'ADMIN2026', NULL, 'Colegio')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TABLA STUDENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 12),
  course INTEGER NOT NULL CHECK (course BETWEEN 1 AND 9),
  list_number INTEGER NOT NULL CHECK (list_number BETWEEN 1 AND 99),
  access_code TEXT UNIQUE NOT NULL,
  has_voted_personero BOOLEAN NOT NULL DEFAULT FALSE,
  has_voted_contralor BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(grade, course, list_number)
);

-- ============================================================
-- TABLA CANDIDATES (CON ROLE)
-- ============================================================
CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  party TEXT,
  photo_url TEXT,
  role_id UUID NOT NULL REFERENCES election_roles(id) ON DELETE CASCADE,
  votes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- TABLA VOTES (HISTÓRICO CON ROLE)
-- ============================================================
CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  role_id UUID NOT NULL REFERENCES election_roles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_students_access_code ON students(access_code);
CREATE INDEX IF NOT EXISTS idx_students_grade_course ON students(grade, course);
CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_votes_role ON votes(role_id);
CREATE INDEX IF NOT EXISTS idx_candidates_role ON candidates(role_id);

-- ============================================================
-- FUNCIÓN: GENERAR CÓDIGO ÚNICO (FORMATO 06105)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_access_code(
  p_grade INTEGER,
  p_course INTEGER,
  p_list_number INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN LPAD(p_grade::TEXT, 2, '0') ||
         p_course::TEXT ||
         LPAD(p_list_number::TEXT, 2, '0');
END;
$$;

-- ============================================================
-- TRIGGER: AUTO GENERAR ACCESS_CODE
-- ============================================================
CREATE OR REPLACE FUNCTION auto_generate_access_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.access_code IS NULL OR NEW.access_code = '' THEN
    NEW.access_code := generate_access_code(
      NEW.grade,
      NEW.course,
      NEW.list_number
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_code ON students;
CREATE TRIGGER trigger_auto_code
  BEFORE INSERT ON students
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_access_code();

-- ============================================================
-- FUNCIÓN ATÓMICA CRÍTICA: CAST_VOTE (ACTUALIZADA MULTIROL)
-- ============================================================
CREATE OR REPLACE FUNCTION cast_vote(
  p_access_code TEXT,
  p_candidate_id UUID,
  p_role_name TEXT -- 'personero' o 'contralor'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_student RECORD;
  v_election_status TEXT;
  v_election_mode TEXT;
  v_role RECORD;
  v_candidate RECORD;
BEGIN
  -- Verificar estado y modo de elección
  SELECT election_status, election_mode
  INTO v_election_status, v_election_mode
  FROM config
  WHERE id = 1;

  IF v_election_status != 'open' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'La votación está cerrada'
    );
  END IF;

  -- Verificar que el rol esté activo según el modo
  IF v_election_mode = 'personero' AND p_role_name != 'personero' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Solo se está votando para Personero'
    );
  END IF;

  IF v_election_mode = 'contralor' AND p_role_name != 'contralor' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Solo se está votando para Contralor'
    );
  END IF;

  -- Obtener información del rol
  SELECT * INTO v_role
  FROM election_roles
  WHERE name = p_role_name;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Rol no válido'
    );
  END IF;

  -- Buscar estudiante y bloquear fila
  SELECT *
  INTO v_student
  FROM students
  WHERE access_code = p_access_code
  FOR UPDATE;

  IF v_student IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Código de acceso no válido'
    );
  END IF;

  -- Verificar si ya votó para este rol específico
  IF p_role_name = 'personero' AND v_student.has_voted_personero THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ya has votado para Personero Estudiantil'
    );
  END IF;

  IF p_role_name = 'contralor' AND v_student.has_voted_contralor THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Ya has votado para Contralor Estudiantil'
    );
  END IF;

  -- Verificar candidato y que pertenezca al rol correcto
  SELECT * INTO v_candidate
  FROM candidates
  WHERE id = p_candidate_id AND role_id = v_role.id;

  IF v_candidate IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Candidato no válido para este cargo'
    );
  END IF;

  -- 1) Marcar como votado para el rol específico
  IF p_role_name = 'personero' THEN
    UPDATE students
    SET has_voted_personero = TRUE
    WHERE id = v_student.id;
  ELSIF p_role_name = 'contralor' THEN
    UPDATE students
    SET has_voted_contralor = TRUE
    WHERE id = v_student.id;
  END IF;

  -- 2) Insertar registro histórico
  INSERT INTO votes (candidate_id, student_id, role_id)
  VALUES (p_candidate_id, v_student.id, v_role.id);

  -- 3) Incrementar contador
  UPDATE candidates
  SET votes = votes + 1
  WHERE id = p_candidate_id;

  -- Retornar éxito
  RETURN jsonb_build_object(
    'success', true,
    'student', jsonb_build_object(
      'name', v_student.full_name,
      'grade', v_student.grade,
      'course', v_student.course
    ),
    'role', p_role_name
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Error del sistema: ' || SQLERRM
  );
END;
$$;

-- ============================================================
-- FUNCIÓN: VERIFICAR ESTADO DE VOTACIÓN DEL ESTUDIANTE
-- ============================================================
CREATE OR REPLACE FUNCTION check_student_voting_status(
  p_access_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_student RECORD;
  v_election_mode TEXT;
BEGIN
  -- Obtener modo de elección
  SELECT election_mode INTO v_election_mode
  FROM config WHERE id = 1;

  -- Buscar estudiante
  SELECT * INTO v_student
  FROM students
  WHERE access_code = p_access_code;

  IF v_student IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Código no válido'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'student', jsonb_build_object(
      'name', v_student.full_name,
      'grade', v_student.grade,
      'course', v_student.course,
      'has_voted_personero', v_student.has_voted_personero,
      'has_voted_contralor', v_student.has_voted_contralor
    ),
    'election_mode', v_election_mode
  );
END;
$$;

-- ============================================================
-- VISTAS ÚTILES PARA ADMIN
-- ============================================================

-- Participación por grado (actualizada)
CREATE OR REPLACE VIEW participation_by_grade AS
SELECT
  grade,
  COUNT(*) AS total_students,
  SUM(CASE WHEN has_voted_personero THEN 1 ELSE 0 END) AS voted_personero,
  SUM(CASE WHEN has_voted_contralor THEN 1 ELSE 0 END) AS voted_contralor,
  ROUND(
    100.0 * SUM(CASE WHEN has_voted_personero THEN 1 ELSE 0 END) / COUNT(*),
    1
  ) AS participation_personero_percent,
  ROUND(
    100.0 * SUM(CASE WHEN has_voted_contralor THEN 1 ELSE 0 END) / COUNT(*),
    1
  ) AS participation_contralor_percent
FROM students
GROUP BY grade
ORDER BY grade;

-- Resultados por rol
CREATE OR REPLACE VIEW election_results_by_role AS
SELECT
  c.id,
  c.name,
  c.party,
  c.photo_url,
  c.votes,
  r.name as role_name,
  r.display_name as role_display_name,
  CASE
    WHEN (SELECT SUM(votes) FROM candidates WHERE role_id = c.role_id) > 0
    THEN ROUND(100.0 * c.votes / (SELECT SUM(votes) FROM candidates WHERE role_id = c.role_id), 2)
    ELSE 0
  END AS percentage
FROM candidates c
INNER JOIN election_roles r ON c.role_id = r.id
ORDER BY r.name, c.votes DESC;

-- ================================
-- POLICIES (RLS)
-- ================================

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE config ENABLE ROW LEVEL SECURITY;
ALTER TABLE election_roles ENABLE ROW LEVEL SECURITY;

-- Students
DROP POLICY IF EXISTS service_all_students ON students;
CREATE POLICY service_all_students
ON students FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Candidates
DROP POLICY IF EXISTS service_all_candidates ON candidates;
CREATE POLICY service_all_candidates
ON candidates FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Votes
DROP POLICY IF EXISTS service_all_votes ON votes;
CREATE POLICY service_all_votes
ON votes FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Config
DROP POLICY IF EXISTS service_all_config ON config;
CREATE POLICY service_all_config
ON config FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Election Roles
DROP POLICY IF EXISTS service_all_roles ON election_roles;
CREATE POLICY service_all_roles
ON election_roles FOR ALL TO service_role
USING (true) WITH CHECK (true);
