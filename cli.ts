/**
 * neoping CLI — thin wrapper over the neoping API.
 * Called from neoping.ts via import.meta.main.
 */

import { createRequire } from "node:module";
import { styleText } from "node:util";
import { ping, getDiagnostics } from "./neoping.js";
import type { PingOptions, PingResult } from "./icmp-types.js";

const require = createRequire(import.meta.url);
const { version } = require("./package.json");

function usage() {
    console.log("neoping — cross-platform low-level ICMP ping");
    console.log("");
    console.log("Usage: neoping <host> [host2 ...] [options]");
    console.log("");
    console.log("Options:");
    console.log("  -c <n>       Pings per host (default 4)");
    console.log("  -t <ms>      Timeout in ms (default 4000)");
    console.log("  -i <ms>      Interval in ms (default 1000)");
    console.log("  -ttl <n>     TTL (default 128)");
    console.log("  -s <n>       Payload bytes (default 32)");
    console.log("  -4           Force IPv4 (default)");
    console.log("  -6           Force IPv6 (limited — backends are IPv4-only)");
    console.log("  -sudo        Escalate if unprivileged fails");
    console.log("  -rdns        Reverse-DNS lookup for IP targets");
    console.log("  -json        JSON output");
    console.log("  -trace       Debug trace to stderr");
    console.log("  -diag        Platform diagnostics");
    console.log("  -v           Show version");
    console.log("  -h           This help");
}

/** Print a summary table: Host | Address | min | avg | max | loss */
function printTable(results: PingResult[]) {
    const showCount = results.some(r => r.stats.sent > 1);

    // Compute column widths
    const rows = results.map(r => {
        const host = r.host !== r.address ? r.host : "";
        const s = r.stats;
        return {
            host,
            address: r.address || "unresolved",
            min: s.minRtt >= 0 ? s.minRtt.toFixed(1) : "-",
            avg: s.avgRtt >= 0 ? s.avgRtt.toFixed(1) : "-",
            max: s.maxRtt >= 0 ? s.maxRtt.toFixed(1) : "-",
            loss: `${s.lossPercent}%`,
            sent: `${s.sent}`,
        };
    });

    const headers: Record<string, string> = { host: "Host", address: "Address", min: "Min(ms)", avg: "Avg(ms)", max: "Max(ms)", loss: "Loss", sent: "Sent" };
    const cols = ["host", "address", "min", "avg", "max", "loss", "sent"];

    // Measure widths
    const widths: Record<string, number> = {};
    for (const col of cols) {
        widths[col] = headers[col].length;
        for (const row of rows) {
            widths[col] = Math.max(widths[col], (row as Record<string, string>)[col].length);
        }
    }

    // Skip host column if no DNS names were used; skip sent column if count == 1
    const showHost = rows.some(r => r.host !== "");
    let activeCols = showHost ? cols : cols.filter(c => c !== "host");
    if (!showCount) activeCols = activeCols.filter(c => c !== "sent");

    // RTT columns are right-aligned, others left
    const rightAlign = new Set(["min", "avg", "max", "loss", "sent"]);
    const pad = (val: string, col: string) =>
        rightAlign.has(col) ? val.padStart(widths[col]) : val.padEnd(widths[col]);

    // Header
    const headerLine = activeCols.map(c => pad(headers[c], c)).join("  ");
    console.log(styleText("bold", headerLine));
    console.log(activeCols.map(c => "-".repeat(widths[c])).join("  "));

    // Rows
    for (const row of rows) {
        const r = row as Record<string, string>;
        const lossNum = parseInt(row.loss);
        const lossColor = lossNum === 0 ? "green" : lossNum === 100 ? "red" : "yellow";

        const cells = activeCols.map(c => {
            const val = pad(r[c], c);
            if (c === "loss") return styleText(lossColor as any, val);
            if (rightAlign.has(c) && r[c] !== "-") return styleText("cyan", val);
            return val;
        });
        console.log(cells.join("  "));
    }

}

export async function main() {
    const args = process.argv.slice(2);
    const hosts: string[] = [];
    const opts: PingOptions = {};
    let jsonOutput = false;
    let showDiag = false;

    const requireInt = (flag: string, val: string | undefined): number => {
        const n = parseInt(val ?? "");
        if (isNaN(n)) {
            console.error(`${flag} requires a numeric argument (got "${val ?? ""}")`);
            process.exit(1);
        }
        return n;
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "-h":
                usage();
                process.exit(0);
            case "-v":
            case "-version":
                console.log(`neoping v${version}`);
                process.exit(0);
            case "-c":
                opts.count = requireInt("-c", args[++i]);
                break;
            case "-t":
                opts.timeout = requireInt("-t", args[++i]);
                break;
            case "-i":
                opts.interval = requireInt("-i", args[++i]);
                break;
            case "-ttl":
                opts.ttl = requireInt("-ttl", args[++i]);
                break;
            case "-s":
                opts.size = requireInt("-s", args[++i]);
                break;
            case "-4":
                opts.family = 4;
                break;
            case "-6":
                opts.family = 6;
                break;
            case "-sudo":
                opts.sudo = true;
                break;
            case "-rdns":
                opts.rdns = true;
                break;
            case "-trace":
                opts.trace = true;
                break;
            case "-json":
                jsonOutput = true;
                break;
            case "-diag":
                showDiag = true;
                break;
            default:
                if (arg.startsWith("-")) {
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
                }
                hosts.push(arg);
        }
    }

    if (showDiag) {
        const diag = await getDiagnostics();
        if (jsonOutput) {
            console.log(JSON.stringify(diag, null, 2));
        } else {
            console.log(styleText("bold", "Platform Diagnostics"));
            console.log(`  Platform: ${diag.platform} (${diag.arch})`);
            console.log(`  Node.js:  ${diag.nodeVersion}`);
            console.log(`  Backend:  ${diag.backend}`);
            for (const d of diag.details) {
                console.log(`  ${d}`);
            }
        }
        if (hosts.length === 0) process.exit(0);
        console.log("");
    }

    if (hosts.length === 0) {
        usage();
        process.exit(1);
    }

    try {
        const results = await ping(hosts, opts);

        if (jsonOutput) {
            const output = showDiag ? results : results.map(({ diagnostics, ...rest }) => rest);
            console.log(JSON.stringify(output, null, 2));
        } else {
            printTable(results);
        }

        // Exit code: 0 if any host replied, 1 if all failed
        const anyAlive = results.some(r => r.stats.received > 0);
        process.exit(anyAlive ? 0 : 1);
    } catch (e: any) {
        console.error(styleText("red", `Error: ${e.message}`));
        process.exit(2);
    }
}

if (import.meta.main) {
    await main();
}
