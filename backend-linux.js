/**
 * Linux ICMP backend using POSIX socket API via Koffi FFI.
 *
 * Uses socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP) — the unprivileged
 * ICMP datagram socket available since Linux kernel 3.0.
 *
 * How this works:
 * - The kernel manages the ICMP identifier field, mapping it to a "port"
 * - Checksum is computed by us but the kernel verifies on receive
 * - Replies arrive WITHOUT the IP header (DGRAM strips it)
 * - The kernel routes replies back by matching identifier→socket
 * - Controlled by: sysctl net.ipv4.ping_group_range
 *
 * If SOCK_DGRAM fails (ping_group_range too narrow), and sudo option
 * is set, we retry with SOCK_RAW which requires root/CAP_NET_RAW.
 * With SOCK_RAW, replies include the IP header.
 *
 * Why this works on Linux but raw sockets fail on Windows:
 * - Linux has no competing ICMP driver stealing packets
 * - Linux kernel routes ICMP replies to the correct socket
 * - Windows Winsock SOCK_RAW+IPPROTO_ICMP was neutered in XP SP2
 * - Windows kernel ICMP driver (icmp.sys) intercepts all ICMP traffic
 */
import { buildEchoRequest } from "./icmp-checksum.js";
/** POSIX constants */
const AF_INET = 2;
const SOCK_DGRAM = 2;
const SOCK_RAW = 3;
const IPPROTO_ICMP = 1;
const SOL_IP = 0;
const IP_TTL = 2;
/** sockaddr_in is 16 bytes: family(2) + port(2) + addr(4) + zero(8) */
const SOCKADDR_IN_SIZE = 16;
export class LinuxIcmpBackend {
    name = "POSIX ICMP socket (Linux)";
    koffi;
    libc;
    socketFn;
    sendtoFn;
    recvfromFn;
    closeFn;
    setsockoptFn;
    inet_aton;
    loaded = false;
    loadError = "";
    useRaw = false; // true if DGRAM failed and we escalated to RAW
    diagMessages = [];
    async available() {
        if (this.loaded)
            return true;
        const os = await import("node:os");
        if (os.platform() !== "linux")
            return false;
        try {
            // Read ping_group_range for diagnostics
            const fs = await import("node:fs/promises");
            try {
                const range = await fs.readFile("/proc/sys/net/ipv4/ping_group_range", "utf-8");
                this.diagMessages.push(`ping_group_range: ${range.trim()}`);
            }
            catch (e) {
                this.diagMessages.push("Could not read ping_group_range");
            }
            this.koffi = (await import("koffi")).default;
            this.libc = this.koffi.load("libc.so.6");
            // int socket(int domain, int type, int protocol)
            this.socketFn = this.libc.func("socket", "int", ["int", "int", "int"]);
            // ssize_t sendto(int sockfd, const void *buf, size_t len, int flags,
            //                const struct sockaddr *dest_addr, socklen_t addrlen)
            this.sendtoFn = this.libc.func("sendto", "int", [
                "int", "void *", "int", "int", "void *", "int"
            ]);
            // ssize_t recvfrom(int sockfd, void *buf, size_t len, int flags,
            //                  struct sockaddr *src_addr, socklen_t *addrlen)
            // Use koffi async so recvfrom doesn't block the event loop — enables parallel pings
            this.recvfromFn = this.libc.func("recvfrom", "int", [
                "int", "void *", "int", "int", "void *", "void *"
            ]).async;
            // int close(int fd)
            this.closeFn = this.libc.func("close", "int", ["int"]);
            // int setsockopt(int sockfd, int level, int optname, const void *optval, socklen_t optlen)
            this.setsockoptFn = this.libc.func("setsockopt", "int", [
                "int", "int", "int", "void *", "int"
            ]);
            // int inet_aton(const char *cp, struct in_addr *inp)
            this.inet_aton = this.libc.func("inet_aton", "int", ["str", "void *"]);
            this.loaded = true;
            return true;
        }
        catch (e) {
            this.loadError = e.message;
            return false;
        }
    }
    buildSockaddr(address) {
        const buf = Buffer.alloc(SOCKADDR_IN_SIZE);
        buf.writeUInt16LE(AF_INET, 0); // sin_family
        buf.writeUInt16BE(0, 2); // sin_port (0 for ICMP)
        // sin_addr at offset 4
        const addrBuf = buf.subarray(4, 8);
        const ok = this.inet_aton(address, addrBuf);
        if (!ok)
            return null;
        return buf;
    }
    trace(options, ...args) {
        if (options.trace)
            process.stderr.write(`[trace:linux] ${args.join(" ")}\n`);
    }
    async ping(address, options, seq) {
        const reply = {
            host: address,
            address,
            seq,
            alive: false,
            rtt: -1,
            ttl: -1,
            bytes: 0,
            error: "",
        };
        // Try DGRAM first, fall back to RAW if sudo enabled
        let sockType = this.useRaw ? SOCK_RAW : SOCK_DGRAM;
        this.trace(options, `socket(AF_INET, ${sockType === SOCK_RAW ? "SOCK_RAW" : "SOCK_DGRAM"}, IPPROTO_ICMP)`);
        let fd = this.socketFn(AF_INET, sockType, IPPROTO_ICMP);
        this.trace(options, `  fd=${fd}`);
        if (fd < 0 && !this.useRaw && options.sudo) {
            this.diagMessages.push("SOCK_DGRAM failed, escalating to SOCK_RAW");
            this.trace(options, `  DGRAM failed, escalating to SOCK_RAW`);
            sockType = SOCK_RAW;
            this.useRaw = true;
            fd = this.socketFn(AF_INET, SOCK_RAW, IPPROTO_ICMP);
            this.trace(options, `  RAW fd=${fd}`);
        }
        if (fd < 0) {
            reply.error = `socket() failed (fd=${fd}). ` +
                (sockType === SOCK_DGRAM
                    ? "Check sysctl net.ipv4.ping_group_range"
                    : "Need root or CAP_NET_RAW for SOCK_RAW");
            this.trace(options, `  → ${reply.error}`);
            return reply;
        }
        try {
            // Set TTL
            const ttlBuf = Buffer.alloc(4);
            ttlBuf.writeInt32LE(options.ttl, 0);
            this.setsockoptFn(fd, SOL_IP, IP_TTL, ttlBuf, 4);
            // Set receive timeout
            const tvBuf = Buffer.alloc(16); // struct timeval: tv_sec(8) + tv_usec(8) on 64-bit
            const timeoutSec = Math.floor(options.timeout / 1000);
            const timeoutUsec = (options.timeout % 1000) * 1000;
            tvBuf.writeBigInt64LE(BigInt(timeoutSec), 0);
            tvBuf.writeBigInt64LE(BigInt(timeoutUsec), 8);
            // SO_RCVTIMEO = 20 on Linux
            this.setsockoptFn(fd, 1 /* SOL_SOCKET */, 20 /* SO_RCVTIMEO */, tvBuf, 16);
            // Build destination address
            const dest = this.buildSockaddr(address);
            this.trace(options, `  buildSockaddr("${address}") → ${dest ? "ok" : "FAILED"}`);
            if (!dest) {
                reply.error = `Invalid address: ${address}`;
                return reply;
            }
            // Build ICMP echo request
            const id = process.pid & 0xFFFF;
            const packet = buildEchoRequest(id, seq, options.size);
            this.trace(options, `  sendto fd=${fd} id=${id} seq=${seq} size=${packet.length}`);
            // Send
            const startTime = performance.now();
            const sent = this.sendtoFn(fd, packet, packet.length, 0, dest, SOCKADDR_IN_SIZE);
            this.trace(options, `  sendto → ${sent}`);
            if (sent < 0) {
                reply.error = `sendto() failed (rc=${sent})`;
                return reply;
            }
            // Receive
            const recvBuf = Buffer.alloc(1500);
            const srcAddr = Buffer.alloc(SOCKADDR_IN_SIZE);
            const addrLen = Buffer.alloc(4);
            addrLen.writeInt32LE(SOCKADDR_IN_SIZE, 0);
            this.trace(options, `  recvfrom (waiting, timeout=${options.timeout}ms)...`);
            const received = await this.recvfromFn(fd, recvBuf, 1500, 0, srcAddr, addrLen);
            const rtt = performance.now() - startTime;
            this.trace(options, `  recvfrom → ${received} bytes, rtt=${rtt.toFixed(2)}ms`);
            if (received < 0) {
                reply.error = "Request timed out";
                return reply;
            }
            // Parse reply
            // SOCK_DGRAM: no IP header, starts with ICMP header
            // SOCK_RAW: starts with IP header
            let icmpOffset = 0;
            let replyTtl = -1;
            if (this.useRaw) {
                const ipHeaderLen = (recvBuf[0] & 0x0F) * 4;
                replyTtl = recvBuf[8];
                icmpOffset = ipHeaderLen;
                this.trace(options, `  RAW: ipHeaderLen=${ipHeaderLen} ttl=${replyTtl}`);
            }
            if (received < icmpOffset + 8) {
                reply.error = `Short ICMP reply (${received} bytes)`;
                this.trace(options, `  → ${reply.error}`);
                return reply;
            }
            const icmpType = recvBuf[icmpOffset];
            const icmpCode = recvBuf[icmpOffset + 1];
            const replyId = recvBuf.readUInt16BE(icmpOffset + 4);
            const replySeq = recvBuf.readUInt16BE(icmpOffset + 6);
            this.trace(options, `  ICMP: type=${icmpType} code=${icmpCode} id=${replyId} seq=${replySeq}`);
            if (icmpType === 0) { // Echo Reply
                reply.alive = true;
                reply.rtt = Math.round(rtt * 100) / 100;
                reply.ttl = replyTtl;
                reply.bytes = received - icmpOffset;
            }
            else if (icmpType === 3) { // Destination Unreachable
                const { UnreachableCode } = await import("./icmp-types.js");
                reply.error = UnreachableCode[icmpCode] || `Destination unreachable (code ${icmpCode})`;
            }
            else if (icmpType === 11) { // Time Exceeded
                reply.error = "TTL expired in transit";
            }
            else {
                reply.error = `Unexpected ICMP type ${icmpType} code ${icmpCode}`;
            }
            this.trace(options, `  → alive=${reply.alive} error="${reply.error}"`);
        }
        finally {
            this.closeFn(fd);
        }
        return reply;
    }
    diagnostics() {
        return [
            `Backend: POSIX socket API via Koffi FFI`,
            `Socket type: ${this.useRaw ? "SOCK_RAW (privileged)" : "SOCK_DGRAM (unprivileged)"}`,
            "Linux kernel 3.0+ supports SOCK_DGRAM+IPPROTO_ICMP without root",
            "Kernel manages ICMP id→socket mapping, strips IP header for DGRAM",
            ...(this.loadError ? [`Load error: ${this.loadError}`] : []),
            ...this.diagMessages,
        ];
    }
}
//# sourceMappingURL=backend-linux.js.map