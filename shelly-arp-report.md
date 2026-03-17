# ESP32 IoT Devices Become Unreachable from Windows Due to WiFi Modem Sleep + Gratuitous ARP Interaction

## Summary

ESP32-based IoT devices — including Shelly, Wiz, LIFX, Tuya, and others built on the Espressif platform — become unreachable from Windows machines over time, while remaining reachable from Linux hosts on the same subnet. The root cause is an interaction between two behaviors: (1) the ESP32's WiFi modem sleep mode (an ESP-IDF default), which causes it to miss incoming ARP requests, and (2) Windows Vista+ deliberately ignoring gratuitous ARP from unknown hosts. Together, these create a situation where Windows can never learn the device's MAC address and therefore cannot communicate with it.

This is not vendor-specific — it affects any device built on ESP-IDF that uses the default WiFi power management settings.

## Environment

- **Device**: Shelly Plus 1PM (ESP32, MAC prefix 44:17:93, Espressif)
- **Network**: Flat /21 subnet (172.20.0.0/21), UniFi infrastructure, all wired Ethernet
- **Windows host**: Windows 11 Pro, 172.20.3.39/21 (Hyper-V/WSL2 enabled, but not causal)
- **Linux host**: Raspberry Pi 4 (Debian, aarch64), 172.20.0.112/21, direct Ethernet
- **Shelly IP**: 172.20.4.58 (DHCP, visible in UniFi lease table)

## Symptoms

1. `ping 172.20.4.58` from Windows returns "Reply from 172.20.3.39: Destination host unreachable" (locally generated, ARP failure)
2. `ping 172.20.4.58` from Linux (Pi) succeeds consistently (3-10ms, TTL=255)
3. Windows ARP table (`arp -a`) has no entry for 172.20.4.58
4. Linux ARP table (`ip neigh`) has a valid entry: `172.20.4.58 lladdr 44:17:93:93:25:88`
5. Windows CAN ping other devices on the same subnet, including other Shelly devices
6. Power-cycling the Shelly immediately restores reachability from Windows

## Root Cause Analysis

Two independent behaviors interact to create this failure:

### 1. ESP32 WiFi Modem Sleep (ESP-IDF / lwIP)

The ESP32 enters WiFi modem low-power mode by default. In this mode, the radio is periodically powered down. During sleep intervals, the device cannot receive or respond to incoming frames, including ARP requests. The ESP32 compensates by sending **gratuitous ARP broadcasts** approximately every 60 seconds to announce its presence.

Reference: https://github.com/espressif/arduino-esp32/issues/2396

### 2. Windows Ignores Gratuitous ARP from Unknown Hosts

Starting with Windows Vista, Microsoft changed ARP behavior as a security measure against cache poisoning. Windows will NOT create a new ARP cache entry based on a gratuitous ARP broadcast. It will only update an **existing** entry. Linux, by contrast, uses gratuitous ARP responses from other machines to populate its neighbor table.

Reference: https://fixyacloud.wordpress.com/2020/01/27/windows-2008-ignores-gratuitous-arp-requests/

### The Interaction

| Step | Linux (works) | Windows (fails) |
|------|--------------|-----------------|
| Shelly sends gratuitous ARP | Adds/updates neighbor entry | Ignores (no existing entry) |
| Host needs to reach Shelly | Already has MAC, sends directly | Sends ARP request |
| Shelly receives ARP request? | N/A (already has entry) | No - radio is in modem sleep |
| Result | Communication succeeds | "Destination host unreachable" |

Over time, the Linux host maintains its ARP entry through the Shelly's periodic gratuitous ARP. The Windows host never acquires the entry in the first place, and its active ARP requests arrive when the Shelly's radio is asleep.

### Supporting Evidence

- Another Shelly on the same network responded to Windows ping at **1019ms** — consistent with having to wait nearly a full sleep cycle for the device to wake and process the ARP request.
- Power-cycling the Shelly (which temporarily disables modem sleep during boot) immediately restores Windows reachability.
- Other non-ESP32 devices on the same subnet are reachable from Windows without issue.

## Suggested Fixes

### On the Shelly/Espressif Side (preferred)

1. **Disable WiFi modem sleep by default**, or at least when the device is operating as a server (accepting incoming connections). The ESP-IDF call is:
   ```c
   esp_wifi_set_ps(WIFI_PS_NONE);
   ```
   Or in Arduino framework:
   ```cpp
   WiFi.setSleep(false);
   ```

2. **Respond to ARP even during light sleep** — if full modem-off sleep is required for power savings, consider waking on broadcast frames or at minimum on ARP requests matching the device's IP.

3. **Expose a "WiFi Power Save" toggle** in the Shelly device settings UI so users can disable it for wired-power devices where battery life is irrelevant (like the Plus 1PM, which is mains-powered).

### On the Network Side — ARP Proxy Solutions

The most architecturally clean network-side fix is **ARP proxying**: an always-on device answers ARP requests on behalf of sleeping ESP32 devices, so Windows gets the MAC it needs.

#### Router-Level ARP Proxy

| Option | Cost | Notes |
|--------|------|-------|
| **MikroTik router** | ~$50–200+ (RouterBOARD, hEX, etc.) | RouterOS has native `arp=proxy-arp` per interface. Set-and-forget. The gold standard for this. |
| **Ubiquiti UDM / UniFi** | Already deployed in many networks | Does **not** currently support ARP proxying. Ubiquiti should add this — it's a natural fit for UniFi's "manage your IoT fleet" positioning. Feature request worthy. |
| **OpenWrt-based router** | $0 (reflash existing) – $30+ | Supports proxy ARP via `parprouted` or kernel `proxy_arp` sysctl. Requires comfort with Linux networking. |

#### Dedicated ARP Proxy Device

| Option | Cost | Notes |
|--------|------|-------|
| **Raspberry Pi running ARP proxy** | ~$35–75 (Pi + power + SD) | Already on the network in many setups. Run `parprouted` or a targeted script using raw sockets. Can proxy for a specific IP list. |
| **Any always-on Linux box** | $0 (if already present) | `echo 1 > /proc/sys/net/ipv4/conf/<iface>/proxy_arp` enables kernel-level proxy for all hosts it has routes to. More surgical: a small script that only answers for known ESP32 IPs. |

#### Windows-Side Workarounds (per-host, no extra hardware)

| Option | Cost | Notes |
|--------|------|-------|
| **Static ARP entries** | $0 | `arp -s 172.20.4.58 44-17-93-93-25-88` — must be redone per device, fragile if MACs change (DHCP). |
| **Registry: accept gratuitous ARP** | $0 | `ArpRetryCount` and related keys — security trade-off, opens cache poisoning surface. |
| **Windows ARP listener app** | $0 | A lightweight user-space app using raw sockets (Npcap/WinPcap) can sniff gratuitous ARP broadcasts and inject the entries into the Windows ARP cache via `CreateIpNetEntry2`. The OS ignores gratuitous ARP, but an app listening on the same NIC can see them and act. This sidesteps the OS policy without modifying it. |
| **Power-cycle the device** | $0 | Temporary — device re-enters modem sleep within minutes. |

#### Recommendation

The best long-term fix is on the ESP-IDF / device firmware side. For network-level mitigation, MikroTik already solves this. For UniFi users, lobbying Ubiquiti to add per-interface ARP proxy support is worthwhile — it's a one-line kernel feature that would fix an entire class of IoT reachability bugs. A Windows ARP listener app is the cheapest option for users who can't change their router or firmware.

## Broader Impact

This affects **all** ESP32-based IoT devices using default WiFi power management settings when communicating with Windows hosts — not just Shelly. Any device built on ESP-IDF with `WIFI_PS_MIN_MODEM` or `WIFI_PS_MAX_MODEM` (the defaults) is vulnerable. Known affected product families include Shelly, Wiz, LIFX, and Tuya, plus countless other ESP32-based smart home devices.

The issue is particularly insidious because:

- It works initially (after boot/power-cycle) and fails silently over time
- It works from Linux/macOS, making it appear to be a Windows-specific bug
- It works for some devices on the same network but not others (depending on sleep timing)
- Standard network diagnostics (correct subnet, correct routing, firewall open) all check out

Any mains-powered ESP32 device acting as a server should disable WiFi modem sleep by default.

## Discovered Using

[neoping](https://github.com/BobFrankston/neoping) — a cross-platform ICMP ping tool using native OS APIs (Win32 IcmpSendEcho2 / Linux POSIX sockets via Koffi FFI), which provided consistent trace-level diagnostics across both platforms to isolate the failure to the ARP layer.
