create schema onboarding_private;
revoke all on schema onboarding_private from public, anon, authenticated;

create function onboarding_private.text_array_is_unique_and_allowed(
    p_values text[],
    p_allowed text[],
    p_maximum integer
)
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
    select
        coalesce(array_ndims(p_values), 1) = 1
        and cardinality(p_values) <= p_maximum
        and array_position(p_values, null) is null
        and p_values <@ p_allowed
        and cardinality(p_values) = (
            select count(distinct item)::integer
            from unnest(p_values) as items(item)
        );
$function$;

revoke all on function onboarding_private.text_array_is_unique_and_allowed(text[], text[], integer)
from public, anon, authenticated;

create table public.onboarding_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    profile_id uuid not null unique,
    schema_version smallint not null default 1,
    onboarding_version varchar(32) not null,
    profile_created_at timestamptz not null,
    profile_updated_at timestamptz not null,
    default_activity text,
    comfort_basis text,
    comfortable_distance_min_km numeric(5,1),
    comfortable_distance_max_km numeric(5,1),
    comfortable_duration_min_minutes smallint,
    comfortable_duration_max_minutes smallint,
    preferred_route_shape text,
    requested_experiences text[],
    soft_avoidances text[],
    last_client_revision bigint not null,
    server_revision bigint not null default 1,
    last_client_mutation_id uuid not null,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),

    constraint onboarding_profiles_schema_version_v1
        check (schema_version = 1),
    constraint onboarding_profiles_onboarding_version_format
        check (onboarding_version ~ '^[a-z0-9][a-z0-9_]{0,31}$'),
    constraint onboarding_profiles_profile_chronology
        check (profile_updated_at >= profile_created_at),
    constraint onboarding_profiles_default_activity_values
        check (
            default_activity is null
            or default_activity in ('hiking', 'trail_running', 'biking')
        ),
    constraint onboarding_profiles_comfort_basis_values
        check (
            comfort_basis is null
            or comfort_basis in ('distance_kilometers', 'duration_minutes')
        ),
    constraint onboarding_profiles_distance_min_bounds
        check (
            comfortable_distance_min_km is null
            or comfortable_distance_min_km between 1.0 and 300.0
        ),
    constraint onboarding_profiles_distance_max_bounds
        check (
            comfortable_distance_max_km is null
            or comfortable_distance_max_km between 1.0 and 300.0
        ),
    constraint onboarding_profiles_duration_min_bounds
        check (
            comfortable_duration_min_minutes is null
            or comfortable_duration_min_minutes between 15 and 1440
        ),
    constraint onboarding_profiles_duration_max_bounds
        check (
            comfortable_duration_max_minutes is null
            or comfortable_duration_max_minutes between 15 and 1440
        ),
    constraint onboarding_profiles_comfort_shape
        check (
            (
                comfort_basis is null
                and comfortable_distance_min_km is null
                and comfortable_distance_max_km is null
                and comfortable_duration_min_minutes is null
                and comfortable_duration_max_minutes is null
            )
            or (
                comfort_basis = 'distance_kilometers'
                and comfortable_distance_min_km is not null
                and comfortable_distance_max_km is not null
                and comfortable_distance_min_km <= comfortable_distance_max_km
                and comfortable_duration_min_minutes is null
                and comfortable_duration_max_minutes is null
            )
            or (
                comfort_basis = 'duration_minutes'
                and comfortable_duration_min_minutes is not null
                and comfortable_duration_max_minutes is not null
                and comfortable_duration_min_minutes <= comfortable_duration_max_minutes
                and comfortable_distance_min_km is null
                and comfortable_distance_max_km is null
            )
        ),
    constraint onboarding_profiles_route_shape_values
        check (
            preferred_route_shape is null
            or preferred_route_shape in ('loop', 'point_to_point')
        ),
    constraint onboarding_profiles_requested_experiences_values
        check (
            onboarding_private.text_array_is_unique_and_allowed(
                requested_experiences,
                array[
                    'viewpoints',
                    'forest',
                    'quiet_nature',
                    'waterfalls',
                    'lakes',
                    'peaks',
                    'huts',
                    'landmarks'
                ]::text[],
                8
            )
        ),
    constraint onboarding_profiles_soft_avoidances_values
        check (
            onboarding_private.text_array_is_unique_and_allowed(
                soft_avoidances,
                array[
                    'steep_climbs',
                    'major_roads',
                    'repeated_sections'
                ]::text[],
                3
            )
        ),
    constraint onboarding_profiles_last_client_revision_bounds
        check (last_client_revision between 1 and 9223372036854775805),
    constraint onboarding_profiles_server_revision_bounds
        check (server_revision between 1 and 9223372036854775806)
);

comment on table public.onboarding_profiles is
'Local-first Wanderful hiking preference profile V1. NULL means unknown/skipped; empty arrays mean explicitly none.';
comment on column public.onboarding_profiles.server_revision is
'Server-side mutation count. This is independent from the monotonic local last_client_revision.';
comment on column public.onboarding_profiles.last_client_mutation_id is
'Client-generated UUID used to recognize an idempotent retry of the most recent mutation.';

alter table public.onboarding_profiles enable row level security;
alter table public.onboarding_profiles force row level security;

revoke all on table public.onboarding_profiles from public, anon, authenticated;
grant select on table public.onboarding_profiles to authenticated;

create policy onboarding_profiles_select_owner
on public.onboarding_profiles
for select
to authenticated
using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
);

create policy onboarding_profiles_insert_owner
on public.onboarding_profiles
for insert
to authenticated
with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
);

create policy onboarding_profiles_update_owner
on public.onboarding_profiles
for update
to authenticated
using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
)
with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
);

create policy onboarding_profiles_delete_owner
on public.onboarding_profiles
for delete
to authenticated
using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
);

create table public.onboarding_events (
    event_id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    flow_session_id uuid not null,
    event_ordinal smallint not null,
    schema_version smallint not null default 1,
    onboarding_version varchar(32) not null,
    app_version varchar(32) not null,
    event_name text not null,
    step_key text,
    value_code text,
    analytics_scope text not null,
    consent_version varchar(32) not null,
    consent_granted_at timestamptz not null,
    occurred_at timestamptz not null,
    retention_expires_at timestamptz not null,
    created_at timestamptz not null default clock_timestamp(),

    constraint onboarding_events_session_ordinal_unique
        unique (user_id, flow_session_id, event_ordinal),
    constraint onboarding_events_ordinal_bounds
        check (event_ordinal between 1 and 64),
    constraint onboarding_events_schema_version_v1
        check (schema_version = 1),
    constraint onboarding_events_onboarding_version_format
        check (onboarding_version ~ '^[a-z0-9][a-z0-9_]{0,31}$'),
    constraint onboarding_events_app_version_format
        check (app_version ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$'),
    constraint onboarding_events_name_values
        check (
            event_name in (
                'flow_started',
                'step_viewed',
                'answer_selected',
                'answer_unknown',
                'step_completed',
                'flow_completed',
                'flow_abandoned',
                'profile_edited',
                'profile_reset'
            )
        ),
    constraint onboarding_events_step_values
        check (
            step_key is null
            or step_key in (
                'welcome',
                'activity',
                'comfort',
                'route_shape',
                'avoidances',
                'experiences',
                'trust',
                'profile'
            )
        ),
    constraint onboarding_events_step_context
        check (
            (
                event_name in (
                    'flow_started',
                    'flow_completed',
                    'flow_abandoned',
                    'profile_edited',
                    'profile_reset'
                )
                and step_key is null
            )
            or (
                event_name in (
                    'step_viewed',
                    'answer_selected',
                    'answer_unknown',
                    'step_completed'
                )
                and step_key is not null
            )
        ),
    constraint onboarding_events_value_code_format
        check (
            value_code is null
            or (
                event_name = 'answer_selected'
                and value_code in (
                    'hiking',
                    'trail_running',
                    'biking',
                    'distance_kilometers',
                    'duration_minutes',
                    'loop',
                    'point_to_point',
                    'steep_climbs',
                    'major_roads',
                    'repeated_sections',
                    'viewpoints',
                    'forest',
                    'quiet_nature',
                    'waterfalls',
                    'lakes',
                    'peaks',
                    'huts',
                    'landmarks',
                    'none'
                )
            )
        ),
    constraint onboarding_events_analytics_scope
        check (analytics_scope = 'onboarding_improvement'),
    constraint onboarding_events_consent_version_format
        check (consent_version ~ '^[a-z0-9][a-z0-9._-]{0,31}$'),
    constraint onboarding_events_consent_precedes_event
        check (consent_granted_at <= occurred_at),
    constraint onboarding_events_retention_bounds
        check (
            retention_expires_at > occurred_at
            and retention_expires_at <= occurred_at + interval '90 days'
        )
);

comment on table public.onboarding_events is
'Optional consent-gated, bounded onboarding interaction events. No raw prompts, coordinates, free text, profile snapshots, or device identifiers.';
comment on column public.onboarding_events.retention_expires_at is
'Caller-supplied deletion deadline, strictly no more than 90 days after the event.';

create index onboarding_events_user_occurred_idx
on public.onboarding_events (user_id, occurred_at desc);

create index onboarding_events_retention_expires_idx
on public.onboarding_events (retention_expires_at);

alter table public.onboarding_events enable row level security;
alter table public.onboarding_events force row level security;

revoke all on table public.onboarding_events from public, anon, authenticated;
grant select, delete on table public.onboarding_events to authenticated;

create policy onboarding_events_select_owner
on public.onboarding_events
for select
to authenticated
using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
);

create policy onboarding_events_insert_owner_with_consent
on public.onboarding_events
for insert
to authenticated
with check (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
    and consent_version is not null
    and consent_granted_at is not null
    and analytics_scope = 'onboarding_improvement'
);

create policy onboarding_events_delete_owner
on public.onboarding_events
for delete
to authenticated
using (
    (select auth.uid()) is not null
    and (select auth.uid()) = user_id
);

create function onboarding_private.upsert_onboarding_profile_v1_internal(
    p_profile_id uuid,
    p_client_revision bigint,
    p_client_mutation_id uuid,
    p_onboarding_version text,
    p_profile_created_at timestamptz,
    p_profile_updated_at timestamptz,
    p_default_activity text default null,
    p_comfort_basis text default null,
    p_comfortable_distance_min_km numeric default null,
    p_comfortable_distance_max_km numeric default null,
    p_comfortable_duration_min_minutes smallint default null,
    p_comfortable_duration_max_minutes smallint default null,
    p_preferred_route_shape text default null,
    p_requested_experiences text[] default null,
    p_soft_avoidances text[] default null
)
returns setof public.onboarding_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid;
    v_profile public.onboarding_profiles%rowtype;
begin
    v_user_id := (select auth.uid());

    if v_user_id is null then
        raise exception 'An authenticated user is required.'
            using errcode = '42501';
    end if;

    if p_profile_id is null
       or p_client_mutation_id is null
       or p_onboarding_version is null
       or p_profile_created_at is null
       or p_profile_updated_at is null
       or p_client_revision is null
       or p_client_revision < 1
       or p_client_revision > 9223372036854775805 then
        raise exception 'The onboarding profile mutation is invalid.'
            using errcode = '22023';
    end if;

    select *
    into v_profile
    from public.onboarding_profiles
    where user_id = v_user_id
    for update;

    if found then
        if v_profile.last_client_mutation_id = p_client_mutation_id then
            return next v_profile;
            return;
        end if;

        if v_profile.profile_id <> p_profile_id then
            raise exception 'The onboarding profile identifier is immutable.'
                using errcode = '22023';
        end if;

        if v_profile.profile_created_at <> p_profile_created_at then
            raise exception 'The onboarding profile creation timestamp is immutable.'
                using errcode = '22023';
        end if;

        if p_client_revision <= v_profile.last_client_revision then
            raise exception 'The onboarding profile client revision is stale.'
                using errcode = '40001';
        end if;

        if v_profile.server_revision >= 9223372036854775806 then
            raise exception 'The onboarding profile server revision is exhausted.'
                using errcode = '22003';
        end if;

        update public.onboarding_profiles
        set
            onboarding_version = p_onboarding_version,
            profile_updated_at = p_profile_updated_at,
            default_activity = p_default_activity,
            comfort_basis = p_comfort_basis,
            comfortable_distance_min_km = p_comfortable_distance_min_km,
            comfortable_distance_max_km = p_comfortable_distance_max_km,
            comfortable_duration_min_minutes = p_comfortable_duration_min_minutes,
            comfortable_duration_max_minutes = p_comfortable_duration_max_minutes,
            preferred_route_shape = p_preferred_route_shape,
            requested_experiences = p_requested_experiences,
            soft_avoidances = p_soft_avoidances,
            last_client_revision = p_client_revision,
            server_revision = v_profile.server_revision + 1,
            last_client_mutation_id = p_client_mutation_id,
            updated_at = clock_timestamp()
        where user_id = v_user_id
        returning * into v_profile;
    else
        insert into public.onboarding_profiles (
            user_id,
            profile_id,
            schema_version,
            onboarding_version,
            profile_created_at,
            profile_updated_at,
            default_activity,
            comfort_basis,
            comfortable_distance_min_km,
            comfortable_distance_max_km,
            comfortable_duration_min_minutes,
            comfortable_duration_max_minutes,
            preferred_route_shape,
            requested_experiences,
            soft_avoidances,
            last_client_revision,
            server_revision,
            last_client_mutation_id
        )
        values (
            v_user_id,
            p_profile_id,
            1,
            p_onboarding_version,
            p_profile_created_at,
            p_profile_updated_at,
            p_default_activity,
            p_comfort_basis,
            p_comfortable_distance_min_km,
            p_comfortable_distance_max_km,
            p_comfortable_duration_min_minutes,
            p_comfortable_duration_max_minutes,
            p_preferred_route_shape,
            p_requested_experiences,
            p_soft_avoidances,
            p_client_revision,
            1,
            p_client_mutation_id
        )
        returning * into v_profile;
    end if;

    return next v_profile;
    return;
end;
$function$;

create function onboarding_private.delete_onboarding_profile_v1_internal(
    p_profile_id uuid,
    p_client_revision bigint,
    p_client_mutation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid;
    v_profile public.onboarding_profiles%rowtype;
begin
    v_user_id := (select auth.uid());

    if v_user_id is null then
        raise exception 'An authenticated user is required.'
            using errcode = '42501';
    end if;

    if p_profile_id is null
       or p_client_mutation_id is null
       or p_client_revision is null
       or p_client_revision < 1
       or p_client_revision > 9223372036854775806 then
        raise exception 'The onboarding profile deletion is invalid.'
            using errcode = '22023';
    end if;

    select *
    into v_profile
    from public.onboarding_profiles
    where user_id = v_user_id
    for update;

    if not found then
        return true;
    end if;

    if v_profile.profile_id <> p_profile_id then
        raise exception 'The onboarding profile identifier does not match.'
            using errcode = '22023';
    end if;

    if p_client_revision <= v_profile.last_client_revision then
        raise exception 'The onboarding profile deletion revision is stale.'
            using errcode = '40001';
    end if;

    delete from public.onboarding_profiles
    where user_id = v_user_id;

    return true;
end;
$function$;

revoke all on function onboarding_private.upsert_onboarding_profile_v1_internal(
    uuid, bigint, uuid, text, timestamptz, timestamptz,
    text, text, numeric, numeric, smallint, smallint, text, text[], text[]
) from public, anon, authenticated;

revoke all on function onboarding_private.delete_onboarding_profile_v1_internal(
    uuid, bigint, uuid
) from public, anon, authenticated;

grant usage on schema onboarding_private to authenticated;

grant execute on function onboarding_private.upsert_onboarding_profile_v1_internal(
    uuid, bigint, uuid, text, timestamptz, timestamptz,
    text, text, numeric, numeric, smallint, smallint, text, text[], text[]
) to authenticated;

grant execute on function onboarding_private.delete_onboarding_profile_v1_internal(
    uuid, bigint, uuid
) to authenticated;

create function public.upsert_onboarding_profile_v1(
    p_profile_id uuid,
    p_client_revision bigint,
    p_client_mutation_id uuid,
    p_onboarding_version text,
    p_profile_created_at timestamptz,
    p_profile_updated_at timestamptz,
    p_default_activity text default null,
    p_comfort_basis text default null,
    p_comfortable_distance_min_km numeric default null,
    p_comfortable_distance_max_km numeric default null,
    p_comfortable_duration_min_minutes smallint default null,
    p_comfortable_duration_max_minutes smallint default null,
    p_preferred_route_shape text default null,
    p_requested_experiences text[] default null,
    p_soft_avoidances text[] default null
)
returns setof public.onboarding_profiles
language sql
security invoker
set search_path = ''
as $function$
    select *
    from onboarding_private.upsert_onboarding_profile_v1_internal(
        p_profile_id,
        p_client_revision,
        p_client_mutation_id,
        p_onboarding_version,
        p_profile_created_at,
        p_profile_updated_at,
        p_default_activity,
        p_comfort_basis,
        p_comfortable_distance_min_km,
        p_comfortable_distance_max_km,
        p_comfortable_duration_min_minutes,
        p_comfortable_duration_max_minutes,
        p_preferred_route_shape,
        p_requested_experiences,
        p_soft_avoidances
    );
$function$;

create function public.delete_onboarding_profile_v1(
    p_profile_id uuid,
    p_client_revision bigint,
    p_client_mutation_id uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
    select onboarding_private.delete_onboarding_profile_v1_internal(
        p_profile_id,
        p_client_revision,
        p_client_mutation_id
    );
$function$;

revoke all on function public.upsert_onboarding_profile_v1(
    uuid, bigint, uuid, text, timestamptz, timestamptz,
    text, text, numeric, numeric, smallint, smallint, text, text[], text[]
) from public, anon, authenticated;

revoke all on function public.delete_onboarding_profile_v1(
    uuid, bigint, uuid
) from public, anon, authenticated;

grant execute on function public.upsert_onboarding_profile_v1(
    uuid, bigint, uuid, text, timestamptz, timestamptz,
    text, text, numeric, numeric, smallint, smallint, text, text[], text[]
) to authenticated;

grant execute on function public.delete_onboarding_profile_v1(
    uuid, bigint, uuid
) to authenticated;

comment on function public.upsert_onboarding_profile_v1(
    uuid, bigint, uuid, text, timestamptz, timestamptz,
    text, text, numeric, numeric, smallint, smallint, text, text[], text[]
) is
'Idempotent owner-only profile sync. A greater client revision advances one server revision; a repeated mutation UUID returns the prior result.';

comment on function public.delete_onboarding_profile_v1(
    uuid, bigint, uuid
) is
'Idempotent owner-only profile deletion. Missing rows succeed; stale deletion revisions fail.';

create function onboarding_private.record_onboarding_event_v1_internal(
    p_event_id uuid,
    p_flow_session_id uuid,
    p_event_ordinal smallint,
    p_onboarding_version text,
    p_app_version text,
    p_event_name text,
    p_consent_version text,
    p_consent_granted_at timestamptz,
    p_occurred_at timestamptz,
    p_retention_expires_at timestamptz,
    p_step_key text default null,
    p_value_code text default null
)
returns setof public.onboarding_events
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_user_id uuid;
    v_event public.onboarding_events%rowtype;
begin
    v_user_id := (select auth.uid());

    if v_user_id is null then
        raise exception 'An authenticated user is required.'
            using errcode = '42501';
    end if;

    if p_event_id is null
       or p_flow_session_id is null
       or p_event_ordinal is null
       or p_onboarding_version is null
       or p_app_version is null
       or p_event_name is null
       or p_consent_version is null
       or p_consent_granted_at is null
       or p_occurred_at is null
       or p_retention_expires_at is null then
        raise exception 'The onboarding event is invalid.'
            using errcode = '22023';
    end if;

    insert into public.onboarding_events (
        event_id,
        user_id,
        flow_session_id,
        event_ordinal,
        schema_version,
        onboarding_version,
        app_version,
        event_name,
        step_key,
        value_code,
        analytics_scope,
        consent_version,
        consent_granted_at,
        occurred_at,
        retention_expires_at
    )
    values (
        p_event_id,
        v_user_id,
        p_flow_session_id,
        p_event_ordinal,
        1,
        p_onboarding_version,
        p_app_version,
        p_event_name,
        p_step_key,
        p_value_code,
        'onboarding_improvement',
        p_consent_version,
        p_consent_granted_at,
        p_occurred_at,
        p_retention_expires_at
    )
    on conflict do nothing
    returning * into v_event;

    if found then
        return next v_event;
        return;
    end if;

    select *
    into v_event
    from public.onboarding_events
    where event_id = p_event_id
      and user_id = v_user_id
      and flow_session_id = p_flow_session_id
      and event_ordinal = p_event_ordinal;

    if not found
       or v_event.schema_version <> 1
       or v_event.onboarding_version <> p_onboarding_version
       or v_event.app_version <> p_app_version
       or v_event.event_name <> p_event_name
       or v_event.step_key is distinct from p_step_key
       or v_event.value_code is distinct from p_value_code
       or v_event.analytics_scope <> 'onboarding_improvement'
       or v_event.consent_version <> p_consent_version
       or v_event.consent_granted_at <> p_consent_granted_at
       or v_event.occurred_at <> p_occurred_at
       or v_event.retention_expires_at <> p_retention_expires_at then
        raise exception 'The onboarding event idempotency key conflicts with another event.'
            using errcode = '22023';
    end if;

    return next v_event;
    return;
end;
$function$;

revoke all on function onboarding_private.record_onboarding_event_v1_internal(
    uuid, uuid, smallint, text, text, text, text,
    timestamptz, timestamptz, timestamptz, text, text
) from public, anon, authenticated;

grant execute on function onboarding_private.record_onboarding_event_v1_internal(
    uuid, uuid, smallint, text, text, text, text,
    timestamptz, timestamptz, timestamptz, text, text
) to authenticated;

create function public.record_onboarding_event_v1(
    p_event_id uuid,
    p_flow_session_id uuid,
    p_event_ordinal smallint,
    p_onboarding_version text,
    p_app_version text,
    p_event_name text,
    p_consent_version text,
    p_consent_granted_at timestamptz,
    p_occurred_at timestamptz,
    p_retention_expires_at timestamptz,
    p_step_key text default null,
    p_value_code text default null
)
returns setof public.onboarding_events
language sql
security invoker
set search_path = ''
as $function$
    select *
    from onboarding_private.record_onboarding_event_v1_internal(
        p_event_id,
        p_flow_session_id,
        p_event_ordinal,
        p_onboarding_version,
        p_app_version,
        p_event_name,
        p_consent_version,
        p_consent_granted_at,
        p_occurred_at,
        p_retention_expires_at,
        p_step_key,
        p_value_code
    );
$function$;

revoke all on function public.record_onboarding_event_v1(
    uuid, uuid, smallint, text, text, text, text,
    timestamptz, timestamptz, timestamptz, text, text
) from public, anon, authenticated;

grant execute on function public.record_onboarding_event_v1(
    uuid, uuid, smallint, text, text, text, text,
    timestamptz, timestamptz, timestamptz, text, text
) to authenticated;

comment on function public.record_onboarding_event_v1(
    uuid, uuid, smallint, text, text, text, text,
    timestamptz, timestamptz, timestamptz, text, text
) is
'Owner-only idempotent event write. An exact retry returns the stored row; conflicting reuse of either idempotency key is rejected.';
