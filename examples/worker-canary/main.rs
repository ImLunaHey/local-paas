//! Private singleton fixture: no sockets, timers or external side effects.
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
static STOP: AtomicBool = AtomicBool::new(false);
extern "C" fn terminate(_: i32) {
    STOP.store(true, Ordering::Relaxed);
}
unsafe extern "C" {
    fn signal(signal: i32, handler: extern "C" fn(i32)) -> usize;
}
fn main() {
    unsafe {
        signal(15, terminate);
    }
    let start = Instant::now();
    while !STOP.load(Ordering::Relaxed) {
        println!(
            "{{\"level\":\"info\",\"event\":\"worker.tick\",\"elapsed\":{}}}",
            start.elapsed().as_secs()
        );
        std::thread::sleep(Duration::from_secs(1));
    }
    println!("{{\"level\":\"info\",\"event\":\"worker.stopping\"}}");
    std::thread::sleep(Duration::from_secs(8));
    println!("{{\"level\":\"info\",\"event\":\"worker.stopped\"}}");
}
