/** ICMP protocol constants */
export declare const ICMP: {
    readonly EchoReply: 0;
    readonly DestUnreachable: 3;
    readonly EchoRequest: 8;
    readonly TimeExceeded: 11;
    readonly HeaderSize: 8;
    readonly IPv4HeaderSize: 20;
};
/** ICMP Destination Unreachable codes */
export declare const UnreachableCode: Record<number, string>;
/** Result of a single ping attempt */
export interface PingReply {
    host: string; /** Original target (hostname or IP) */
    address: string; /** Resolved IP address */
    seq: number; /** Sequence number */
    alive: boolean; /** Got a reply */
    rtt: number; /** Round-trip time in ms (-1 if no reply) */
    ttl: number; /** Time-to-live from reply (-1 if no reply) */
    bytes: number; /** Reply size in bytes */
    error: string; /** Error message if failed */
}
/** Aggregate result for a ping session */
export interface PingResult {
    host: string; /** Original target */
    address: string; /** Resolved IP address */
    family: number; /** Address family (4 or 6) */
    replies: PingReply[]; /** Individual ping replies */
    stats: {
        sent: number;
        received: number;
        lost: number;
        lossPercent: number;
        minRtt: number;
        maxRtt: number;
        avgRtt: number;
    };
    platform: string; /** Platform used */
    method: string; /** ICMP method used (IcmpSendEcho2, raw-dgram, etc.) */
    diagnostics: string[]; /** Platform-specific diagnostic messages */
}
/** Options for ping operations */
export interface PingOptions {
    count?: number; /** Number of pings (default 4) */
    timeout?: number; /** Per-ping timeout in ms (default 4000) */
    interval?: number; /** Interval between pings in ms (default 1000) */
    ttl?: number; /** Time-to-live (default 128) */
    size?: number; /** Payload size in bytes (default 32) */
    sudo?: boolean; /** Auto-escalate privileges if needed */
    family?: 4 | 6; /** Force IPv4 or IPv6 */
    diagnostics?: boolean; /** Include platform diagnostics in results (default false) */
}
/** Interface that platform-specific backends implement */
export interface IcmpBackend {
    name: string;
    available(): Promise<boolean>;
    ping(address: string, options: Required<PingOptions>, seq: number): Promise<PingReply>;
    diagnostics(): string[];
}
//# sourceMappingURL=icmp-types.d.ts.map