/**
 * Cross-platform MAC address lookup for IPv4 hosts on the local subnet.
 *
 *   Windows: SendARP (Iphlpapi.dll) via Koffi FFI — same DLL neoping
 *            already loads for IcmpSendEcho2. Triggers an ARP request
 *            if the entry isn't cached. Only succeeds for IPs on a
 *            directly connected subnet.
 *   Linux:   parses /proc/net/arp directly — no subprocess.
 *   macOS:   shells out to `arp -n <ip>` because the BSD routing-socket
 *            sysctl path (NET_RT_FLAGS) is unpleasant via FFI.
 *
 * Returns "" for any host that can't be resolved to a MAC. For non-local
 * IPs you'll typically get the gateway's MAC (Linux/macOS) or "" (Windows).
 */
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
/** Look up the MAC for an IPv4 address. Returns lowercase colon form
 *  ("aa:bb:cc:dd:ee:ff") or "" if no entry is available. */
export async function lookupMac(ipv4) {
    const platform = os.platform();
    if (platform === "win32")
        return lookupMacWin32(ipv4);
    if (platform === "linux")
        return lookupMacLinux(ipv4);
    if (platform === "darwin")
        return lookupMacDarwin(ipv4);
    return "";
}
let win32State = null;
async function lookupMacWin32(ipv4) {
    try {
        if (!win32State) {
            const koffi = (await import("koffi")).default;
            const iphlpapi = koffi.load("Iphlpapi.dll");
            // DWORD SendARP(IPAddr DestIP, IPAddr SrcIP, PULONG pMacAddr, PULONG PhyAddrLen)
            const SendARP = iphlpapi.func("__stdcall", "SendARP", "uint32", [
                "uint32", // DestIP (network byte order)
                "uint32", // SrcIP (0 → pick interface)
                "void *", // pMacAddr → 8-byte buffer
                "void *", // PhyAddrLen → ULONG, in/out
            ]);
            win32State = { SendARP };
        }
        const destIp = ipv4ToNbo(ipv4);
        if (destIp === null)
            return "";
        const macBuf = Buffer.alloc(8);
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeUInt32LE(6, 0);
        const rc = await new Promise((resolve, reject) => {
            win32State.SendARP.async(destIp, 0, macBuf, lenBuf, (err, result) => {
                if (err)
                    reject(err);
                else
                    resolve(result);
            });
        });
        if (rc !== 0)
            return "";
        const len = lenBuf.readUInt32LE(0);
        if (len < 6)
            return "";
        return Array.from(macBuf.subarray(0, 6))
            .map(b => b.toString(16).padStart(2, "0"))
            .join(":");
    }
    catch {
        return "";
    }
}
/** "192.168.1.1" → uint32 in network byte order (low byte = first octet on little-endian). */
function ipv4ToNbo(ip) {
    const parts = ip.split(".");
    if (parts.length !== 4)
        return null;
    const octets = [];
    for (const p of parts) {
        const n = parseInt(p, 10);
        if (!Number.isInteger(n) || n < 0 || n > 255 || String(n) !== p)
            return null;
        octets.push(n);
    }
    return ((octets[0]) | (octets[1] << 8) | (octets[2] << 16) | (octets[3] << 24)) >>> 0;
}
async function lookupMacLinux(ipv4) {
    try {
        const text = await fs.readFile("/proc/net/arp", "utf8");
        const lines = text.split("\n").slice(1);
        for (const line of lines) {
            const fields = line.trim().split(/\s+/);
            if (fields[0] === ipv4 && fields[3]) {
                return normalizeMac(fields[3]);
            }
        }
        return "";
    }
    catch {
        return "";
    }
}
async function lookupMacDarwin(ipv4) {
    try {
        const stdout = await new Promise((resolve, reject) => {
            const proc = spawn("arp", ["-n", ipv4], { stdio: ["ignore", "pipe", "ignore"] });
            let out = "";
            proc.stdout.on("data", d => out += d.toString());
            proc.on("close", () => resolve(out));
            proc.on("error", reject);
        });
        // Format: "? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0 ifscope [ethernet]"
        // Or:     "host (1.2.3.4) -- no entry"
        const m = stdout.match(/\bat\s+([0-9a-f:]+)\b/i);
        return m ? normalizeMac(m[1]) : "";
    }
    catch {
        return "";
    }
}
/** Validate and canonicalize a MAC to lowercase colon form with zero-padded octets.
 *  Returns "" for anything that isn't six hex pairs or is the null MAC. */
function normalizeMac(raw) {
    const parts = raw.split(":");
    if (parts.length !== 6)
        return "";
    if (parts.some(p => !/^[0-9a-f]{1,2}$/i.test(p)))
        return "";
    const canonical = parts.map(p => p.padStart(2, "0").toLowerCase()).join(":");
    if (canonical === "00:00:00:00:00:00")
        return "";
    return canonical;
}
//# sourceMappingURL=arpapi.js.map