fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = args.first().map(String::as_str).unwrap_or("success");
    println!("{{\"event\":\"job.start\",\"mode\":\"{mode}\"}}");
    if mode == "sleep" {
        let seconds = args
            .get(1)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(30);
        for _ in 0..seconds {
            std::thread::sleep(std::time::Duration::from_secs(1));
            println!("{{\"event\":\"job.tick\"}}");
        }
    }
    if mode == "fail" {
        eprintln!("{{\"event\":\"job.failure\",\"level\":\"error\"}}");
        std::process::exit(7);
    }
    println!("{{\"event\":\"job.done\"}}");
}
