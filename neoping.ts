/**
 * neoping — Cross-platform low-level ICMP ping API.
 *
 * Uses platform-native APIs via Koffi FFI:
 *   Windows: IcmpSendEcho2 (Iphlpapi.dll) — no admin required
 *   Linux:   socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP) — unprivileged
 *
 * API usage:
 *   import { ping, pingMultiple } from "@bobfrankston/neoping";
 *
 *   const result = await ping("8.8.8.8");
 *   const results = await pingMultiple(["8.8.8.8", "1.1.1.1", "google.com"]);
 */

import * as dns from "node:dns/promises";
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
};

let backend: IcmpBackend;

/** Resolve hostname to IP address */
async function resolveAddress(host: string, family: 4 | 6) {
    // Already an IP?
    const ipv4Re = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (family === 4 && ipv4Re.test(host))
        return { address: host, family: 4 };

    try {
        const result = await dns.lookup(host, { family });
        return { address: result.address, family: result.family };
    } catch (e: any) {
        // Try the other family
        try {
            const result = await dns.lookup(host);
            return { address: result.address, family: result.family };
        } catch (e2: any) {
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

/**
 * Ping a single target.
 * Sends `count` ICMP echo requests and returns aggregated results.
 */
export async function ping(host: string, options?: PingOptions): Promise<PingResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options } as Required<PingOptions>;
    const be = await ensureBackend();

    const resolved = await resolveAddress(host, opts.family);
    if (!resolved) {
        return {
            host,
            address: "",
            family: opts.family,
            replies: [],
            stats: computeStats([]),
            platform: os.platform(),
            method: be.name,
            diagnostics: [`Cannot resolve hostname: ${host}`, ...be.diagnostics()],
        };
    }

    const replies: PingReply[] = [];

    for (let seq = 0; seq < opts.count; seq++) {
        const reply = await be.ping(resolved.address, opts, seq);
        reply.host = host;
        replies.push(reply);

        // Interval between pings (not after last one)
        if (seq < opts.count - 1) {
            await delay(opts.interval);
        }
    }

    return {
        host,
        address: resolved.address,
        family: resolved.family,
        replies,
        stats: computeStats(replies),
        platform: os.platform(),
        method: be.name,
        diagnostics: be.diagnostics(),
    };
}

/**
 * Ping multiple targets in parallel.
 * Each target runs its full ping sequence concurrently.
 */
export async function pingMultiple(hosts: string[], options?: PingOptions): Promise<PingResult[]> {
    await ensureBackend(); // load once before parallel calls
    return Promise.all(hosts.map(host => ping(host, options)));
}

/**
 * Get diagnostic information about the current platform's ICMP capabilities.
 */
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

