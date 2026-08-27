-- The application owner grants schema creation only inside this transaction.
-- The operator returns to its session identity solely to assume the NOLOGIN
-- provisioner, then revokes CREATE again before this migration can commit.
GRANT USAGE, CREATE ON SCHEMA trailmind_app
    TO trailmind_import_schema_owner;
RESET ROLE;
SET LOCAL ROLE trailmind_import_schema_owner;
SET LOCAL search_path = pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS trailmind_app.outdoor_import_schema_leases (
    run_id uuid PRIMARY KEY,
    lease_id uuid NOT NULL UNIQUE,
    schema_name text NOT NULL UNIQUE,
    state text NOT NULL CHECK (state IN ('active', 'released')),
    created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
    released_at timestamptz,
    CONSTRAINT outdoor_import_schema_leases_canonical_name_check CHECK (
        schema_name = 'outdoor_import_' ||
            pg_catalog.replace(run_id::text, '-', '_')
    ),
    CONSTRAINT outdoor_import_schema_leases_release_state_check CHECK (
        (state = 'active' AND released_at IS NULL) OR
        (state = 'released' AND released_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS outdoor_import_schema_leases_one_active_idx
    ON trailmind_app.outdoor_import_schema_leases ((true))
    WHERE state = 'active';

ALTER TABLE trailmind_app.outdoor_import_schema_leases
    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE trailmind_app.outdoor_import_schema_leases
    FROM PUBLIC, anon, authenticated, service_role, regional_import_role;

CREATE OR REPLACE FUNCTION trailmind_app.provision_outdoor_import_schema_v1(
    requested_run_id uuid,
    requested_lease_id uuid
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    canonical_schema_name text;
    existing_lease trailmind_app.outdoor_import_schema_leases%ROWTYPE;
    schema_owner_name text;
    schema_marker text;
BEGIN
    IF session_user <> 'regional_import_role' OR
       current_user <> 'trailmind_import_schema_owner' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'outdoor import schema provisioning caller is not admitted';
    END IF;

    canonical_schema_name := 'outdoor_import_' ||
        pg_catalog.replace(requested_run_id::text, '-', '_');
    IF canonical_schema_name !~
       '^outdoor_import_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$' THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'outdoor import schema run identifier is not canonical';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'trailmind-outdoor-import-schema-provisioning', 0
        )
    );

    SELECT lease.*
      INTO existing_lease
      FROM trailmind_app.outdoor_import_schema_leases lease
     WHERE lease.run_id = requested_run_id
     FOR UPDATE;

    IF FOUND THEN
        IF existing_lease.lease_id <> requested_lease_id THEN
            RAISE EXCEPTION USING
                ERRCODE = '42501',
                MESSAGE = 'outdoor import schema lease does not match';
        END IF;
        IF existing_lease.state = 'released' THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'outdoor import schema lease cannot be replayed';
        END IF;

        SELECT owner.rolname,
               pg_catalog.obj_description(namespace.oid, 'pg_namespace')
          INTO schema_owner_name, schema_marker
          FROM pg_catalog.pg_namespace namespace
          JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
         WHERE namespace.nspname = canonical_schema_name;
        IF schema_owner_name <> 'trailmind_import_schema_owner' OR
           schema_marker <> 'trailmind:outdoor-import:' || requested_run_id::text
        THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'outdoor import schema replay state is invalid';
        END IF;
        RETURN canonical_schema_name;
    END IF;

    IF EXISTS (
        SELECT 1
          FROM trailmind_app.outdoor_import_schema_leases lease
         WHERE lease.state = 'active'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55P03',
            MESSAGE = 'another outdoor import schema lease is active';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM trailmind_app.outdoor_evidence_imports import_record
         WHERE import_record.import_id = requested_run_id
           AND import_record.status = 'loading'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'outdoor import run is not in the loading state';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_catalog.pg_namespace namespace
         WHERE namespace.nspname = canonical_schema_name
            OR namespace.nspname ~ '^outdoor_import_'
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'outdoor import schema namespace is not empty';
    END IF;

    INSERT INTO trailmind_app.outdoor_import_schema_leases (
        run_id, lease_id, schema_name, state
    ) VALUES (
        requested_run_id, requested_lease_id, canonical_schema_name, 'active'
    );
    EXECUTE pg_catalog.format(
        'CREATE SCHEMA %I AUTHORIZATION trailmind_import_schema_owner',
        canonical_schema_name
    );
    EXECUTE pg_catalog.format(
        'COMMENT ON SCHEMA %I IS %L',
        canonical_schema_name,
        'trailmind:outdoor-import:' || requested_run_id::text
    );
    EXECUTE pg_catalog.format(
        'GRANT USAGE, CREATE ON SCHEMA %I TO regional_import_role',
        canonical_schema_name
    );
    RETURN canonical_schema_name;
END
$function$;

CREATE OR REPLACE FUNCTION trailmind_app.release_outdoor_import_schema_v1(
    requested_run_id uuid,
    requested_lease_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
    canonical_schema_name text;
    existing_lease trailmind_app.outdoor_import_schema_leases%ROWTYPE;
    schema_owner_name text;
    schema_marker text;
BEGIN
    IF session_user <> 'regional_import_role' OR
       current_user <> 'trailmind_import_schema_owner' THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'outdoor import schema release caller is not admitted';
    END IF;

    canonical_schema_name := 'outdoor_import_' ||
        pg_catalog.replace(requested_run_id::text, '-', '_');
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'trailmind-outdoor-import-schema-provisioning', 0
        )
    );

    SELECT lease.*
      INTO existing_lease
      FROM trailmind_app.outdoor_import_schema_leases lease
     WHERE lease.run_id = requested_run_id
     FOR UPDATE;
    IF NOT FOUND OR existing_lease.lease_id <> requested_lease_id THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'outdoor import schema lease does not match';
    END IF;
    IF existing_lease.state = 'released' THEN
        IF pg_catalog.to_regnamespace(canonical_schema_name) IS NOT NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '55000',
                MESSAGE = 'released outdoor import schema still exists';
        END IF;
        RETURN false;
    END IF;

    SELECT owner.rolname,
           pg_catalog.obj_description(namespace.oid, 'pg_namespace')
      INTO schema_owner_name, schema_marker
      FROM pg_catalog.pg_namespace namespace
      JOIN pg_catalog.pg_roles owner ON owner.oid = namespace.nspowner
     WHERE namespace.nspname = canonical_schema_name;
    IF schema_owner_name <> 'trailmind_import_schema_owner' OR
       schema_marker <> 'trailmind:outdoor-import:' || requested_run_id::text
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'outdoor import schema release state is invalid';
    END IF;

    EXECUTE pg_catalog.format('DROP SCHEMA %I CASCADE', canonical_schema_name);
    UPDATE trailmind_app.outdoor_import_schema_leases
       SET state = 'released',
           released_at = pg_catalog.clock_timestamp()
     WHERE run_id = requested_run_id
       AND lease_id = requested_lease_id
       AND state = 'active';
    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '55000',
            MESSAGE = 'outdoor import schema release transition failed';
    END IF;
    RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION
    trailmind_app.provision_outdoor_import_schema_v1(uuid, uuid),
    trailmind_app.release_outdoor_import_schema_v1(uuid, uuid)
    FROM PUBLIC, anon, authenticated, service_role, regional_import_role;

RESET ROLE;
SET LOCAL ROLE trailmind_app_owner;
REVOKE CREATE ON SCHEMA trailmind_app
    FROM trailmind_import_schema_owner;
SET LOCAL search_path = trailmind_app, pg_catalog, trailmind_gis, pg_temp;
