/**
 * neoping — Cross-platform low-level ICMP ping API.
 *
 * Uses platform-native APIs via Koffi FFI:
 *   Windows: IcmpSendEcho2 (Iphlpapi.dll) — no admin required
 *   Linux:   socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP) — unprivileged
 *
 * API usage:
 *   import { ping } from "@bobfrankston/neoping";
 *
 *   const result = await ping("8.8.8.8");
 *   const results = await ping(["8.8.8.8", "1.1.1.1", "google.com"]);
 */

import * as dns from "node:dns/promises";
import * as net from "node:net";
import * as os from "node:os";
import type { PingOptions, PingResult, PingReply, IcmpBackend } from "./icmp-types.js";

export type { PingOptions, PingResult, PingReply };

const DEFAULT_OPTIONS: Required<PingOptions> = {
    count: 4,
    timeout: 4000,
    interval: 1000,
    ttl: 128,
    size: 32,
    sudo: false,
    family: 4,
    rdns: false,
    trace: false,
    diagnostics: false,
};

let backend: IcmpBackend;

/** Write trace message to stderr */
function trace(enabled: boolean, ...args: any[]) {
    if (enabled) process.stderr.write(`[trace] ${args.join(" ")}\n`);
}

/** Resolve hostname to IP address */
async function resolveAddress(host: string, family: 4 | 6, traceEnabled: boolean) {
    // Already an IP? net.isIP returns 4 for IPv4, 6 for IPv6, 0 for invalid
    const ipVersion = net.isIP(host);
    trace(traceEnabled, `resolveAddress("${host}", family=${family}) net.isIP=${ipVersion}`);
    if (ipVersion > 0) {
        trace(traceEnabled, `  → already an IPv${ipVersion} address, skipping DNS`);
        return { address: host, family: ipVersion };
    }

    try {
        trace(traceEnabled, `  → dns.lookup("${host}", { family: ${family} })`);
        const result = await dns.lookup(host, { family });
        trace(traceEnabled, `  → resolved to ${result.address} (family=${result.family})`);
        return { address: result.address, family: result.family };
    } catch (e: any) {
        trace(traceEnabled, `  → dns.lookup failed: ${e.message}`);
        // Try the other family
        try {
            trace(traceEnabled, `  → retrying dns.lookup("${host}") without family constraint`);
            const result = await dns.lookup(host);
            trace(traceEnabled, `  → resolved to ${result.address} (family=${result.family})`);
            return { address: result.address, family: result.family };
        } catch (e2: any) {
            trace(traceEnabled, `  → dns.lookup fallback also failed: ${e2.message}`);
            return null;
        }
    }
}

/** Initialize the appropriate backend for this platform */
async function ensureBackend() {
    if (backend) return backend;

    const platform = os.platform();

    if (platform === "win32") {
        const { Win32IcmpBackend } = await import("./backend-win32.js");
        const win = new Win32IcmpBackend();
        if (await win.available()) {
            backend = win;
            return backend;
        }
        throw new Error(`Win32 ICMP backend failed to load: ${win.diagnostics().join("; ")}`);
    }

    if (platform === "linux") {
        const { LinuxIcmpBackend } = await import("./backend-linux.js");
        const linux = new LinuxIcmpBackend();
        if (await linux.available()) {
            backend = linux;
            return backend;
        }
        throw new Error(`Linux ICMP backend failed to load: ${linux.diagnostics().join("; ")}`);
    }

    throw new Error(`Unsupported platform: ${platform}`);
}

function computeStats(replies: PingReply[]) {
    const sent = replies.length;
    const received = replies.filter(r => r.alive).length;
    const lost = sent - received;
    const rtts = replies.filter(r => r.alive).map(r => r.rtt);

    return {
        sent,
        received,
        lost,
        lossPercent: sent > 0 ? Math.round((lost / sent) * 100) : 100,
        minRtt: rtts.length > 0 ? Math.min(...rtts) : -1,
        maxRtt: rtts.length > 0 ? Math.max(...rtts) : -1,
        avgRtt: rtts.length > 0 ? Math.round((rtts.reduce((a, b) => a + b, 0) / rtts.length) * 100) / 100 : -1,
    };
}

/** Delay helper */
function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Reverse-DNS lookup (best-effort, returns first hostname or empty string) */
async function reverseAddress(address: string): Promise<string> {
    try {
        const hostnames = await dns.reverse(address);
        return hostnames.length > 0 ? hostnames[0] : "";
    } catch {
        return "";
    }
}

/** Ping a single host and return its result */
async function pingOne(host: string, opts: Required<PingOptions>): Promise<PingResult> {
    const t = opts.trace;
    const be = await ensureBackend();
    trace(t, `pingOne("${host}") backend=${be.name} family=${opts.family} count=${opts.count}`);
    const hostIsIp = net.isIP(host) > 0;
    trace(t, `  hostIsIp=${hostIsIp}`);

    const resolved = await resolveAddress(host, opts.family, t);
    if (!resolved) {
        trace(t, `  → resolveAddress returned null, hostIsIp=${hostIsIp}`);
        return {
            host,
            address: hostIsIp ? host : "",
            family: hostIsIp ? net.isIP(host) as 4 | 6 : opts.family,
            replies: [],
            stats: computeStats([]),
            platform: os.platform(),
            method: be.name,
            diagnostics: opts.diagnostics ? [`Cannot resolve hostname: ${host}`, ...be.diagnostics()] : [`Cannot resolve hostname: ${host}`],
        };
    }

    trace(t, `  → resolved: address=${resolved.address} family=${resolved.family}`);

    // IPv6 addresses resolved but backends are IPv4-only (for now)
    if (resolved.family === 6) {
        return {
            host,
            address: resolved.address,
            family: 6,
            replies: [],
            stats: computeStats([]),
            platform: os.platform(),
            method: be.name,
            diagnostics: [`IPv6 not yet supported by ${be.name}`],
        };
    }

    // Reverse-DNS: when target is an IP, optionally look up its hostname
    let displayHost = host;
    if (opts.rdns && hostIsIp) {
        const rdnsName = await reverseAddress(resolved.address);
        if (rdnsName) displayHost = rdnsName;
    }

    const replies: PingReply[] = [];

    for (let seq = 0; seq < opts.count; seq++) {
        trace(t, `  → ping seq=${seq} address=${resolved.address}`);
        const reply = await be.ping(resolved.address, opts, seq);
        trace(t, `  → reply: alive=${reply.alive} rtt=${reply.rtt} error="${reply.error}"`);
        reply.host = displayHost;
        replies.push(reply);

        if (seq < opts.count - 1) {
            await delay(opts.interval);
        }
    }

    return {
        host: displayHost,
        address: resolved.address,
        family: resolved.family,
        replies,
        stats: computeStats(replies),
        platform: os.platform(),
        method: be.name,
        diagnostics: opts.diagnostics ? be.diagnostics() : [],
    };
}

/**
 * Ping one or more targets. Array targets run in parallel.
 * Uses allSettled so one failure doesn't block others.
 * Failed entries have the error field populated in their result.
 */
export async function ping(target: string | string[], options?: PingOptions): Promise<PingResult[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options } as Required<PingOptions>;
    await ensureBackend();

    const hosts = typeof target === "string" ? [target] : target;
    const settled = await Promise.allSettled(hosts.map(h => pingOne(h, opts)));
    return settled.map((s, i) => {
        if (s.status === "fulfilled")
            return s.value;
        return {
            host: hosts[i],
            address: "",
            family: opts.family,
            replies: [],
            stats: computeStats([]),
            platform: os.platform(),
            method: "error",
            diagnostics: [s.reason?.message || String(s.reason)],
        } as PingResult;
    });
}

/** Get diagnostic information about the current platform's ICMP capabilities. */
export async function getDiagnostics() {
    const be = await ensureBackend();
    return {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        backend: be.name,
        details: be.diagnostics(),
    };
}

