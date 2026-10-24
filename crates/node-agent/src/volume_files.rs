//! Linux fd-relative confinement. Workloads may rename paths while we browse.
use base64::{Engine, engine::general_purpose::STANDARD};
use platform_protocol::{
    FILE_LIMIT, FileAction, FileEntry, FilePoll, FileReply, FileResult, FileTask,
};
use rustix::{
    fd::{AsRawFd, OwnedFd},
    fs::{self, AtFlags, FileType, Mode, OFlags, ResolveFlags},
};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn confined(root: &OwnedFd, path: &str, flags: OFlags) -> Result<OwnedFd, &'static str> {
    fs::openat2(
        root,
        path,
        flags | OFlags::CLOEXEC,
        Mode::empty(),
        ResolveFlags::BENEATH | ResolveFlags::NO_SYMLINKS | ResolveFlags::NO_XDEV,
    )
    .map_err(|_| "path_unavailable")
}
fn valid(path: &str) -> bool {
    path.len() <= 1024
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.chars().any(char::is_control)
        && !path
            .trim_end_matches('/')
            .split('/')
            .any(|s| s == "." || s == ".." || s.is_empty())
}
fn execute(
    root: &OwnedFd,
    task: &FileTask,
    owner: Option<u32>,
) -> Result<FileResult, &'static str> {
    if task.expires_unix_ms < now() {
        return Err("expired");
    }
    if !task.path.is_empty() && !valid(&task.path) {
        return Err("invalid_path");
    }
    let path = if task.path.is_empty() {
        "."
    } else {
        task.path.trim_end_matches('/')
    };
    match &task.action {
        FileAction::List { offset } => {
            if *offset > 10000 {
                return Err("invalid_path");
            }
            let dir = confined(root, path, OFlags::RDONLY | OFlags::DIRECTORY)?;
            let mut items = Vec::new();
            for (count, entry) in fs::Dir::read_from(&dir)
                .map_err(|_| "path_unavailable")?
                .enumerate()
            {
                if count >= 10002 || task.expires_unix_ms < now() {
                    return Err("listing_limit");
                }
                let entry = entry.map_err(|_| "path_unavailable")?;
                let Ok(name) = entry.file_name().to_str() else {
                    continue;
                };
                if name == "." || name == ".." || !valid(name) {
                    continue;
                }
                let Ok(fd) = confined(&dir, name, OFlags::PATH) else {
                    continue;
                };
                let metadata = fs::fstat(&fd).map_err(|_| "path_unavailable")?;
                let kind = match FileType::from_raw_mode(metadata.st_mode) {
                    FileType::RegularFile => "file",
                    FileType::Directory => "directory",
                    _ => continue,
                };
                let prefix = if path == "." {
                    String::new()
                } else {
                    format!("{path}/")
                };
                items.push(FileEntry {
                    path: format!(
                        "{prefix}{name}{}",
                        if kind == "directory" { "/" } else { "" }
                    ),
                    kind: kind.into(),
                    size: if kind == "file" {
                        Some(metadata.st_size as u64)
                    } else {
                        None
                    },
                });
            }
            items.sort_by(|a, b| a.path.cmp(&b.path));
            let cursor = (*offset + 200 < items.len()).then(|| (*offset + 200).to_string());
            Ok(FileResult::Listing {
                items: items.into_iter().skip(*offset).take(200).collect(),
                cursor,
            })
        }
        FileAction::Download => {
            let fd = confined(root, path, OFlags::PATH)?;
            let metadata = fs::fstat(&fd).map_err(|_| "path_unavailable")?;
            if FileType::from_raw_mode(metadata.st_mode) != FileType::RegularFile {
                return Err("not_regular_file");
            }
            if metadata.st_size < 0 || metadata.st_size as u64 > FILE_LIMIT as u64 {
                return Err("file_limit");
            }
            // Reopen the already verified inode, never re-resolve a workload-controlled filename.
            let mut file = File::open(format!("/proc/self/fd/{}", fd.as_raw_fd()))
                .map_err(|_| "path_unavailable")?
                .take(FILE_LIMIT as u64 + 1);
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .map_err(|_| "transfer_failed")?;
            if bytes.len() > FILE_LIMIT {
                return Err("file_limit");
            }
            Ok(FileResult::Download {
                base64: STANDARD.encode(bytes),
            })
        }
        FileAction::Upload { base64 } => {
            if task.read_only {
                return Err("read_only");
            }
            if task.path.is_empty()
                || task.path.ends_with('/')
                || base64.len() > FILE_LIMIT.div_ceil(3) * 4
            {
                return Err("invalid_path");
            }
            let bytes = STANDARD.decode(base64).map_err(|_| "invalid_payload")?;
            if bytes.len() > FILE_LIMIT {
                return Err("file_limit");
            }
            let (parent, name) = path.rsplit_once('/').unwrap_or((".", path));
            let dir = confined(root, parent, OFlags::RDONLY | OFlags::DIRECTORY)?;
            // Unnamed staging inode: crashes leave no partial file or temporary-name litter.
            let fd = fs::openat(
                &dir,
                ".",
                OFlags::TMPFILE | OFlags::WRONLY | OFlags::CLOEXEC,
                Mode::RUSR | Mode::WUSR,
            )
            .map_err(|_| "transfer_failed")?;
            let mut file = File::from(fd);
            file.write_all(&bytes).map_err(|_| "transfer_failed")?;
            if let Some(uid) = owner {
                fs::fchown(
                    &file,
                    Some(rustix::process::Uid::from_raw(uid)),
                    Some(rustix::process::Gid::from_raw(uid)),
                )
                .map_err(|_| "transfer_failed")?;
            }
            file.sync_all().map_err(|_| "transfer_failed")?;
            if task.expires_unix_ms < now() {
                return Err("expired");
            }
            // Resolve only our open staging inode through procfs. Unlike AT_EMPTY_PATH,
            // this works without CAP_DAC_READ_SEARCH on older Linux kernels.
            // The destination remains fd-relative and linkat never replaces it.
            fs::linkat(
                rustix::fs::CWD,
                format!("/proc/self/fd/{}", file.as_raw_fd()),
                &dir,
                name,
                AtFlags::SYMLINK_FOLLOW,
            )
            .map_err(|e| {
                if e == rustix::io::Errno::EXIST {
                    "already_exists"
                } else {
                    "transfer_failed"
                }
            })?;
            fs::fsync(&dir).map_err(|_| "transfer_failed")?;
            Ok(FileResult::Uploaded)
        }
    }
}
fn mounted(root: &Path, task: &FileTask) -> Result<FileResult, &'static str> {
    let parent = fs::open(
        root.join("volumes"),
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| "not_mounted")?;
    let fd = fs::openat2(
        &parent,
        task.volume_id.to_string(),
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
        ResolveFlags::BENEATH | ResolveFlags::NO_SYMLINKS,
    )
    .map_err(|_| "not_mounted")?;
    // Every platform volume is a distinct ext4 loop filesystem, never a host directory.
    if fs::fstat(&parent).map_err(|_| "not_mounted")?.st_dev
        == fs::fstat(&fd).map_err(|_| "not_mounted")?.st_dev
    {
        return Err("not_mounted");
    }
    execute(&fd, task, Some(101000))
}
pub async fn run(config: crate::Config, client: reqwest::Client, root: std::path::PathBuf) {
    loop {
        if let Ok(response) = client
            .post(format!("{}/api/agent/files/poll", config.controller_url))
            .bearer_auth(&config.token)
            .json(&FilePoll {
                node_id: config.node_id,
            })
            .send()
            .await
            && response.status().is_success()
            && response
                .content_length()
                .is_none_or(|n| n <= 24 * 1024 * 1024)
            && let Ok(Some(task)) = response.json::<Option<FileTask>>().await
        {
            let id = task.id;
            let dir = root.clone();
            let result = tokio::task::spawn_blocking(move || mounted(&dir, &task))
                .await
                .unwrap_or(Err("transfer_failed"))
                .unwrap_or_else(|code| FileResult::Failed { code: code.into() });
            let _ = client
                .post(format!("{}/api/agent/files/result", config.controller_url))
                .bearer_auth(&config.token)
                .json(&FileReply {
                    node_id: config.node_id,
                    id,
                    result,
                })
                .send()
                .await;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn task(path: &str, action: FileAction) -> FileTask {
        FileTask {
            id: uuid::Uuid::now_v7(),
            volume_id: uuid::Uuid::now_v7(),
            read_only: false,
            expires_unix_ms: now() + 30000,
            path: path.into(),
            action,
        }
    }
    #[test]
    fn confinement_and_atomic_create_only_uploads() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), "do not read").unwrap();
        std::os::unix::fs::symlink(outside.path(), temp.path().join("escape")).unwrap();
        let root = fs::open(
            temp.path(),
            OFlags::RDONLY | OFlags::DIRECTORY,
            Mode::empty(),
        )
        .unwrap();
        assert!(execute(&root, &task("escape/secret", FileAction::Download), None).is_err());
        assert!(execute(&root, &task("../secret", FileAction::Download), None).is_err());
        let upload = task(
            "test.txt",
            FileAction::Upload {
                base64: STANDARD.encode(b"shared content"),
            },
        );
        let mut readonly = upload.clone();
        readonly.read_only = true;
        assert!(matches!(execute(&root, &readonly, None), Err("read_only")));
        assert!(matches!(
            execute(&root, &upload, None),
            Ok(FileResult::Uploaded)
        ));
        assert!(matches!(
            execute(&root, &upload, None),
            Err("already_exists")
        ));
        assert!(
            matches!(execute(&root,&task("test.txt",FileAction::Download),None),Ok(FileResult::Download{base64}) if STANDARD.decode(&base64).unwrap()==b"shared content")
        );
        let FileResult::Listing { items, .. } =
            execute(&root, &task("", FileAction::List { offset: 0 }), None).unwrap()
        else {
            panic!()
        };
        assert_eq!(items.len(), 1);
        let file = File::create(temp.path().join("oversized")).unwrap();
        file.set_len(FILE_LIMIT as u64 + 1).unwrap();
        assert!(matches!(
            execute(&root, &task("oversized", FileAction::Download), None),
            Err("file_limit")
        ));
        assert!(!valid("folder//name"));
    }
}
