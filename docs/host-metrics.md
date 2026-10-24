# Host history

The Hosts dashboard stores Linux controller-host observations in the platform's
PostgreSQL database every five seconds. It no longer depends on API process memory
or browser state. Restarting the API, PostgreSQL or host preserves committed samples.
The host identity derives from `/etc/machine-id` (hostname fallback); renaming a host
does not discard its history when machine ID is available.

Retention is 30 days, with cleanup at collector startup and approximately hourly.
At five-second sampling this is about 518,400 records per continuously observed host.
Include `host_metric_samples` in control-plane database backups; this is not using
unrelated ClickHouse instances. Existing log archival is unchanged.

`GET /api/hosts?range=15m` supports `15m`, `1h`, `24h`, `7d`, and `30d`. The response
contains at most 361 actual observations: the latest measurement in each time bucket.
These are sampled observations, not bucket averages or peak measurements. Short-lived
spikes and pauses can be hidden in longer ranges; use shorter ranges for detail.

The collector currently runs inside the API. API downtime or database write failures
leave holes in collection, but do not remove earlier samples. No values are invented
for missing intervals. Counter-derived CPU/I/O/network values start unknown after
each collector restart, preventing reset spikes. Separating collection from the API
is a future improvement if continuous measurements during API downtime are needed.
History lost before persistence was added cannot be reconstructed.

Measurements describe the machine running the controller, including all other services
and VMs on that machine. Worker reservations are not measured host usage. Disk rates
sum physical block devices; interface totals can double-count tunnel traffic. ARC and
ZFS health remain outside this dashboard's measurements.
