//! Fixed-size, node-owned ext4 volumes. No caller-supplied host paths.
use platform_runtime::RuntimeError;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::Command;
use uuid::Uuid;
fn failed() -> RuntimeError {
    RuntimeError::Rejected("volume_setup_failed")
}
async fn run(program: &str, args: &[&str]) -> Result<(), RuntimeError> {
    let result = tokio::time::timeout(
        Duration::from_secs(60),
        Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .status(),
    )
    .await
    .map_err(|_| failed())?
    .map_err(|_| failed())?;
    if result.success() {
        Ok(())
    } else {
        Err(failed())
    }
}
pub async fn prepare(root: &Path, id: Uuid, size_gib: u16) -> Result<PathBuf, RuntimeError> {
    static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = LOCK.lock().await;
    if !(1..=2).contains(&size_gib) {
        return Err(failed());
    }
    let root = root.join("volumes");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|_| failed())?;
    let image = root.join(format!("{id}.ext4"));
    let mount = root.join(id.to_string());
    let expected = u64::from(size_gib) * 1024 * 1024 * 1024;
    match tokio::fs::metadata(&image).await {
        Ok(metadata) if metadata.len() == expected && metadata.is_file() => {}
        Ok(_) => return Err(RuntimeError::Rejected("volume_size_mismatch")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let temporary = root.join(format!("{id}.new"));
            // Fully allocate backing storage up front; fail before starting PostgreSQL on ENOSPC.
            run(
                "fallocate",
                &[
                    "-l",
                    &expected.to_string(),
                    temporary.to_str().ok_or_else(failed)?,
                ],
            )
            .await?;
            run(
                "mkfs.ext4",
                &["-F", "-q", temporary.to_str().ok_or_else(failed)?],
            )
            .await?;
            tokio::fs::rename(&temporary, &image)
                .await
                .map_err(|_| failed())?;
        }
        Err(_) => return Err(failed()),
    }
    tokio::fs::create_dir_all(&mount)
        .await
        .map_err(|_| failed())?;
    let mounted = Command::new("mountpoint")
        .args(["-q", mount.to_str().ok_or_else(failed)?])
        .status()
        .await
        .map_err(|_| failed())?
        .success();
    if !mounted {
        run(
            "mount",
            &[
                "-o",
                "loop,nodev,nosuid,noexec",
                image.to_str().ok_or_else(failed)?,
                mount.to_str().ok_or_else(failed)?,
            ],
        )
        .await?;
    }
    std::os::unix::fs::chown(&mount, Some(101000), Some(101000)).map_err(|_| failed())?;
    Ok(mount)
}
