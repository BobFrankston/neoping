/** ICMP protocol constants */
export const ICMP = {
    EchoReply: 0,
    DestUnreachable: 3,
    EchoRequest: 8,
    TimeExceeded: 11,
    HeaderSize: 8,
    IPv4HeaderSize: 20,
} as const;

/** ICMP Destination Unreachable codes */
export const UnreachableCode: Record<number, string> = {
    0: "Network unreachable",
    1: "Host unreachable",
    2: "Protocol unreachable",
    3: "Port unreachable",
    4: "Fragmentation needed but DF set",
    5: "Source route failed",
    6: "Destination network unknown",
    7: "Destination host unknown",
    10: "Host administratively prohibited",
    13: "Communication administratively prohibited",
};

/** Result of a single ping attempt */
export interface PingReply {
    host: string;         /** Original target (hostname or IP) */
    address: string;      /** Resolved IP address */
    seq: number;          /** Sequence number */
    alive: boolean;       /** Got a reply */
    rtt: number;          /** Round-trip time in ms (-1 if no reply) */
    ttl: number;          /** Time-to-live from reply (-1 if no reply) */
    bytes: number;        /** Reply size in bytes */
    error: string;        /** Error message if failed */
}

/** Aggregate result for a ping session */
export interface PingResult {
    host: string;         /** Original target */
    address: string;      /** Resolved IP address */
    family: number;       /** Address family (4 or 6) */
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
    platform: string;     /** Platform used */
    method: string;       /** ICMP method used (IcmpSendEcho2, raw-dgram, etc.) */
    diagnostics: string[];/** Platform-specific diagnostic messages */
}

/** Options for ping operations */
export interface PingOptions {
    count?: number;       /** Number of pings (default 4) */
    timeout?: number;     /** Per-ping timeout in ms (default 4000) */
    interval?: number;    /** Interval between pings in ms (default 1000) */
    ttl?: number;         /** Time-to-live (default 128) */
    size?: number;        /** Payload size in bytes (default 32) */
    sudo?: boolean;       /** Auto-escalate privileges if needed */
    family?: 4 | 6;       /** Force IPv4 or IPv6 */
}

/** Interface that platform-specific backends implement */
export interface IcmpBackend {
    name: string;
    available(): Promise<boolean>;
    ping(address: string, options: Required<PingOptions>, seq: number): Promise<PingReply>;
    diagnostics(): string[];
}
