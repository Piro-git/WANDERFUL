import {randomUUID} from 'node:crypto';

// All weather workers share the app-security database. No transaction remains
// open across a provider request. Database time controls leases and admission.
export class PostgresWeatherStore {
  constructor({pool, maximumEntries=128}={}) {
    if (!pool?.connect || !pool?.query || !Number.isInteger(maximumEntries) || maximumEntries<1) throw new TypeError('weather_store_unavailable');
    this.pool=pool; this.maximumEntries=maximumEntries;
  }
  async claim(key) {
    // Common fresh hits avoid the global admission lock. The write transaction
    // rechecks the same row after this read on every miss.
    const cached=await this.pool.query(`SELECT document,retrieved_at,expires_at,modified,lease_token,lease_until,
      clock_timestamp() AS db_now FROM route_weather_cache WHERE point_key=$1`,[key]);
    const fresh=cached.rows[0];
    if(fresh?.document && new Date(fresh.expires_at).getTime()>new Date(fresh.db_now).getTime())
      return {kind:'hit',value:forecast(fresh)};
    if(fresh?.lease_token && new Date(fresh.lease_until).getTime()>new Date(fresh.db_now).getTime())
      return {kind:'wait'};
    return this.#transaction(async client=>{
      const control=await client.query('SELECT next_admit_at, blocked_until, clock_timestamp() AS db_now FROM route_weather_control WHERE singleton = true FOR UPDATE');
      if(control.rowCount!==1) throw new Error('weather_store_unavailable');
      const time=new Date(control.rows[0].db_now).getTime();
      const found=await client.query('SELECT document, retrieved_at, expires_at, modified, lease_token, lease_until FROM route_weather_cache WHERE point_key=$1 FOR UPDATE',[key]);
      const row=found.rows[0];
      if(row?.document && new Date(row.expires_at).getTime()>time) return {kind:'hit',value:forecast(row)};
      if(row?.lease_token && new Date(row.lease_until).getTime()>time) return {kind:'wait'};
      if(new Date(control.rows[0].blocked_until).getTime()>time || new Date(control.rows[0].next_admit_at).getTime()>time) return {kind:'busy'};
      if(!row) {
        const count=await client.query('SELECT count(*)::integer AS count FROM route_weather_cache');
        if(count.rows[0].count>=this.maximumEntries) {
          await client.query(`DELETE FROM route_weather_cache WHERE point_key IN
            (SELECT point_key FROM route_weather_cache WHERE expires_at <= clock_timestamp()
             AND (lease_until IS NULL OR lease_until <= clock_timestamp())
             ORDER BY expires_at LIMIT 16)`);
          const after=await client.query('SELECT count(*)::integer AS count FROM route_weather_cache');
          if(after.rows[0].count>=this.maximumEntries) return {kind:'busy'};
        }
      }
      const token=randomUUID();
      await client.query("UPDATE route_weather_control SET next_admit_at=clock_timestamp()+interval '600 milliseconds' WHERE singleton=true");
      await client.query(`INSERT INTO route_weather_cache(point_key,lease_token,lease_until)
        VALUES ($1,$2,clock_timestamp()+interval '12 seconds')
        ON CONFLICT(point_key) DO UPDATE SET lease_token=$2, lease_until=clock_timestamp()+interval '12 seconds'`,[key,token]);
      return {kind:'claim',token,old:row?.document?forecast(row):undefined};
    });
  }
  async complete(key,token,result) {
    const updated=await this.pool.query(`UPDATE route_weather_cache SET document=$3::jsonb,
      retrieved_at=$4::timestamptz, expires_at=$5::timestamptz, modified=$6,
      lease_token=NULL, lease_until=NULL
      WHERE point_key=$1 AND lease_token=$2 AND lease_until>clock_timestamp()
        AND $5::timestamptz>clock_timestamp()`, [key,token,JSON.stringify(result.document),result.retrievedAt,result.expiresAt,result.modified??null]);
    if(updated.rowCount!==1) throw new Error('weather_lease_lost');
  }
  async fail(key,token,{throttled=false}={}) {
    await this.#transaction(async client=>{
      // Match claim's control-then-coordinate lock order to avoid deadlocks.
      await client.query(`UPDATE route_weather_control SET blocked_until=GREATEST(blocked_until,
        clock_timestamp()+($1::integer * interval '1 second')) WHERE singleton=true`,[throttled?60:10]);
      await client.query('UPDATE route_weather_cache SET lease_token=NULL,lease_until=NULL WHERE point_key=$1 AND lease_token=$2',[key,token]);
    });
  }
  async #transaction(operation) {
    const client=await this.pool.connect();
    try {await client.query('BEGIN');const value=await operation(client);await client.query('COMMIT');return value;}
    catch(error) {try {await client.query('ROLLBACK');} catch {} throw error;}
    finally {client.release();}
  }
}
function forecast(row) {
  return {document:row.document,retrievedAt:new Date(row.retrieved_at).toISOString(),
    expiresAt:new Date(row.expires_at).toISOString(),modified:row.modified};
}
