export const errors: Record<string, string> = {
  auto_ignore_unsupported:
    'The .dockerignore contains patterns automatic generation cannot safely translate. Provide a Dockerfile for this app.',
  context_exclusion_failed:
    'This diagnostic image was invalidated after a remote-context exclusion issue. Queue a new build with the corrected generator.',
  auto_language_unsupported:
    'No Dockerfile or supported package.json found in the build context. Add a Dockerfile or choose the directory containing your app.',
  auto_provider_unsupported:
    'Automatic detection currently supports public GitHub repositories. Choose Repository Dockerfile only for other hosts.',
  auto_source_unavailable:
    'Could not inspect source metadata. Check repository access and retry; automatic detection does not bypass network or permission failures.',
  auto_package_invalid:
    'package.json or its scripts are invalid. Fix the manifest or supply a Dockerfile.',
  auto_start_missing:
    'Set a Start command in Configuration, add scripts.start to package.json, or provide a Dockerfile with an explicit startup command.',
  auto_lockfile_missing:
    'Commit a package-lock.json, npm-shrinkwrap.json, pnpm-lock.yaml, yarn.lock, bun.lock or bun.lockb for reproducible dependency installation.',
  auto_package_manager_conflict:
    'Lockfiles and packageManager disagree, multiple package managers were detected, or the packageManager version is not exact. Keep one package manager or provide a Dockerfile.',
  auto_runtime_unsupported:
    'The declared runtime version is outside the pinned Node 22/24 or Bun 1.4.4 presets. Provide a Dockerfile for another runtime version.',
  auto_workspace_unsupported:
    'Workspace projects need an explicit Dockerfile for now. Automatic detection supports standalone application packages.',
  uploaded_source_invalid:
    'The uploaded source is missing, corrupt or exceeds archive limits. Upload it again in Configuration.',
  source_ref_not_found: 'The requested branch or tag does not exist in the repository.',
  source_resolution_failed:
    'Could not resolve the source reference. Check repository access and retry.',
  build_failed: 'BuildKit reported a failure. Review the build output below.',
  build_client_failed: 'The build client could not start or read output. Check the builder setup.',
  build_timeout: 'The build exceeded its configured time limit.',
  worker_lease_expired:
    'The worker stopped reporting. Its result cannot become a revision; queue a new build to retry.',
  worker_lease_lost: 'The worker lost its lease. Queue a new build to retry.',
  repository_not_allowed: 'This repository host is not on the builder allowlist.',
  builder_configuration: 'The builder configuration is incomplete or invalid.',
  invalid_image_metadata: 'The builder returned no valid image digest. No revision was created.',
}
