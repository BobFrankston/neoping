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
import type { IcmpBackend, PingReply, PingOptions } from "./icmp-types.js";
export declare class LinuxIcmpBackend implements IcmpBackend {
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
    ping(address: string, options: Required<PingOptions>, seq: number): Promise<PingReply>;
    diagnostics(): string[];
}
//# sourceMappingURL=backend-linux.d.ts.map