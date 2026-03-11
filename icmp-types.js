/** ICMP protocol constants */
export const ICMP = {
    EchoReply: 0,
    DestUnreachable: 3,
    EchoRequest: 8,
    TimeExceeded: 11,
    HeaderSize: 8,
    IPv4HeaderSize: 20,
};
/** ICMP Destination Unreachable codes */
export const UnreachableCode = {
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
//# sourceMappingURL=icmp-types.js.map