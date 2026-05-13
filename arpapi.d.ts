/**
 * Cross-platform MAC address lookup for IPv4 hosts on the local subnet.
 *
 *   Windows: SendARP (Iphlpapi.dll) via Koffi FFI — same DLL neoping
 *            already loads for IcmpSendEcho2. Triggers an ARP request
 *            if the entry isn't cached. Only succeeds for IPs on a
 *            directly connected subnet.
 *   Linux:   parses /proc/net/arp directly — no subprocess.
 *   macOS:   shells out to `arp -n <ip>` because the BSD routing-socket
 *            sysctl path (NET_RT_FLAGS) is unpleasant via FFI.
 *
 * Returns "" for any host that can't be resolved to a MAC. For non-local
 * IPs you'll typically get the gateway's MAC (Linux/macOS) or "" (Windows).
 */
/** Look up the MAC for an IPv4 address. Returns lowercase colon form
 *  ("aa:bb:cc:dd:ee:ff") or "" if no entry is available.
 *
 *  Only resolves addresses on a directly-connected subnet — for any other
 *  IP this returns "" without doing a lookup. This prevents the misleading
 *  case on Linux/macOS where ARP returns the default gateway's MAC for
 *  remote IPs (Windows SendARP already enforces this server-side). */
export declare function lookupMac(ipv4: string): Promise<string>;
//# sourceMappingURL=arpapi.d.ts.map