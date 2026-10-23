//! Local Linux controller-host measurements. Bounded, process-local history.
use serde::Serialize;
use std::{
    collections::VecDeque,
    fs,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Serialize)]
pub struct Sample {
    timestamp: chrono::DateTime<chrono::Utc>,
    cpu_percent: Option<f64>,
    memory_used_bytes: Option<u64>,
    memory_total_bytes: Option<u64>,
    swap_used_bytes: Option<u64>,
    load_one: Option<f64>,
    uptime_seconds: Option<f64>,
    network_rx_bytes_per_second: Option<f64>,
    network_tx_bytes_per_second: Option<f64>,
    disk_read_bytes_per_second: Option<f64>,
    disk_write_bytes_per_second: Option<f64>,
    root_total_bytes: Option<u64>,
    root_available_bytes: Option<u64>,
}
static HISTORY: OnceLock<Mutex<VecDeque<Sample>>> = OnceLock::new();
pub fn snapshot() -> serde_json::Value {
    let samples = HISTORY
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    serde_json::json!({"name":fs::read_to_string("/proc/sys/kernel/hostname").ok().map(|s|s.trim().to_owned()),"scope":"controller-host","samples":*samples})
}
#[derive(Default)]
struct Counters {
    cpu: Option<(u64, u64)>,
    network: Option<(u64, u64)>,
    disk: Option<(u64, u64)>,
}
fn cpu(text: &str) -> Option<(u64, u64)> {
    let values: Vec<u64> = text
        .lines()
        .find(|s| s.starts_with("cpu "))?
        .split_whitespace()
        .skip(1)
        .take(8)
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    if values.len() < 5 {
        return None;
    }
    Some((values.iter().sum(), values[3] + values[4]))
}
fn rate(
    now: Option<(u64, u64)>,
    before: Option<(u64, u64)>,
    elapsed: f64,
) -> (Option<f64>, Option<f64>) {
    match (now, before) {
        (Some(n), Some(b)) if elapsed > 0.0 && n.0 >= b.0 && n.1 >= b.1 => (
            Some((n.0 - b.0) as f64 / elapsed),
            Some((n.1 - b.1) as f64 / elapsed),
        ),
        _ => (None, None),
    }
}
fn collect(previous: &Counters, elapsed: f64) -> (Sample, Counters) {
    let cpu_now = fs::read_to_string("/proc/stat").ok().and_then(|s| cpu(&s));
    let cpu_percent = match (cpu_now, previous.cpu) {
        (Some(n), Some(b)) if n.0 > b.0 && n.1 >= b.1 && n.1 - b.1 <= n.0 - b.0 => {
            Some(100.0 * (1.0 - (n.1 - b.1) as f64 / (n.0 - b.0) as f64))
        }
        _ => None,
    };
    let memory = fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let mem = |key: &str| {
        memory
            .lines()
            .find_map(|line| {
                line.strip_prefix(key)?
                    .split_whitespace()
                    .next()?
                    .parse::<u64>()
                    .ok()
            })
            .map(|n| n * 1024)
    };
    let total = mem("MemTotal:");
    let network = fs::read_to_string("/proc/net/dev").ok().and_then(|s| {
        let values: Option<Vec<(u64, u64)>> = s
            .lines()
            .skip(2)
            .filter_map(|line| {
                let (name, rest) = line.split_once(':')?;
                (name.trim() != "lo").then_some(rest)
            })
            .map(|rest| {
                let v: Vec<_> = rest.split_whitespace().collect();
                Some((v.first()?.parse().ok()?, v.get(8)?.parse().ok()?))
            })
            .collect();
        values.map(|v| v.into_iter().fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1)))
    });
    // Physical block devices only: avoid counting partitions and device-mapper twice.
    let disk = fs::read_dir("/sys/block").ok().and_then(|entries| {
        let values: Option<Vec<(u64, u64)>> = entries
            .filter_map(Result::ok)
            .filter(|e| {
                let n = e.file_name();
                let n = n.to_string_lossy();
                n.starts_with("nvme") || n.starts_with("sd") || n.starts_with("vd")
            })
            .map(|e| {
                let s = fs::read_to_string(e.path().join("stat")).ok()?;
                let v: Vec<_> = s.split_whitespace().collect();
                Some((
                    v.get(2)?.parse::<u64>().ok()? * 512,
                    v.get(6)?.parse::<u64>().ok()? * 512,
                ))
            })
            .collect();
        values
            .filter(|v| !v.is_empty())
            .map(|v| v.into_iter().fold((0, 0), |a, b| (a.0 + b.0, a.1 + b.1)))
    });
    let (rx, tx) = rate(network, previous.network, elapsed);
    let (read, write) = rate(disk, previous.disk, elapsed);
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: constant NUL-terminated path and writable statvfs-sized output.
    let space = if unsafe { libc::statvfs(c"/".as_ptr(), stat.as_mut_ptr()) } == 0 {
        // SAFETY: successful statvfs initialized the output.
        let stat = unsafe { stat.assume_init() };
        Some((stat.f_blocks * stat.f_frsize, stat.f_bavail * stat.f_frsize))
    } else {
        None
    };
    let first = |path: &str| {
        fs::read_to_string(path)
            .ok()?
            .split_whitespace()
            .next()?
            .parse::<f64>()
            .ok()
    };
    (
        Sample {
            timestamp: chrono::Utc::now(),
            cpu_percent,
            memory_total_bytes: total,
            memory_used_bytes: total
                .zip(mem("MemAvailable:"))
                .map(|(t, a)| t.saturating_sub(a)),
            swap_used_bytes: mem("SwapTotal:")
                .zip(mem("SwapFree:"))
                .map(|(t, f)| t.saturating_sub(f)),
            load_one: first("/proc/loadavg"),
            uptime_seconds: first("/proc/uptime"),
            network_rx_bytes_per_second: rx,
            network_tx_bytes_per_second: tx,
            disk_read_bytes_per_second: read,
            disk_write_bytes_per_second: write,
            root_total_bytes: space.map(|s| s.0),
            root_available_bytes: space.map(|s| s.1),
        },
        Counters {
            cpu: cpu_now,
            network,
            disk,
        },
    )
}
pub async fn run() {
    let mut previous = Counters::default();
    let mut last = Instant::now();
    let mut interval = tokio::time::interval(Duration::from_secs(5));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let elapsed = last.elapsed().as_secs_f64();
        last = Instant::now();
        let result = tokio::task::spawn_blocking(move || collect(&previous, elapsed)).await;
        let Ok((sample, counters)) = result else {
            return;
        };
        previous = counters;
        let mut history = HISTORY
            .get_or_init(Default::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        history.push_back(sample);
        while history.len() > 180 {
            history.pop_front();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cpu_excludes_guest_double_counting_and_handles_invalid_input() {
        assert_eq!(
            cpu("cpu  10 2 3 40 5 6 7 8 99 99\ncpu0 1 2"),
            Some((81, 45))
        );
        assert_eq!(cpu("cpu 1 broken"), None);
    }
    #[test]
    fn rates_start_unknown_and_reset_without_spikes() {
        assert_eq!(rate(Some((40, 60)), None, 5.0), (None, None));
        assert_eq!(rate(Some((1, 2)), Some((40, 60)), 5.0), (None, None));
        assert_eq!(
            rate(Some((40, 60)), Some((20, 10)), 5.0),
            (Some(4.0), Some(10.0))
        );
    }
}
