// src/admin/upload-provider.ts (Node/Deno runtime — uses @aws-sdk/client-s3)
//
// Same contract as the Bun provider, but uses the official AWS SDK so it works
// without Bun. Install: npm i @aws-sdk/client-s3
//
// Note: adminjs-elysia itself requires Bun to serve static assets, so this
// template is useful only when you've forked the adapter or you're running
// AdminJS behind a different Elysia-compatible framework.

import fs from "node:fs";
import path from "node:path";
import {
    DeleteObjectCommand,
    PutObjectCommand,
    S3Client,
} from "@aws-sdk/client-s3";
import { BaseProvider } from "@adminjs/upload";
import type { ActionContext, UploadedFile } from "adminjs";

import { config } from "../config";

const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    credentials: {
        accessKeyId: config.S3_ACCESS,
        secretAccessKey: config.S3_SECRET,
    },
    forcePathStyle: true, // required for MinIO / R2 path-style addressing
});

class PrefixedS3Provider extends BaseProvider {
    constructor(bucket: string, private prefix: string) {
        super(bucket);
    }

    async upload(file: UploadedFile, key: string, _ctx: ActionContext) {
        const arrayBuffer = await (file as unknown as Blob).arrayBuffer();
        await s3.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: `${this.prefix}/${key}`,
            Body: new Uint8Array(arrayBuffer),
            ContentType: file.type,
        }));
    }

    async delete(key: string, _bucket: string, _ctx: ActionContext) {
        await s3.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: `${this.prefix}/${key}`,
        }));
    }

    path(key: string, _bucket: string, _ctx: ActionContext): string {
        return `${config.S3_STATIC_URL}/${this.prefix}/${key}`;
    }
}

class LocalFallbackProvider extends BaseProvider {
    constructor(private dir: string, private baseUrl: string) { super(dir); }

    async upload(file: UploadedFile, key: string) {
        const dest = path.join(this.dir, key);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        const buffer = Buffer.from(await (file as unknown as Blob).arrayBuffer());
        await fs.promises.writeFile(dest, buffer);
    }

    async delete(key: string) {
        await fs.promises.unlink(path.join(this.dir, key)).catch(() => {});
    }

    path(key: string) { return `${this.baseUrl}/${key}`; }
}

export function createProvider(prefix: string): BaseProvider {
    if (config.S3_ENDPOINT && config.S3_BUCKET && config.S3_ACCESS) {
        return new PrefixedS3Provider(config.S3_BUCKET, prefix);
    }
    return new LocalFallbackProvider(
        path.resolve(`uploads/${prefix}`),
        `/uploads/${prefix}`,
    );
}
