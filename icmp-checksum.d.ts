/**
 * Compute ICMP checksum per RFC 1071.
 * One's complement of the one's complement sum of 16-bit words.
 */
export declare function computeChecksum(buf: Buffer): number;
/** Build an ICMP Echo Request packet */
export declare function buildEchoRequest(id: number, seq: number, payloadSize: number): Buffer<ArrayBuffer>;
/** Parse an ICMP Echo Reply from a raw IP packet */
export declare function parseEchoReply(buf: Buffer): {
    type: number;
    code: number;
    id: number;
    seq: number;
    ttl: number;
    rtt: number;
    bytes: number;
};
//# sourceMappingURL=icmp-checksum.d.ts.map