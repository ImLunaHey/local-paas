//! Disposable, private fault-injection fixture. Never expose it publicly.
use std::{
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    time::Duration,
};
fn main() -> std::io::Result<()> {
    let mut healthy = true;
    for mut stream in TcpListener::bind("0.0.0.0:3000")?.incoming().flatten() {
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        let mut line = String::new();
        if BufReader::new(&stream).read_line(&mut line).is_err() {
            continue;
        }
        let (status, body) = match line.split_whitespace().nth(1).unwrap_or("") {
            "/crash" => {
                eprintln!("Disposable canary requested process exit");
                std::process::exit(42)
            }
            "/unhealthy" => {
                healthy = false;
                (200, "readiness disabled")
            }
            "/healthy" => {
                healthy = true;
                (200, "readiness enabled")
            }
            "/health" if !healthy => (503, "unhealthy"),
            _ => (200, "healthy"),
        };
        let _ = write!(
            stream,
            "HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
    }
    Ok(())
}
