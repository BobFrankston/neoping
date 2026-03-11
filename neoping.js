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
import * as os from "node:os";
const DEFAULT_OPTIONS = {
    count: 4,
    timeout: 4000,
    interval: 1000,
    ttl: 128,
    size: 32,
    sudo: false,
    family: 4,
};
let backend;
/** Resolve hostname to IP address */
async function resolveAddress(host, family) {
    // Already an IP?
    const ipv4Re = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    if (family === 4 && ipv4Re.test(host))
        return { address: host, family: 4 };
    try {
        const result = await dns.lookup(host, { family });
        return { address: result.address, family: result.family };
    }
    catch (e) {
        // Try the other family
        try {
            const result = await dns.lookup(host);
            return { address: result.address, family: result.family };
        }
        catch (e2) {
            return null;
        }
    }
}
/** Initialize the appropriate backend for this platform */
async function ensureBackend() {
    if (backend)
        return backend;
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
function computeStats(replies) {
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
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/** Ping a single host and return its result */
async function pingOne(host, opts) {
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
    const replies = [];
    for (let seq = 0; seq < opts.count; seq++) {
        const reply = await be.ping(resolved.address, opts, seq);
        reply.host = host;
        replies.push(reply);
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
 * Ping one or more targets. Array targets run in parallel.
 * Uses allSettled so one failure doesn't block others.
 * Failed entries have the error field populated in their result.
 */
export async function ping(target, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
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
        };
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
//# sourceMappingURL=neoping.js.map