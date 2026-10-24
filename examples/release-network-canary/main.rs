use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    time::Duration,
};
fn fetch(url: &str) -> Result<String, String> {
    let address = url
        .strip_prefix("http://")
        .ok_or("invalid URL")?
        .trim_end_matches('/');
    let socket = address
        .to_socket_addrs()
        .map_err(|_| "DNS failed")?
        .next()
        .ok_or("no address")?;
    let mut stream = TcpStream::connect_timeout(&socket, Duration::from_secs(3))
        .map_err(|_| "connect failed")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    write!(
        stream,
        "GET / HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
    )
    .map_err(|_| "write failed")?;
    let mut response = String::new();
    stream
        .take(65536)
        .read_to_string(&mut response)
        .map_err(|_| "read failed")?;
    if !response.starts_with("HTTP/1.1 200") {
        return Err("dependency unavailable".into());
    }
    Ok(response
        .split_once("\r\n\r\n")
        .ok_or("invalid response")?
        .1
        .into())
}
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        println!(
            "{{\"event\":\"migration.start\",\"label\":\"{}\"}}",
            env!("CANARY_LABEL")
        );
        match args[1].as_str() {
            "fail" => std::process::exit(7),
            "sleep" => std::thread::sleep(Duration::from_secs(30)),
            "fetch" => match fetch(&std::env::var("API_URL").unwrap()) {
                Ok(body) => println!("dependency: {body}"),
                Err(error) => {
                    eprintln!("{error}");
                    std::process::exit(9);
                }
            },
            "blocked" => {
                let socket = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
                socket.connect("8.8.8.8:53").unwrap();
                let std::net::IpAddr::V4(ip) = socket.local_addr().unwrap().ip() else {
                    panic!("IPv4 expected")
                };
                let mut octets = ip.octets();
                octets[3] = 1;
                let url = format!("http://{}:24000", std::net::Ipv4Addr::from(octets));
                if fetch(&url).is_ok() {
                    std::process::exit(8);
                }
                println!("unauthorized route blocked");
            }
            _ => {}
        }
        println!("{{\"event\":\"migration.done\"}}");
        return;
    }
    for mut stream in TcpListener::bind("0.0.0.0:3000")
        .unwrap()
        .incoming()
        .flatten()
    {
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut input = [0u8; 2048];
        let len = stream.read(&mut input).unwrap_or(0);
        let request = String::from_utf8_lossy(&input[..len]);
        let (status, body) = if request.starts_with("GET /dependency ") {
            match std::env::var("API_URL")
                .ok()
                .and_then(|url| fetch(&url).ok())
            {
                Some(body) => ("200 OK", body),
                None => ("502 Bad Gateway", "dependency unavailable".into()),
            }
        } else {
            ("200 OK", format!("{}\n", env!("CANARY_LABEL")))
        };
        let _ = write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
    }
}
