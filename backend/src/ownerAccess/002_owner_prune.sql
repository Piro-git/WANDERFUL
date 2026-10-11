-- Operator job only. Select at most 1000 expired sessions/challenges/leases/windows
-- per category. Replay-row deletion is bounded by those selected sessions.
-- Never delete active counters, owners, keys or unexpired authorization state.
BEGIN;
SELECT pg_advisory_xact_lock(78261642489301::bigint);
WITH expired AS (SELECT challenge_id FROM wanderful_owner_v1.challenges
  WHERE expires_at<clock_timestamp()-interval '1 day' ORDER BY expires_at LIMIT 1000)
DELETE FROM wanderful_owner_v1.challenges WHERE challenge_id IN (SELECT challenge_id FROM expired);
WITH expired AS (SELECT token_hash FROM wanderful_owner_v1.sessions
  WHERE expires_at<clock_timestamp()-interval '1 day' ORDER BY expires_at LIMIT 1000)
DELETE FROM wanderful_owner_v1.requests WHERE token_hash IN (SELECT token_hash FROM expired);
WITH expired AS (SELECT lease_id FROM wanderful_owner_v1.leases
  WHERE expires_at<clock_timestamp()-interval '1 day' ORDER BY expires_at LIMIT 1000)
DELETE FROM wanderful_owner_v1.leases WHERE lease_id IN (SELECT lease_id FROM expired);
WITH expired AS (SELECT token_hash FROM wanderful_owner_v1.sessions s
  WHERE expires_at<clock_timestamp()-interval '1 day'
  AND NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.requests r WHERE r.token_hash=s.token_hash)
  AND NOT EXISTS(SELECT 1 FROM wanderful_owner_v1.leases l WHERE l.token_hash=s.token_hash)
  ORDER BY expires_at LIMIT 1000)
DELETE FROM wanderful_owner_v1.sessions WHERE token_hash IN (SELECT token_hash FROM expired);
WITH expired AS (SELECT scope,identity_hash FROM wanderful_owner_v1.windows
  WHERE reset_at<clock_timestamp()-interval '7 days' ORDER BY reset_at LIMIT 1000)
DELETE FROM wanderful_owner_v1.windows w USING expired e WHERE w.scope=e.scope AND w.identity_hash=e.identity_hash;
COMMIT;
