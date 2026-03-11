# neoping

Cross-platform low-level ICMP ping using native OS APIs via [Koffi](https://koffi.dev/) FFI.

- **Windows**: `IcmpSendEcho2` (Iphlpapi.dll) — no admin required
- **Linux**: `socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)` via libc — unprivileged (kernel 3.0+)

No child_process, no shelling out to `ping` — pure FFI to the kernel ICMP stack.

## Why?

Windows `ping` works but raw socket ICMP implementations fail. This tool exposes why:

- **Windows XP SP2** neutered Winsock raw sockets — the kernel ICMP driver (`icmp.sys`) intercepts replies before your socket sees them
- **Windows Firewall** blocks inbound ICMP Echo Reply by default
- The correct Windows path is `IcmpSendEcho2`, which talks directly to the kernel ICMP driver
- **Linux** has no competing ICMP driver and supports unprivileged ICMP dgram sockets since kernel 3.0

## API

Primary use is as a library. RTT values are in milliseconds (float, sub-ms precision).

```typescript
import { ping, getDiagnostics } from "@bobfrankston/neoping";

// Single target
const result = await ping("8.8.8.8");
console.log(result.stats.avgRtt); // 10.6 (ms)

// Multiple targets in parallel (uses allSettled — one failure won't block others)
const results = await ping(["8.8.8.8", "1.1.1.1", "google.com"]);

// All options (all optional)
const result = await ping("8.8.8.8", {
    count: 4,       // pings per host (default 4)
    timeout: 4000,  // per-ping timeout in ms (default 4000)
    interval: 1000, // interval between pings in ms (default 1000)
    ttl: 128,       // time-to-live (default 128)
    size: 32,       // payload bytes (default 32)
    sudo: false,    // auto-escalate on Linux if DGRAM fails (default false)
    family: 4,      // 4 or 6 (default 4)
});

// Platform diagnostics
const diag = await getDiagnostics();
```

### PingResult

```typescript
{
    host: string;          // original target
    address: string;       // resolved IP (empty on error)
    family: number;        // 4 or 6
    replies: PingReply[];  // individual pings
    stats: {
        sent: number;
        received: number;
        lost: number;
        lossPercent: number;
        minRtt: number;    // ms
        maxRtt: number;    // ms
        avgRtt: number;    // ms
    };
    platform: string;
    method: string;        // backend used
    diagnostics: string[];
}
```

## CLI

```
neoping <host> [host2 ...] [options]

Options:
  -c <n>       Pings per host (default 4)
  -t <ms>      Timeout in ms (default 4000)
  -i <ms>      Interval in ms (default 1000)
  -ttl <n>     TTL (default 128)
  -s <n>       Payload bytes (default 32)
  -sudo        Escalate if unprivileged fails (Linux)
  -json        JSON output
  -diag        Platform diagnostics
```

```
$ node . google.com 8.8.8.8 1.1.1.1 -c 3
Host        Address         Min(ms)  Avg(ms)  Max(ms)  Loss
----------  --------------  -------  -------  -------  ----
google.com  142.250.217.14     10.0     11.1     12.3    0%
            8.8.8.8             9.5     10.2     10.8    0%
            1.1.1.1             2.6      3.1      3.5    0%
```

## Caveat

This is a personal project provided as-is with no official support. Unlike most npm ping packages, it uses native OS ICMP APIs and does not shell out to the `ping` command. Use at your own risk.

## Requirements

- Node.js 24+
- [koffi](https://koffi.dev/) (native FFI, installed automatically)
