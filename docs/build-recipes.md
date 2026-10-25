# Generated build recipe maintenance

Generated recipes are a reviewed compatibility contract, not a general buildpack
heuristic. The controller may read bounded manifest metadata, but it never runs
repository code. Installation and build commands execute only through BuildKit in
the isolated builder VM.

## Contract and precedence

`source-recipes-v1` applies this deterministic order:

1. `dockerfile` mode uses the configured repository Dockerfile.
2. `auto` uses that Dockerfile (or BuildKit's lowercase spelling) when present.
3. A build or start override, or `generated` mode, requests recipe detection.
4. Detection succeeds only when exactly one supported root ecosystem manifest and
   all required lockfiles exist. Ambiguous and unsupported roots fail with guidance.

Every plan persists its detector and generator versions, confidence, evidence,
required files, effective commands, port, known unsupported conditions, ignore
policy and exact Dockerfile. Changing emitted instructions or defaults requires a
new generator version. Changing selection or precedence requires a new detector
version. Existing versions remain readable for build history.

## Adding or updating a recipe

- Use digest-pinned, multi-architecture official images that cover x86-64 and
  ARM64. Record the reviewed runtime and package-manager versions in `docs/builds.md`.
- Require the ecosystem's committed lockfile and use its frozen/locked install
  mode. Fail closed for workspaces, conflicting managers and unreviewed native
  dependencies.
- Never infer a framework, dev server, readiness path or network port from source.
  Require a start override when there is no single safe application command.
- JSON-encode operator commands, keep source inspection bounded, and extend the
  mandatory copy exclusions rather than allowing repository ignores to reinclude
  credentials or local dependency trees.
- Add unit fixtures for valid, missing-lockfile, ambiguous, workspace and malicious
  command/path cases. Add an ignored real-builder canary before claiming production
  qualification for a new ecosystem.
- Run the repository checks and an isolated BuildKit canary on both supported
  architectures before promoting a new preset.

Runtime image and package-manager upgrades are policy changes. Review upstream
release notes, refresh digests, rebuild every conformance fixture without cache,
and increment the generator version if output or behavior changes.
