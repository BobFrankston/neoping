/**
 * macOS (Darwin) ICMP backend using BSD socket API via Koffi FFI.
 *
 * Uses socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP) — the unprivileged
 * ICMP datagram socket. macOS allows this for any user out of the box
 * (no analogue to Linux's net.ipv4.ping_group_range gate).
 *
 * BSD-vs-Linux differences handled here:
 *   - sockaddr_in starts with a 1-byte sin_len, so sin_family is at offset 1
 *   - SO_RCVTIMEO = 0x1006 (Linux: 20), SOL_SOCKET = 0xFFFF (Linux: 1)
 *   - IP_TTL = 4 (Linux: 2)
 *   - struct timeval is 16 bytes on 64-bit Darwin (8-byte tv_sec + 4-byte
 *     tv_usec + 4 bytes trailing padding for 8-byte struct alignment)
 *   - DGRAM replies on Darwin may include the IPv4 header; we auto-detect
 *     by checking the first byte's version nibble
 *
 * Falls back to SOCK_RAW (root/sudo) only if DGRAM fails — should be rare.
 */
import { styleText } from "node:util";
import { buildEchoRequest } from "./icmp-checksum.js";
/** BSD socket constants */
const AF_INET = 2;
const SOCK_DGRAM = 2;
const SOCK_RAW = 3;
const IPPROTO_ICMP = 1;
const IPPROTO_IP = 0;
const IP_TTL = 4; // Darwin
const SOL_SOCKET = 0xFFFF; // Darwin
const SO_RCVTIMEO = 0x1006; // Darwin
/** sockaddr_in is 16 bytes: len(1) + family(1) + port(2) + addr(4) + zero(8) */
const SOCKADDR_IN_SIZE = 16;
/** struct timeval on 64-bit Darwin: tv_sec(8) + tv_usec(4) + pad(4) = 16 */
const TIMEVAL_SIZE = 16;
export class DarwinIcmpBackend {
    name = "BSD ICMP socket (Darwin)";
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
    useRaw = false;
    diagMessages = [];
    async available() {
        if (this.loaded)
            return true;
        const os = await import("node:os");
        if (os.platform() !== "darwin")
            return false;
        try {
            this.koffi = (await import("koffi")).default;
            // libc.dylib is a symlink to libSystem.B.dylib on all macOS versions
            this.libc = this.koffi.load("libc.dylib");
            this.socketFn = this.libc.func("socket", "int", ["int", "int", "int"]);
            this.sendtoFn = this.libc.func("sendto", "int", [
                "int", "void *", "int", "int", "void *", "int"
            ]);
            // Use async recvfrom so it doesn't block the event loop — enables parallel pings
            this.recvfromFn = this.libc.func("recvfrom", "int", [
                "int", "void *", "int", "int", "void *", "void *"
            ]).async;
            this.closeFn = this.libc.func("close", "int", ["int"]);
            this.setsockoptFn = this.libc.func("setsockopt", "int", [
                "int", "int", "int", "void *", "int"
            ]);
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
        buf.writeUInt8(SOCKADDR_IN_SIZE, 0); // sin_len (BSD-only)
        buf.writeUInt8(AF_INET, 1); // sin_family
        buf.writeUInt16BE(0, 2); // sin_port
        const addrBuf = buf.subarray(4, 8);
        const ok = this.inet_aton(address, addrBuf);
        if (!ok)
            return null;
        return buf;
    }
    trace(options, ...args) {
        if (options.trace)
            console.log(styleText("dim", `[trace:darwin] ${args.join(" ")}`));
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
                    ? "macOS normally allows unprivileged ICMP — check for sandbox/SIP restrictions"
                    : "Need root for SOCK_RAW");
            this.trace(options, `  → ${reply.error}`);
            return reply;
        }
        try {
            // Set TTL (level = IPPROTO_IP)
            const ttlBuf = Buffer.alloc(4);
            ttlBuf.writeInt32LE(options.ttl, 0);
            this.setsockoptFn(fd, IPPROTO_IP, IP_TTL, ttlBuf, 4);
            // Set receive timeout — struct timeval is 16 bytes on 64-bit Darwin
            const tvBuf = Buffer.alloc(TIMEVAL_SIZE);
            const timeoutSec = Math.floor(options.timeout / 1000);
            const timeoutUsec = (options.timeout % 1000) * 1000;
            tvBuf.writeBigInt64LE(BigInt(timeoutSec), 0);
            tvBuf.writeInt32LE(timeoutUsec, 8);
            // bytes 12-15 are padding, already zeroed by Buffer.alloc
            this.setsockoptFn(fd, SOL_SOCKET, SO_RCVTIMEO, tvBuf, TIMEVAL_SIZE);
            const dest = this.buildSockaddr(address);
            this.trace(options, `  buildSockaddr("${address}") → ${dest ? "ok" : "FAILED"}`);
            if (!dest) {
                reply.error = `Invalid address: ${address}`;
                return reply;
            }
            const id = process.pid & 0xFFFF;
            const packet = buildEchoRequest(id, seq, options.size);
            this.trace(options, `  sendto fd=${fd} id=${id} seq=${seq} size=${packet.length}`);
            const startTime = performance.now();
            const sent = this.sendtoFn(fd, packet, packet.length, 0, dest, SOCKADDR_IN_SIZE);
            this.trace(options, `  sendto → ${sent}`);
            if (sent < 0) {
                reply.error = `sendto() failed (rc=${sent})`;
                return reply;
            }
            const recvBuf = Buffer.alloc(1500);
            const srcAddr = Buffer.alloc(SOCKADDR_IN_SIZE);
            const addrLen = Buffer.alloc(4);
            addrLen.writeInt32LE(SOCKADDR_IN_SIZE, 0);
            // SOCK_RAW (and sometimes Darwin DGRAM) sees outgoing echo requests
            // on loopback before the reply. Loop to skip type-8 frames.
            let received;
            let icmpOffset = 0;
            let replyTtl = -1;
            let icmpType;
            let icmpCode;
            let replyId;
            let replySeq;
            do {
                this.trace(options, `  recvfrom (waiting, timeout=${options.timeout}ms)...`);
                received = await new Promise((resolve, reject) => {
                    this.recvfromFn(fd, recvBuf, 1500, 0, srcAddr, addrLen, (err, result) => {
                        if (err)
                            reject(err);
                        else
                            resolve(result);
                    });
                });
                this.trace(options, `  recvfrom → ${received} bytes`);
                if (received < 0) {
                    reply.error = "Request timed out";
                    return reply;
                }
                // Auto-detect whether IP header is present. ICMP types we care
                // about (0, 3, 8, 11) all have high nibble 0; an IPv4 header
                // always has high nibble 4, so the version-nibble check is safe.
                icmpOffset = 0;
                replyTtl = -1;
                if ((recvBuf[0] >> 4) === 4) {
                    const ipHeaderLen = (recvBuf[0] & 0x0F) * 4;
                    if (ipHeaderLen >= 20 && received >= ipHeaderLen + 8) {
                        replyTtl = recvBuf[8];
                        icmpOffset = ipHeaderLen;
                        this.trace(options, `  IP header present: len=${ipHeaderLen} ttl=${replyTtl}`);
                    }
                }
                if (received < icmpOffset + 8) {
                    reply.error = `Short ICMP reply (${received} bytes)`;
                    this.trace(options, `  → ${reply.error}`);
                    return reply;
                }
                icmpType = recvBuf[icmpOffset];
                icmpCode = recvBuf[icmpOffset + 1];
                replyId = recvBuf.readUInt16BE(icmpOffset + 4);
                replySeq = recvBuf.readUInt16BE(icmpOffset + 6);
                this.trace(options, `  ICMP: type=${icmpType} code=${icmpCode} id=${replyId} seq=${replySeq}`);
                if (icmpType === 8) {
                    this.trace(options, `  skipping echo request (loopback reflection)`);
                }
            } while (icmpType === 8);
            const rtt = performance.now() - startTime;
            if (icmpType === 0) {
                reply.alive = true;
                reply.rtt = Math.round(rtt * 100) / 100;
                reply.ttl = replyTtl;
                reply.bytes = received - icmpOffset;
            }
            else if (icmpType === 3) {
                const { UnreachableCode } = await import("./icmp-types.js");
                reply.error = UnreachableCode[icmpCode] || `Destination unreachable (code ${icmpCode})`;
            }
            else if (icmpType === 11) {
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
            `Backend: BSD socket API via Koffi FFI (libc.dylib)`,
            `Socket type: ${this.useRaw ? "SOCK_RAW (privileged)" : "SOCK_DGRAM (unprivileged)"}`,
            "macOS allows SOCK_DGRAM+IPPROTO_ICMP without root (no ping_group_range gate)",
            ...(this.loadError ? [`Load error: ${this.loadError}`] : []),
            ...this.diagMessages,
        ];
    }
}
//# sourceMappingURL=backend-darwin.js.map