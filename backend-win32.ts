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

/** IP_OPTION_INFORMATION structure layout */
const IP_OPTION_INFO_SIZE = 8; // Ttl(1) + Tos(1) + Flags(1) + OptionsSize(1) + OptionsData(4=ptr)

/**
 * ICMP_ECHO_REPLY structure (28 bytes on 32-bit, varies on 64-bit due to pointer)
 * We read fields manually from the buffer.
 *
 * typedef struct icmp_echo_reply {
 *   IPAddr                         Address;        // 4 bytes  offset 0
 *   ULONG                          Status;         // 4 bytes  offset 4
 *   ULONG                          RoundTripTime;  // 4 bytes  offset 8
 *   USHORT                         DataSize;       // 2 bytes  offset 12
 *   USHORT                         Reserved;       // 2 bytes  offset 14
 *   PVOID                          Data;           // 4/8 bytes offset 16
 *   struct ip_option_information   Options;        // 8+ bytes
 * } ICMP_ECHO_REPLY;
 */

/** Windows ICMP status codes */
const IcmpStatus: Record<number, string> = {
    0: "Success",
    11001: "Buffer too small",
    11002: "Destination net unreachable",
    11003: "Destination host unreachable",
    11004: "Destination protocol unreachable",
    11005: "Destination port unreachable",
    11006: "No resources",
    11007: "Bad option",
    11008: "Hardware error",
    11009: "Packet too big",
    11010: "Request timed out",
    11011: "Bad request",
    11012: "Bad route",
    11013: "TTL expired in transit",
    11014: "TTL expired during reassembly",
    11015: "Parameter problem",
    11016: "Source quench",
    11017: "Option too big",
    11018: "Bad destination",
    11050: "General failure",
};

export class Win32IcmpBackend implements IcmpBackend {
    name = "IcmpSendEcho2 (Win32 API)";
    private koffi: any;
    private iphlpapi: any;
    private ws2_32: any;
    private IcmpCreateFile: any;
    private IcmpSendEcho2: any;
    private IcmpCloseHandle: any;
    private inet_addr: any;
    private loaded = false;
    private loadError = "";
    private ptrSize = 8; // 64-bit Windows

    async available() {
        if (this.loaded) return true;
        try {
            this.koffi = (await import("koffi")).default;

            this.iphlpapi = this.koffi.load("Iphlpapi.dll");
            this.ws2_32 = this.koffi.load("Ws2_32.dll");

            // HANDLE IcmpCreateFile(VOID)
            this.IcmpCreateFile = this.iphlpapi.func("__stdcall", "IcmpCreateFile", "void *", []);

            // BOOL IcmpCloseHandle(HANDLE IcmpHandle)
            this.IcmpCloseHandle = this.iphlpapi.func("__stdcall", "IcmpCloseHandle", "int", ["void *"]);

            // DWORD IcmpSendEcho2(
            //   HANDLE IcmpHandle, HANDLE Event, PIO_APC_ROUTINE ApcRoutine,
            //   PVOID ApcContext, IPAddr DestinationAddress,
            //   LPVOID RequestData, WORD RequestSize,
            //   PIP_OPTION_INFORMATION RequestOptions,
            //   LPVOID ReplyBuffer, DWORD ReplySize, DWORD Timeout
            // )
            this.IcmpSendEcho2 = this.iphlpapi.func("__stdcall", "IcmpSendEcho2", "uint32", [
                "void *",   // IcmpHandle
                "void *",   // Event (NULL for sync)
                "void *",   // ApcRoutine (NULL for sync)
                "void *",   // ApcContext (NULL for sync)
                "uint32",   // DestinationAddress (network byte order)
                "void *",   // RequestData
                "uint16",   // RequestSize
                "void *",   // RequestOptions (NULL for defaults)
                "void *",   // ReplyBuffer
                "uint32",   // ReplySize
                "uint32",   // Timeout
            ]);

            // unsigned long inet_addr(const char *cp)
            this.inet_addr = this.ws2_32.func("__stdcall", "inet_addr", "uint32", ["str"]);

            this.loaded = true;
            return true;
        } catch (e: any) {
            this.loadError = e.message;
            return false;
        }
    }

    async ping(address: string, options: Required<PingOptions>, seq: number): Promise<PingReply> {
        const reply: PingReply = {
            host: address,
            address,
            seq,
            alive: false,
            rtt: -1,
            ttl: -1,
            bytes: 0,
            error: "",
        };

        try {
            // Convert IP string to network byte order uint32
            const destAddr: number = this.inet_addr(address);
            if (destAddr === 0xFFFFFFFF) {
                reply.error = `Invalid address: ${address}`;
                return reply;
            }

            // Create ICMP handle
            const handle = this.IcmpCreateFile();
            if (!handle) {
                reply.error = "IcmpCreateFile failed";
                return reply;
            }

            try {
                // Build request payload
                const sendData = Buffer.alloc(options.size);
                const now = Date.now();
                if (options.size >= 8) {
                    sendData.writeBigUInt64BE(BigInt(now), 0);
                }
                for (let i = 8; i < options.size; i++) {
                    sendData[i] = i & 0xFF;
                }

                // Build IP_OPTION_INFORMATION for TTL
                const ipOptions = Buffer.alloc(IP_OPTION_INFO_SIZE + this.ptrSize);
                ipOptions.writeUInt8(options.ttl, 0); // Ttl

                // Reply buffer needs room for ICMP_ECHO_REPLY + data + 8
                // On 64-bit: struct is ~32 bytes (due to pointer alignment)
                const replyBufSize = 32 + options.size + 256;
                const replyBuf = Buffer.alloc(replyBufSize);

                const startTime = performance.now();

                const numReplies: number = this.IcmpSendEcho2(
                    handle,
                    null,       // sync
                    null,       // no APC
                    null,       // no context
                    destAddr,
                    sendData,
                    options.size,
                    ipOptions,
                    replyBuf,
                    replyBufSize,
                    options.timeout,
                );

                const rtt = performance.now() - startTime;

                if (numReplies > 0) {
                    // Parse ICMP_ECHO_REPLY from replyBuf
                    const status = replyBuf.readUInt32LE(4);
                    const dataSize = replyBuf.readUInt16LE(12);

                    // Options struct follows the Data pointer
                    // On 64-bit: Data ptr at offset 16 (8 bytes), Options at offset 24
                    const optionsOffset = 16 + this.ptrSize;
                    const replyTtl = replyBuf.readUInt8(optionsOffset);

                    if (status === 0) {
                        reply.alive = true;
                        reply.rtt = Math.round(rtt * 100) / 100; // sub-ms precision
                        reply.ttl = replyTtl;
                        reply.bytes = dataSize;
                    } else {
                        reply.error = IcmpStatus[status] || `ICMP status ${status}`;
                    }
                } else {
                    reply.error = "Request timed out";
                }
            } finally {
                this.IcmpCloseHandle(handle);
            }
        } catch (e: any) {
            reply.error = e.message;
        }

        return reply;
    }

    diagnostics() {
        const diags: string[] = [];
        diags.push("Backend: Win32 IcmpSendEcho2 via Koffi FFI");
        diags.push("Library: Iphlpapi.dll (no admin required)");
        if (this.loadError) {
            diags.push(`Load error: ${this.loadError}`);
        }
        diags.push("");
        diags.push("Why raw sockets fail on Windows but not Linux:");
        diags.push("  Windows: Winsock SOCK_RAW+IPPROTO_ICMP neutered since XP SP2");
        diags.push("  Windows: Kernel ICMP driver (icmp.sys) intercepts replies");
        diags.push("  Windows: Firewall blocks inbound ICMP Echo Reply by default");
        diags.push("  Windows: Requires admin just to create raw socket");
        diags.push("  Linux:   SOCK_DGRAM+IPPROTO_ICMP works unprivileged (kernel 3.0+)");
        diags.push("  Linux:   Kernel routes replies by identifier→socket mapping");
        diags.push("  Linux:   No competing ICMP driver stealing packets");
        return diags;
    }
}
