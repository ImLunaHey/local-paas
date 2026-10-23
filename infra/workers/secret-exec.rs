// Static, dependency-free workload launcher: secrets never enter OCI config/env.
use std::{os::unix::process::CommandExt, process::Command};
fn main() {
    if run().is_err() {
        eprintln!("platform: unable to initialize workload environment");
        std::process::exit(126);
    }
}
fn run() -> Result<(), ()> {
    let mut bytes = std::fs::read("/.platform-secrets/.environment").map_err(|_| ())?;
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let program = args.first().ok_or(())?;
    let mut command = Command::new(program);
    command.args(&args[1..]);
    for item in bytes.split(|b| *b == 0).filter(|b| !b.is_empty()) {
        let text = std::str::from_utf8(item).map_err(|_| ())?;
        let (name, value) = text.split_once('=').ok_or(())?;
        if name.is_empty() || !name.bytes().all(|b| b == b'_' || b.is_ascii_alphanumeric()) {
            return Err(());
        }
        command.env(name, value);
    }
    // The buffer is no longer needed; the exec environment remains in process memory.
    bytes.fill(0);
    command.env("PLATFORM_SECRET_DIR", "/.platform-secrets");
    let _ = command.exec();
    Err(())
}
