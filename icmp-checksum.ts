/**
 * Compute ICMP checksum per RFC 1071.
 * One's complement of the one's complement sum of 16-bit words.
 */
export function computeChecksum(buf: Buffer) {
    let sum = 0;
    for (let i = 0; i < buf.length - 1; i += 2) {
        sum += buf.readUInt16BE(i);
    }
    if (buf.length % 2) {
        sum += buf[buf.length - 1] << 8;
    }
    while (sum >> 16) {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    return ~sum & 0xFFFF;
}

/** Build an ICMP Echo Request packet */
export function buildEchoRequest(id: number, seq: number, payloadSize: number) {
    const packet = Buffer.alloc(8 + payloadSize);
    packet.writeUInt8(8, 0);                   // Type: Echo Request
    packet.writeUInt8(0, 1);                   // Code: 0
    packet.writeUInt16BE(0, 2);                // Checksum placeholder
    packet.writeUInt16BE(id & 0xFFFF, 4);      // Identifier
    packet.writeUInt16BE(seq & 0xFFFF, 6);     // Sequence

    // Fill payload with timestamp for RTT calculation
    const now = Date.now();
    if (payloadSize >= 8) {
        packet.writeBigUInt64BE(BigInt(now), 8);
    }
    // Fill remaining with pattern
    for (let i = 16; i < 8 + payloadSize; i++) {
        packet[i] = i & 0xFF;
    }

    const checksum = computeChecksum(packet);
    packet.writeUInt16BE(checksum, 2);
    return packet;
}

/** Parse an ICMP Echo Reply from a raw IP packet */
export function parseEchoReply(buf: Buffer) {
    if (buf.length < 28) return null; // minimum: 20 IP + 8 ICMP

    const ipHeaderLen = (buf[0] & 0x0F) * 4;
    const icmpOff = ipHeaderLen;

    if (buf.length < icmpOff + 8) return null;

    const type = buf[icmpOff];
    const code = buf[icmpOff + 1];
    const id = buf.readUInt16BE(icmpOff + 4);
    const seq = buf.readUInt16BE(icmpOff + 6);
    const ttl = buf[8]; // TTL is at byte 8 of IP header

    let rtt = -1;
    if (buf.length >= icmpOff + 16) {
        try {
            const sentTime = Number(buf.readBigUInt64BE(icmpOff + 8));
            rtt = Date.now() - sentTime;
        } catch (e: any) {
            // payload too short for timestamp
        }
    }

    return { type, code, id, seq, ttl, rtt, bytes: buf.length - ipHeaderLen };
}
