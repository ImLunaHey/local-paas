SELECT jsonb_build_object(
    'hostname', d.hostname,
    'serviceId', d.service_id,
    'version', d.version,
    'createdAt', d.created_at,
    'updatedAt', d.updated_at,
    'project', p.name,
    'projectId', p.id,
    'environment', e.name,
    'service', s.name,
    'generation', d.edge_generation,
    'acknowledgedGeneration', d.acknowledged_generation,
    'desiredDeployment', d.edge_deployment,
    'acknowledgedDeployment', d.acknowledged_deployment,
    'verifiedAt', d.verified_at,
    'leaseExpiresAt', d.edge_lease_expires_at,
    'certificateExpiresAt', d.certificate_expires_at,
    'errorCode', d.edge_error,
    'ownershipRecord', jsonb_build_object(
        'name', '_local-paas.' || d.hostname,
        'value', 'local-paas=' || d.ownership_token::text
    ),
    'status', CASE
        WHEN d.edge_generation = 0 THEN
            CASE WHEN d.service_id IS NULL THEN 'unassigned' ELSE 'waiting-deployment' END
        WHEN d.edge_error IS NOT NULL THEN d.edge_error
        WHEN d.acknowledged_generation IS DISTINCT FROM d.edge_generation THEN
            CASE WHEN d.edge_deployment IS NULL THEN 'removing' ELSE 'pending-edge' END
        WHEN d.edge_deployment IS NULL THEN
            CASE WHEN d.service_id IS NULL THEN 'removed' ELSE 'waiting-deployment' END
        WHEN d.edge_lease_expires_at <= clock_timestamp() THEN 'lease-expired'
        WHEN d.certificate_expires_at <= clock_timestamp() THEN 'certificate-expired'
        WHEN d.certificate_expires_at < clock_timestamp() + interval '7 days' THEN 'certificate-expiring'
        ELSE 'active'
    END
)
FROM domains d
LEFT JOIN services s ON s.id = d.service_id
LEFT JOIN environments e ON e.id = s.environment_id
LEFT JOIN projects p ON p.id = e.project_id
WHERE ($1::text IS NULL OR d.organization_id = $1)
ORDER BY d.hostname
