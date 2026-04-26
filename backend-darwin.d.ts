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
import type { IcmpBackend, PingReply, PingOptions } from "./icmp-types.js";
export declare class DarwinIcmpBackend implements IcmpBackend {
    name: string;
    private koffi;
    private libc;
    private socketFn;
    private sendtoFn;
    private recvfromFn;
    private closeFn;
    private setsockoptFn;
    private inet_aton;
    private loaded;
    private loadError;
    private useRaw;
    private diagMessages;
    available(): Promise<boolean>;
    private buildSockaddr;
    private trace;
    ping(address: string, options: Required<PingOptions>, seq: number): Promise<PingReply>;
    diagnostics(): string[];
}
//# sourceMappingURL=backend-darwin.d.ts.map