-- ============================================================================
--  DESCUBRE EC  ·  SEGURIDAD DE LA BASE (Supabase / PostgreSQL)
-- ============================================================================
--  Supabase publica el esquema `public` por su API REST (PostgREST) a los
--  roles `anon` y `authenticated`. Esta aplicacion NO usa esa API: todo el
--  acceso pasa por el backend, que se conecta con el rol duenio de las tablas.
--  Por eso:
--   1. RLS activado en todas las tablas y sin politicas: anon/authenticated
--      no pueden leer ni escribir nada (el duenio no se ve afectado).
--   2. Se retiran los privilegios de anon/authenticated sobre tablas, vistas,
--      secuencias y funciones (las vistas no respetan RLS por si solas).
--   3. Las vistas se ejecutan con los permisos de quien consulta
--      (security_invoker, PostgreSQL 15+).
--  En un PostgreSQL local sin esos roles, los pasos 2 se omiten.
-- ============================================================================

DO $$
DECLARE
    t RECORD;
    rol TEXT;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;

    FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', rol);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', rol);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', rol);
            EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', rol);
        END IF;
    END LOOP;

    IF current_setting('server_version_num')::int >= 150000 THEN
        FOR t IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
            EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', t.viewname);
        END LOOP;
    END IF;
END $$;
