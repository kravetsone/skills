// src/admin/upload-provider.ts (Bun runtime)
// Custom BaseProvider for @adminjs/upload that:
//   1. Treats `file` as a Web API Blob (Elysia's shape) — not formidable `{ path }`
//   2. Prefixes every key so multiple resources can share one bucket
//   3. Falls back to LocalProvider when S3 is unconfigured (dev)
//
// Requires Bun ≥ 1.1 (uses Bun's built-in S3Client).

import fs from "node:fs";
import path from "node:path";
import { BaseProvider } from "@adminjs/upload";
import type { ActionContext, UploadedFile } from "adminjs";
import { S3Client } from "bun";

import { config } from "../config";

// ─── S3 client (single, reused for all providers) ───────────────────────────
const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS,
    secretAccessKey: config.S3_SECRET,
    bucket: config.S3_BUCKET,
});

// ─── S3 provider with prefix namespacing ────────────────────────────────────
class PrefixedS3Provider extends BaseProvider {
    private prefix: string;

    constructor(bucket: string, prefix: string) {
        super(bucket);
        this.prefix = prefix;
    }

    async upload(file: UploadedFile, key: string, _ctx: ActionContext) {
        // adminjs-elysia passes Web API File (Blob) objects — NOT formidable objects
        const blob = file as unknown as Blob;
        await s3.write(`${this.prefix}/${key}`, blob, { type: file.type });
    }

    async delete(key: string, _bucket: string, _ctx: ActionContext) {
        await s3.delete(`${this.prefix}/${key}`);
    }

    path(key: string, _bucket: string, _ctx: ActionContext): string {
        return `${config.S3_STATIC_URL}/${this.prefix}/${key}`;
    }
}

// ─── Elysia-compatible LocalProvider (dev fallback) ─────────────────────────
// The built-in LocalProvider expects formidable's `{ buffer }` on the file —
// under Elysia the file is a Blob. This compat version bridges the gap.
class ElysiaLocalProvider extends BaseProvider {
    constructor(private dir: string, private baseUrl: string) {
        super(dir);
    }

    async upload(file: UploadedFile, key: string, _ctx: ActionContext) {
        const dest = path.join(this.dir, key);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        const buffer = Buffer.from(await (file as unknown as Blob).arrayBuffer());
        await fs.promises.writeFile(dest, buffer);
    }

    async delete(key: string, _bucket: string, _ctx: ActionContext) {
        await fs.promises.unlink(path.join(this.dir, key)).catch(() => {});
    }

    path(key: string, _bucket: string, _ctx: ActionContext): string {
        return `${this.baseUrl}/${key}`;
    }
}

// ─── Factory ────────────────────────────────────────────────────────────────
export function createProvider(prefix: string): BaseProvider {
    if (config.S3_ENDPOINT && config.S3_BUCKET && config.S3_ACCESS) {
        return new PrefixedS3Provider(config.S3_BUCKET, prefix);
    }

    // eslint-disable-next-line no-console
    console.warn(`[admin] S3 unconfigured — using LocalProvider for "${prefix}"`);
    return new ElysiaLocalProvider(
        path.resolve(`uploads/${prefix}`),
        `/uploads/${prefix}`,
    );
}
