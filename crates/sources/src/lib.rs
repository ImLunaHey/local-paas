//! Bounded, non-executing source ZIP validation and extraction into fresh private directories.
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    io::{Cursor, Read, Write},
    path::Path,
    time::{Duration, Instant},
};
pub const ARCHIVE_LIMIT: usize = 32 * 1024 * 1024;
pub const EXPANDED_LIMIT: u64 = 128 * 1024 * 1024;
pub const FILE_LIMIT: u64 = 16 * 1024 * 1024;
pub const ENTRY_LIMIT: usize = 10000;
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct Error(pub &'static str);
pub struct Summary {
    pub digest: String,
    pub files: usize,
    pub expanded: u64,
}
pub fn digest_valid(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn root() -> std::path::PathBuf {
    std::env::var_os("PLATFORM_SOURCE_DIRECTORY")
        .map(Into::into)
        .unwrap_or_else(|| ".local/source-uploads".into())
}
pub fn path(digest: &str) -> Result<std::path::PathBuf, Error> {
    if !digest_valid(digest) {
        return Err(Error("invalid source digest"));
    }
    Ok(root().join(format!("{digest}.zip")))
}
fn u16_at(b: &[u8], i: usize) -> usize {
    u16::from_le_bytes([b[i], b[i + 1]]) as usize
}
fn u32_at(b: &[u8], i: usize) -> usize {
    u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize
}
fn preflight(bytes: &[u8]) -> Result<(usize, usize), Error> {
    if bytes.len() > ARCHIVE_LIMIT || bytes.len() < 22 {
        return Err(Error("ZIP must be between 22 bytes and 32 MiB"));
    }
    let start = bytes.len().saturating_sub(65557);
    let end = (start..=bytes.len() - 22)
        .rev()
        .find(|&i| {
            bytes[i..i + 4] == *b"PK\x05\x06" && i + 22 + u16_at(bytes, i + 20) == bytes.len()
        })
        .ok_or(Error("invalid ZIP end record"))?;
    let count = u16_at(bytes, end + 10);
    let size = u32_at(bytes, end + 12);
    let offset = u32_at(bytes, end + 16);
    if u16_at(bytes, end + 4) != 0
        || u16_at(bytes, end + 6) != 0
        || u16_at(bytes, end + 8) != count
        || count == 0
        || count > ENTRY_LIMIT
        || size > 4 * 1024 * 1024
        || offset.checked_add(size) != Some(end)
    {
        return Err(Error(
            "ZIP64, multi-disk, empty or oversized ZIP directories are unsupported",
        ));
    }
    let mut p = offset;
    for _ in 0..count {
        if p + 46 > end || bytes[p..p + 4] != *b"PK\x01\x02" {
            return Err(Error("invalid ZIP directory"));
        }
        p = p
            .checked_add(46 + u16_at(bytes, p + 28) + u16_at(bytes, p + 30) + u16_at(bytes, p + 32))
            .ok_or(Error("invalid ZIP directory"))?;
        if p > end {
            return Err(Error("invalid ZIP directory"));
        }
    }
    if p != end {
        return Err(Error("ZIP entry count mismatch"));
    }
    Ok((count, offset))
}
fn safe_name(name: &str) -> Result<&str, Error> {
    let p = name.trim_end_matches('/');
    if p.is_empty()
        || p.len() > 1024
        || p.starts_with('/')
        || p.contains(['\\', ':'])
        || p.chars().any(char::is_control)
        || p.split('/')
            .any(|c| c.is_empty() || c == "." || c == ".." || c.len() > 255)
    {
        return Err(Error("ZIP contains an unsafe path"));
    }
    if p.split('/').any(|c| {
        c == ".git"
            || c == "node_modules"
            || c == ".env"
            || c.starts_with(".env.")
            || c == ".npmrc"
            || c == ".pypirc"
            || c == "id_rsa"
            || c == "id_ed25519"
    }) {
        return Err(Error(
            "remove dotenv files, credentials, .git and node_modules before uploading",
        ));
    }
    Ok(p)
}
pub fn inspect(bytes: &[u8], destination: Option<&Path>) -> Result<Summary, Error> {
    let began = Instant::now();
    let (declared, directory_start) = preflight(bytes)?;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| Error("invalid ZIP archive"))?;
    if archive.len() != declared
        || archive
            .has_overlapping_files()
            .map_err(|_| Error("invalid ZIP entries"))?
    {
        return Err(Error("duplicate or overlapping ZIP entries are forbidden"));
    }
    let mut ranges = Vec::new();
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|_| Error("invalid ZIP entry"))?;
        let start = entry.header_start();
        let end = entry
            .data_start()
            .ok_or(Error("invalid ZIP header"))?
            .checked_add(entry.compressed_size())
            .ok_or(Error("invalid ZIP data"))?;
        if end > directory_start as u64 || end <= start {
            return Err(Error("invalid ZIP entry bounds"));
        }
        ranges.push((start, end));
    }
    ranges.sort_unstable();
    if ranges.windows(2).any(|w| w[0].1 > w[1].0) {
        return Err(Error("overlapping ZIP headers or data"));
    }
    let mut names = HashSet::new();
    let mut file_names = HashSet::new();
    let mut directories = HashSet::new();
    let mut expanded = 0u64;
    let mut files = 0;
    for i in 0..archive.len() {
        if began.elapsed() > Duration::from_secs(5) {
            return Err(Error("ZIP inspection exceeded five seconds"));
        }
        let mut entry = archive
            .by_index(i)
            .map_err(|_| Error("encrypted or invalid ZIP entry"))?;
        let name = entry
            .name()
            .map_err(|_| Error("invalid ZIP filename encoding"))?
            .into_owned();
        let name = safe_name(&name)?.to_string();
        if !names.insert(name.clone()) {
            return Err(Error("duplicate ZIP paths are forbidden"));
        }
        for parent in Path::new(&name).ancestors().skip(1) {
            let parent = parent.to_string_lossy().to_string();
            if file_names.contains(&parent) {
                return Err(Error("ZIP file/directory collision"));
            }
            directories.insert(parent);
        }
        if !entry.is_dir() {
            if directories.contains(&name) {
                return Err(Error("ZIP file/directory collision"));
            }
            file_names.insert(name.clone());
        } else {
            directories.insert(name.clone());
        }
        let mode = entry.unix_mode().unwrap_or(0);
        let file_type = mode & 0o170000;
        if entry.encrypted() || entry.is_symlink() || ![0, 0o040000, 0o100000].contains(&file_type)
        {
            return Err(Error(
                "encrypted entries, symlinks and special files are forbidden",
            ));
        }
        if entry.size() > FILE_LIMIT
            || entry.size() > entry.compressed_size().max(1).saturating_mul(128)
        {
            return Err(Error("ZIP entry exceeds size or compression ratio limits"));
        }
        if !matches!(
            entry.compression(),
            zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated
        ) {
            return Err(Error("ZIP supports stored and deflate compression only"));
        }
        if entry.is_dir() {
            if entry.size() != 0 {
                return Err(Error("directory entries must be empty"));
            }
            if let Some(root) = destination {
                std::fs::create_dir_all(root.join(&name))
                    .map_err(|_| Error("invalid file/directory collision or source disk full"))?;
            }
            continue;
        }
        files += 1;
        let mut output = if let Some(root) = destination {
            let path = root.join(&name);
            std::fs::create_dir_all(path.parent().ok_or(Error("invalid path"))?)
                .map_err(|_| Error("source directory unavailable"))?;
            let f = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|_| {
                    Error("duplicate path, file/directory collision or source disk full")
                })?;
            use std::os::unix::fs::PermissionsExt;
            f.set_permissions(std::fs::Permissions::from_mode(if mode & 0o111 != 0 {
                0o755
            } else {
                0o644
            }))
            .map_err(|_| Error("source permissions failed"))?;
            Some(f)
        } else {
            None
        };
        let mut actual = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let n = entry
                .read(&mut buffer)
                .map_err(|_| Error("ZIP decompression or checksum failed"))?;
            if n == 0 {
                break;
            }
            actual += n as u64;
            expanded += n as u64;
            if actual > FILE_LIMIT
                || expanded > EXPANDED_LIMIT
                || actual > entry.compressed_size().max(1).saturating_mul(128)
                || expanded > (bytes.len() as u64).saturating_mul(128)
                || began.elapsed() > Duration::from_secs(5)
            {
                return Err(Error(
                    "ZIP exceeds expanded size, compression ratio or time limits",
                ));
            }
            if let Some(out) = &mut output {
                out.write_all(&buffer[..n])
                    .map_err(|_| Error("source disk full or unavailable"))?;
            }
        }
        if actual != entry.size() {
            return Err(Error("ZIP entry size mismatch"));
        }
    }
    if files == 0 {
        return Err(Error("ZIP contains no source files"));
    }
    Ok(Summary {
        digest: format!("{:x}", Sha256::digest(bytes)),
        files,
        expanded,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            z.start_file(
                *name,
                zip::write::SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
            z.write_all(data).unwrap();
        }
        z.finish().unwrap().into_inner()
    }
    #[test]
    fn rejects_bombs_traversal_and_secrets() {
        for name in [
            "../escape",
            "/absolute",
            "C:/drive",
            "folder/../../escape",
            ".env",
            "a/.git/config",
            "a/node_modules/pkg/index.js",
        ] {
            assert!(inspect(&zip(&[(name, b"x")]), None).is_err(), "{name}");
        }
        assert!(inspect(&zip(&[("bomb", &vec![0; 2 * 1024 * 1024])]), None).is_err());
        let mut bad = zip(&[("safe", b"hello")]);
        let len = bad.len();
        bad[len - 12..len - 10].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(inspect(&bad, None).is_err());
        assert!(inspect(&zip(&[("path", b"a"), ("path/child", b"b")]), None).is_err());
        assert!(inspect(&zip(&[("path/child", b"a"), ("path", b"b")]), None).is_err());
        let mut links = zip::ZipWriter::new(Cursor::new(Vec::new()));
        links
            .add_symlink(
                "escape",
                "/etc/passwd",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
        assert!(inspect(&links.finish().unwrap().into_inner(), None).is_err());
        let mut corrupt = zip(&[("safe", b"checksum test")]);
        corrupt[34] ^= 255;
        assert!(inspect(&corrupt, None).is_err());
    }
    #[test]
    fn extracts_only_regular_source_files() {
        let bytes = zip(&[
            ("Dockerfile", b"FROM scratch\n"),
            ("src/main.rs", b"fn main() {}"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        let s = inspect(&bytes, Some(dir.path())).unwrap();
        assert_eq!(s.files, 2);
        assert!(digest_valid(&s.digest));
        assert_eq!(
            std::fs::read(dir.path().join("src/main.rs")).unwrap(),
            b"fn main() {}"
        );
    }
}
