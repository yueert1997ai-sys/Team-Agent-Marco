import { cp, mkdir, rm } from "node:fs/promises";

const source = new URL("../src/ui/", import.meta.url);
const target = new URL("../dist/src/ui/", import.meta.url);
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
