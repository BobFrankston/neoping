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
import type { PingOptions, PingResult, PingReply } from "./icmp-types.js";
export type { PingOptions, PingResult, PingReply };
/**
 * Ping one or more targets. Array targets run in parallel.
 * Uses allSettled so one failure doesn't block others.
 * Failed entries have the error field populated in their result.
 */
export declare function ping(target: string | string[], options?: PingOptions): Promise<PingResult[]>;
/** Get diagnostic information about the current platform's ICMP capabilities. */
export declare function getDiagnostics(): Promise<{
    platform: NodeJS.Platform;
    arch: NodeJS.Architecture;
    nodeVersion: string;
    backend: string;
    details: string[];
}>;
//# sourceMappingURL=pingapi.d.ts.map