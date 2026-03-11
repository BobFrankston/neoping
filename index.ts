#!/usr/bin/env node
import { main } from "./cli.js";

if (import.meta.main) {
    await main();
}
