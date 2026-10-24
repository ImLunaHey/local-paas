# Uploaded application sources

Choose **ZIP or local files** in service creation or configuration. One file picker
accepts either a ZIP or multiple files; ZIP preserves nested directory structure.
An existing registered project is required. The ordinary Dockerfile/automatic Node
and Bun detection settings also apply to uploads. celld retains its separate contract.

The Rust API validates ZIPs before persisting a content-addressed archive on management
NVMe (`.local/source-uploads`, or `PLATFORM_SOURCE_DIRECTORY`). The build worker checks
the digest and validates/extracts again into a fresh private directory. Only that
temporary context and generated recipe reach isolated BuildKit. Source never executes
on the controller, and temporary extraction is removed after the build.

Limits: 32 MiB archive, 128 MiB expanded, 16 MiB per file, 10,000 entries, 128:1 maximum
compression ratio, five-second validation deadline, two concurrent validators. Local
file selection packs without compression and accepts 30 MiB total. ZIP64, multi-disk,
encryption, unsupported compression, symlinks/special files, traversal, duplicate or
overlapping entries and file/directory collisions are rejected. Nested archives are
ordinary files, never recursively expanded. Dotenv files, `.git`, `node_modules` and
known credential filenames are rejected; this is not a general secret-content scanner.

Project-scoped digest references prevent using another project's upload without uploading
it into the target project. Archive bytes never enter PostgreSQL or audit/log payloads;
builds and revisions retain the digest. The existing builder log policy still applies
to output deliberately printed by source/Dockerfiles.

Development retention is explicit: 256 MiB compressed per project and 1 GiB total on
disk. Reuploads deduplicate; there is no archive deletion/garbage collector yet. Keep
referenced archives alongside control-plane backups for rebuilds; runtime rollback uses
registry image digests and does not require rebuilding. A failed metadata transaction
can leave a bounded orphan archive, which counts towards the physical quota.
