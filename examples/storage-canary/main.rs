//! Disposable shared-storage qualification service, not an application template.
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    time::Duration,
};
fn serve(mut socket: TcpStream) -> std::io::Result<()> {
    socket.set_read_timeout(Some(Duration::from_secs(2)))?;
    socket.set_write_timeout(Some(Duration::from_secs(2)))?;
    let mut reader = BufReader::new((&socket).take(8192));
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let request = line.trim().to_owned();
    let mut length = 0usize;
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 || line == "\r\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().unwrap_or(8193);
            }
        }
    }
    let parts: Vec<_> = request.split_whitespace().collect();
    let (method, path) = (
        parts.first().copied().unwrap_or(""),
        parts.get(1).copied().unwrap_or(""),
    );
    let (status, body) = if length > 4096 {
        (413, b"too large".to_vec())
    } else if method == "GET" && path == "/health" {
        (200, b"healthy".to_vec())
    } else if let Some(name) = path.strip_prefix("/files/").filter(|name| {
        !name.is_empty()
            && !name.contains("..")
            && name
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
    }) {
        let file = format!("/data/{name}");
        if method == "PUT" {
            let mut bytes = vec![0; length];
            reader.read_exact(&mut bytes)?;
            match std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(file)
                .and_then(|mut f| {
                    f.write_all(&bytes)?;
                    f.sync_all()
                }) {
                Ok(()) => (201, b"created".to_vec()),
                Err(_) => (403, b"write denied".to_vec()),
            }
        } else if method == "GET" {
            match std::fs::File::open(file).and_then(|f| {
                let mut b = Vec::new();
                f.take(4096).read_to_end(&mut b)?;
                Ok(b)
            }) {
                Ok(b) => (200, b),
                Err(_) => (404, b"missing".to_vec()),
            }
        } else {
            (405, b"method".to_vec())
        }
    } else {
        (404, b"missing".to_vec())
    };
    drop(reader);
    write!(
        socket,
        "HTTP/1.1 {status} Response\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    socket.write_all(&body)?;
    Ok(())
}
fn main() -> std::io::Result<()> {
    for socket in TcpListener::bind("0.0.0.0:3000")?.incoming().flatten() {
        let _ = serve(socket);
    }
    Ok(())
}
