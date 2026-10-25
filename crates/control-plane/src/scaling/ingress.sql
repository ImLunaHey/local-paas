WITH routes AS (
    SELECT authority, service_id, NULL::uuid AS deployment_id,
           NULL::bigint AS generation, NULL::timestamptz AS expires
    FROM preview_routes
    UNION ALL
    SELECT t.authority, d.service_id, d.id, t.generation,
           least(t.expires_at, clock_timestamp() + interval '10 seconds')
    FROM edge_targets t
    JOIN deployments d ON d.id = t.deployment_id AND d.status = 'active'
    WHERE t.expires_at > clock_timestamp()
), pages AS (
    SELECT r.*, s.spec->>'name' AS service_name,
           coalesce((p.policy->>'enabled')::boolean
                    AND (p.policy->>'minReplicas')::integer = 0, false) AS enabled,
           p.failure_latched, w.html
    FROM routes r
    JOIN services s ON s.id = r.service_id
    LEFT JOIN scaling_policies p ON p.service_id = r.service_id
    LEFT JOIN service_waking_pages w ON w.service_id = r.service_id
)
SELECT authority, service_id, service_name, enabled, expires,
       CASE WHEN enabled THEN html END AS html,
       CASE WHEN enabled AND NOT failure_latched AND NOT EXISTS (
           SELECT 1 FROM instances i
           WHERE i.deployment_id = pages.deployment_id
             AND i.desired_state = 'running' AND i.routing_enabled
       ) THEN generation END AS sleeping_generation
FROM pages
