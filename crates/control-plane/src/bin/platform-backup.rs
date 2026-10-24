#[tokio::main]
async fn main() {
    if let Err(message) = control_plane::backups::cli().await {
        eprintln!("{message}");
        std::process::exit(1);
    }
}
