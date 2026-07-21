local staging_schema = os.getenv('TRAILMIND_IMPORT_SCHEMA')
if staging_schema == nil or string.match(staging_schema, '^outdoor_import_[a-f0-9_]+$') == nil then
    error('TRAILMIND_IMPORT_SCHEMA is missing or invalid')
end

local function text_column(name)
    return { column = name, type = 'text' }
end

local poi_columns = {
    text_column('source_type'),
    { column = 'source_version', type = 'int' },
    { column = 'source_timestamp', type = 'timestamptz' },
    text_column('category'),
    text_column('name'),
    text_column('ref'),
    text_column('tourism'),
    text_column('natural'),
    text_column('water'),
    text_column('waterway'),
    { column = 'geom', type = 'geometry', projection = 4326 }
}

local pois = osm2pgsql.define_table({
    name = 'raw_pois',
    schema = staging_schema,
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_kind' },
    columns = poi_columns
})

local trails = osm2pgsql.define_table({
    name = 'raw_trails',
    schema = staging_schema,
    ids = { type = 'way', id_column = 'osm_id' },
    columns = {
        { column = 'source_version', type = 'int' },
        { column = 'source_timestamp', type = 'timestamptz' },
        text_column('highway'),
        text_column('surface'),
        text_column('trail_visibility'),
        text_column('sac_scale'),
        text_column('access_tag'),
        text_column('foot_tag'),
        text_column('access_conditional'),
        text_column('foot_conditional'),
        text_column('seasonal_tag'),
        text_column('permit_tag'),
        { column = 'geom', type = 'linestring', projection = 4326 }
    }
})

local hiking_relations = osm2pgsql.define_table({
    name = 'raw_hiking_relations',
    schema = staging_schema,
    ids = { type = 'relation', id_column = 'osm_id' },
    columns = {
        { column = 'source_version', type = 'int' },
        { column = 'source_timestamp', type = 'timestamptz' },
        text_column('route_type'),
        text_column('network'),
        text_column('name'),
        text_column('ref'),
        text_column('operator'),
        text_column('symbol'),
        text_column('osmc_symbol'),
        text_column('state')
    }
})

local relation_members = osm2pgsql.define_table({
    name = 'raw_hiking_relation_members',
    schema = staging_schema,
    ids = { type = 'relation', id_column = 'relation_osm_id' },
    columns = {
        { column = 'segment_osm_id', type = 'int8' },
        text_column('member_role'),
        { column = 'member_sequence', type = 'int' }
    }
})

local lifecycle_prefixes = {
    'proposed:', 'planned:', 'construction:', 'disused:', 'abandoned:',
    'demolished:', 'destroyed:', 'removed:', 'razed:'
}

local non_current_values = {
    proposed = true,
    planned = true,
    construction = true,
    disused = true,
    abandoned = true
}

local function non_current(tags)
    for key, _ in pairs(tags) do
        for _, prefix in ipairs(lifecycle_prefixes) do
            if string.sub(key, 1, string.len(prefix)) == prefix then return true end
        end
    end
    if tags.disused == 'yes' or tags.disused == 'true' or tags.disused == '1' or
        tags.abandoned == 'yes' or tags.abandoned == 'true' or tags.abandoned == '1' or
        tags.proposed == 'yes' or tags.proposed == 'true' or tags.proposed == '1' then
        return true
    end
    return non_current_values[tags.highway] == true or
        non_current_values[tags.route] == true or
        non_current_values[tags.tourism] == true or
        non_current_values[tags.natural] == true or
        non_current_values[tags.waterway] == true or
        non_current_values[tags.state] == true
end

local function poi_category(tags)
    if non_current(tags) then return nil end
    if tags.tourism == 'viewpoint' then return 'viewpoint' end
    if tags.natural == 'peak' then return 'peak' end
    if tags.natural == 'water' and tags.water == 'lake' then return 'lake' end
    if tags.waterway == 'waterfall' then return 'waterfall' end
    if tags.tourism == 'alpine_hut' then return 'alpineHut' end
    if tags.tourism == 'wilderness_hut' then return 'wildernessHut' end
    return nil
end

local function metadata(object, source_type)
    return {
        source_type = source_type,
        source_version = object.version,
        source_timestamp = object.timestamp,
        name = object.tags.name,
        ref = object.tags.ref
    }
end

local function insert_poi(object, source_type, geometry)
    local category = poi_category(object.tags)
    if category == nil then return end
    local row = metadata(object, source_type)
    row.category = category
    row.tourism = object.tags.tourism
    row.natural = object.tags.natural
    row.water = object.tags.water
    row.waterway = object.tags.waterway
    row.geom = geometry
    pois:insert(row)
end

function osm2pgsql.process_node(object)
    insert_poi(object, 'node', object:as_point())
end

function osm2pgsql.process_way(object)
    if object.tags.highway ~= nil and not non_current(object.tags) then
        trails:insert({
            source_version = object.version,
            source_timestamp = object.timestamp,
            highway = object.tags.highway,
            surface = object.tags.surface,
            trail_visibility = object.tags.trail_visibility,
            sac_scale = object.tags.sac_scale,
            access_tag = object.tags.access,
            foot_tag = object.tags.foot,
            access_conditional = object.tags['access:conditional'],
            foot_conditional = object.tags['foot:conditional'],
            seasonal_tag = object.tags.seasonal,
            permit_tag = object.tags.permit,
            geom = object:as_linestring()
        })
    end
    if object.is_closed then
        insert_poi(object, 'way', object:as_polygon())
    end
end

function osm2pgsql.process_relation(object)
    local category = poi_category(object.tags)
    if category ~= nil and object.tags.type == 'multipolygon' then
        insert_poi(object, 'relation', object:as_multipolygon())
    end
    if non_current(object.tags) or object.tags.type ~= 'route' or
        (object.tags.route ~= 'hiking' and object.tags.route ~= 'foot') then return end

    local state = object.tags.state
    if state ~= 'alternate' and state ~= 'temporary' and state ~= 'connection' then state = 'current' end
    hiking_relations:insert({
        source_version = object.version,
        source_timestamp = object.timestamp,
        route_type = object.tags.route,
        network = object.tags.network,
        name = object.tags.name,
        ref = object.tags.ref,
        operator = object.tags.operator,
        symbol = object.tags.symbol,
        osmc_symbol = object.tags['osmc:symbol'],
        state = state
    })
    for sequence, member in ipairs(object.members) do
        if member.type == 'w' then
            relation_members:insert({
                segment_osm_id = member.ref,
                member_role = member.role or '',
                member_sequence = sequence - 1
            })
        end
    end
end
