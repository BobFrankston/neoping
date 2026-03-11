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
import type { PingOptions, PingResult, PingReply } from "./icmp-types.js";
export type { PingOptions, PingResult, PingReply };
/**
 * Ping a single target.
 * Sends `count` ICMP echo requests and returns aggregated results.
 */
export declare function ping(host: string, options?: PingOptions): Promise<PingResult>;
/**
 * Ping multiple targets in parallel.
 * Each target runs its full ping sequence concurrently.
 */
export declare function pingMultiple(hosts: string[], options?: PingOptions): Promise<PingResult[]>;
/**
 * Get diagnostic information about the current platform's ICMP capabilities.
 */
export declare function getDiagnostics(): Promise<{
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
    nodeVersion: string;
    backend: string;
    details: string[];
}>;
//# sourceMappingURL=neoping.d.ts.map