/**
 * Windows ICMP backend using IcmpSendEcho2 via Koffi FFI.
 *
 * This uses the proper Win32 ICMP API (Iphlpapi.dll) which:
 * - Does NOT require Administrator privileges
 * - Bypasses Winsock raw socket restrictions (XP SP2+)
 * - Is what ping.exe actually uses internally
 *
 * The raw socket approach (Winsock SOCK_RAW + IPPROTO_ICMP) fails on
 * modern Windows because:
 * 1. Requires Administrator privileges
 * 2. Windows Firewall blocks inbound ICMP Echo Reply by default
 * 3. Winsock raw sockets were neutered in XP SP2 — you can send ICMP
 *    but the kernel eats the replies before your socket sees them
 * 4. The ICMP stack has its own kernel driver (icmp.sys) that intercepts
 *    ICMP traffic — raw sockets compete with it and usually lose
 *
 * Linux doesn't have these problems because:
 * - Kernel 3.0+ supports SOCK_DGRAM + IPPROTO_ICMP (unprivileged)
 * - No equivalent of the Windows ICMP driver intercepting packets
 * - iptables/nftables firewall is usually permissive for outbound ICMP
 * - The kernel routes ICMP replies to the correct socket by matching
 *   the identifier field (which it remaps to the socket's port)
 */
import type { IcmpBackend, PingReply, PingOptions } from "./icmp-types.js";
export declare class Win32IcmpBackend implements IcmpBackend {
    name: string;
    private koffi;
    private iphlpapi;
    private ws2_32;
    private IcmpCreateFile;
    private IcmpSendEcho2;
    private IcmpCloseHandle;
    private inet_addr;
    private loaded;
    private loadError;
    private ptrSize;
    available(): Promise<boolean>;
    ping(address: string, options: Required<PingOptions>, seq: number): Promise<PingReply>;
    diagnostics(): string[];
}
//# sourceMappingURL=backend-win32.d.ts.map