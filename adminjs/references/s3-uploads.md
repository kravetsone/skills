# S3 uploads (`@adminjs/upload` with Elysia)

`@adminjs/upload` adds upload fields to any AdminJS resource. Under the official Express/Fastify integration it "just works" because those adapters parse multipart via formidable into `{ path, type, name, size }` objects. **Under `adminjs-elysia` that contract is broken** — Elysia delivers Web API `File` (Blob) objects, and the package's built-in `AWSProvider` / `GCPProvider` expect `file.path`. You must always write a custom `BaseProvider` subclass.

## The `uploadFileFeature` options

Signature (from `node_modules/@adminjs/upload/types/features/upload-file/types/upload-options.type.d.ts`):

```typescript
uploadFileFeature({
    componentLoader: ComponentLoader,
    provider: BaseProvider | { aws?: ..., gcp?: ..., local?: ... },  // pass a BaseProvider, see below
    properties: {
        key: string;               // DB column storing the file KEY (path in bucket)
        file?: string;             // virtual field used by the frontend — default "file"
        filesToDelete?: string;    // virtual — default "filesToDelete" (only matters w/ multiple)
        filePath?: string;         // virtual — default "filePath" (exposed public URL)
        bucket?: string;           // DB column for a per-record bucket override (rare)
        mimeType?: string;         // DB column storing MIME type — enables correct icon
        size?: string;             // DB column storing byte size
        filename?: string;         // DB column storing original filename
    },
    uploadPath?: (record, filename) => string,  // where in bucket — default `${record.id()}/${filename}`
    multiple?: boolean,
    validation?: {
        mimeTypes?: string[];      // e.g. ["image/png", "image/jpeg"]
        maxSize?: number;          // bytes
    },
})
```

### Properties — what each one does

- **`key`** (required): column that stores the storage path/key. This is what the provider reads/writes on upload/delete. Do NOT put the public URL here — the URL is computed by `provider.path(key)`.
- **`file`**: virtual property name the frontend uses to submit the new file. Changing this only matters when you have **multiple** upload features on the same resource (you MUST rename it so they don't collide).
- **`filePath`**: virtual property that receives the **public URL** — `provider.path(key)` is called once per record render. Your React view (show/list) reads this.
- **`mimeType`**: column storing the MIME type. Enables AdminJS's file-icon chooser (shows a proper image preview vs a generic document icon). Optional but recommended.
- **`filesToDelete`**: virtual, only used in `multiple: true` mode — holds the keys of files the user unchecked, so the feature can delete them on save.

### Validation

```typescript
validation: {
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
    maxSize: 5 * 1024 * 1024, // 5 MiB
},
```

Client-side validation rejects bad mime types immediately. Server-side validation checks again before calling `provider.upload`.

## `BaseProvider` contract

```typescript
abstract class BaseProvider {
    name: string;
    bucket: string;
    opts?: { baseUrl?: string };

    constructor(bucket: string, opts?: ProviderOpts);

    upload(file: UploadedFile, key: string, context: ActionContext): Promise<any>;
    delete(key: string, bucket: string, context: ActionContext): Promise<any>;
    path(key: string, bucket: string, context: ActionContext): Promise<string> | string;
}
```

Three methods you must implement:

- **`upload(file, key, ctx)`** — store bytes. Under Elysia, `file` is a `File`/`Blob`. Use `file.arrayBuffer()`, `file.stream()`, or pass `file as Blob` directly to `Bun.s3.write` / AWS SDK `PutObjectCommand` (its `Body` accepts `Blob`).
- **`delete(key, bucket, ctx)`** — delete object by key.
- **`path(key, bucket, ctx)`** — return the public URL. `@adminjs/upload` writes this into the virtual `filePath` field on each record render. Can return sync string or async string (for signed URLs).

## Bun-native S3 provider (recommended on Bun)

Bun ≥1.1 ships a native `S3Client` — zero deps, works with MinIO, Cloudflare R2, AWS S3, Backblaze B2, any S3-compatible store.

```typescript
// src/services/s3.ts
import { S3Client } from "bun";
import { config } from "../config";

export const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS,
    secretAccessKey: config.S3_SECRET,
    bucket: config.S3_BUCKET,
});

export async function uploadToS3(key: string, body: Blob | Buffer | string, contentType?: string) {
    await s3.write(key, body, contentType ? { type: contentType } : undefined);
}

export async function deleteFromS3(key: string) {
    await s3.delete(key);
}
```

```typescript
// src/admin/upload-provider.ts
import { BaseProvider } from "@adminjs/upload";
import type { ActionContext, UploadedFile } from "adminjs";
import { config } from "../config";
import { deleteFromS3, uploadToS3 } from "../services/s3";

class PrefixedS3Provider extends BaseProvider {
    private prefix: string;

    constructor(bucket: string, prefix: string) {
        super(bucket);
        this.prefix = prefix;
    }

    async upload(file: UploadedFile, key: string, _ctx: ActionContext) {
        // file is a Web API File/Blob under adminjs-elysia
        await uploadToS3(`${this.prefix}/${key}`, file as unknown as Blob, file.type);
    }

    async delete(key: string, _bucket: string, _ctx: ActionContext) {
        await deleteFromS3(`${this.prefix}/${key}`);
    }

    path(key: string, _bucket: string, _ctx: ActionContext): string {
        return `${config.S3_STATIC_URL}/${this.prefix}/${key}`;
    }
}

export function createProvider(prefix: string): BaseProvider {
    if (config.S3_BUCKET && config.S3_ENDPOINT) {
        return new PrefixedS3Provider(config.S3_BUCKET, prefix);
    }
    // Dev fallback — store on local disk at uploads/<prefix>/<key>
    // Dynamic import is safer under ESM than require()
    const { LocalProvider } = require("@adminjs/upload") as typeof import("@adminjs/upload");
    return new LocalProvider({ bucket: `uploads/${prefix}`, opts: {} });
}
```

See [templates/upload-provider-bun.ts](../templates/upload-provider-bun.ts) for a copy-paste version.

### Why the `prefix` wrapper

Bun's `S3Client` is configured with a single bucket. If you want articles, avatars, and icons in the same bucket but under different folders, the provider prepends a prefix — `articles/`, `avatars/`, etc. Create one provider per resource/feature:

```typescript
features: [
    uploadFileFeature({ ...configFor(articlesTable), provider: createProvider("articles") }),
],
```

This also lets you nuke a whole category in S3 with a prefix delete, and makes `S3_STATIC_URL` → `<base>/<bucket>/<prefix>/<key>` trivially scoped.

### `S3_STATIC_URL` — the public URL base

You need a computed env value:

```typescript
// config.ts
get S3_STATIC_URL() {
    if (this.STATIC_URL) return this.STATIC_URL;              // CDN override
    if (!this.S3_ENDPOINT) return "";
    const base = this.S3_ENDPOINT.startsWith("http")
        ? this.S3_ENDPOINT
        : `https://${this.S3_ENDPOINT}`;
    return `${base}/${this.S3_BUCKET}`;
}
```

With MinIO at `https://s3.example.com` and bucket `static`, public URLs are `https://s3.example.com/static/articles/<uuid>.png`. If you front it with a CDN (e.g. Cloudflare), set `STATIC_URL=https://cdn.example.com/static` to override.

## AWS SDK provider (Node/Deno)

If you're not on Bun, swap `Bun.S3Client` for `@aws-sdk/client-s3`:

```typescript
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { BaseProvider } from "@adminjs/upload";

const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    credentials: { accessKeyId: config.S3_ACCESS, secretAccessKey: config.S3_SECRET },
    forcePathStyle: true, // required for MinIO / R2
});

class S3SdkProvider extends BaseProvider {
    async upload(file: UploadedFile, key: string) {
        const arrayBuffer = await (file as unknown as Blob).arrayBuffer();
        await s3.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: new Uint8Array(arrayBuffer),
            ContentType: file.type,
        }));
    }

    async delete(key: string) {
        await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }

    path(key: string) {
        return `${config.S3_STATIC_URL}/${key}`;
    }
}
```

See [templates/upload-provider-aws-sdk.ts](../templates/upload-provider-aws-sdk.ts).

## Multiple upload features per resource

A single resource can have multiple independent file fields (avatar + banner, product image + currency image, etc.). Each `uploadFileFeature` needs **distinct virtual property names** — otherwise they collide and only one wires up:

```typescript
features: [
    uploadFileFeature({
        componentLoader, provider: createProvider("game-promotions"),
        properties: {
            key: "imagePath", file: "imageFile", mimeType: "imageMimeType",
            filePath: "imageFilePath", filesToDelete: "imageFilesToDelete",
        },
        uploadPath: (_r, name) => `${crypto.randomUUID()}${extname(name)}`,
        validation: { mimeTypes: IMAGE_MIME_TYPES },
    }),
    uploadFileFeature({
        componentLoader, provider: createProvider("game-promotions-currency"),
        properties: {
            key: "currencyImagePath", file: "currencyImageFile", mimeType: "currencyImageMimeType",
            filePath: "currencyImageFilePath", filesToDelete: "currencyImageFilesToDelete",
        },
        uploadPath: (_r, name) => `${crypto.randomUUID()}${extname(name)}`,
        validation: { mimeTypes: IMAGE_MIME_TYPES },
    }),
],
```

The virtual property names (`imageFile`, `imageFilePath`, `imageFilesToDelete`, `currencyImageFile`, etc.) are namespaces; you never see them in the schema. The **real** DB columns are `imagePath` + `imageMimeType` and `currencyImagePath` + `currencyImageMimeType`.

Hide the raw `*Path` / `*MimeType` columns from the form — the upload widget is the edit UI for them:

```typescript
properties: {
    imagePath: HIDDEN,
    imageMimeType: HIDDEN,
    currencyImagePath: HIDDEN,
    currencyImageMimeType: HIDDEN,
},
```

## `uploadPath` — where the file actually lands

The function receives the record and the uploaded filename, returns the key within the bucket. Common patterns:

```typescript
// Per-record stable path — good when replacing the file keeps the same URL (implicit)
uploadPath: (record, filename) => `${record.id()}/${filename}`

// UUID-keyed, extension-preserved — avoids cache issues and filename collisions
uploadPath: (_record, filename) => `${crypto.randomUUID()}${path.extname(filename)}`

// Date-sharded — good for high-volume user uploads
uploadPath: (_record, filename) =>
    `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}${path.extname(filename)}`
```

Default is `${record.id()}/${filename}`. If `record.id()` isn't stable at upload time (e.g. the record is being created and has no id yet), switch to UUID.

## Schema columns for each upload feature

You need at minimum one column per feature (`key`). With `mimeType` (recommended), that's two:

```typescript
// Drizzle schema snippet
export const articlesTable = pgTable("articles", {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    posterPath: text("poster_path"),          // key — stored in DB
    posterMimeType: text("poster_mime_type"), // mime — stored in DB
    // virtual fields (imageFile, imageFilePath, imageFilesToDelete) are NOT in the schema
});
```

The virtual `filePath` field is computed on-the-fly by `provider.path(key)` and exposed to the frontend only — it never touches the DB.

## Dev fallback — LocalProvider

For local development without S3, fall back to `LocalProvider` which writes to a folder. You also need to serve the folder as static content:

```typescript
// src/admin/upload-provider.ts — fallback branch
const { LocalProvider } = require("@adminjs/upload");
return new LocalProvider({ bucket: `uploads/${prefix}`, opts: {} });
```

```typescript
// src/index.ts — serve /uploads as static
import { staticPlugin } from "@elysiajs/static";

new Elysia()
    .use(staticPlugin({ assets: "uploads", prefix: "/uploads" }))
    .use(adminRouter)
    .listen(3000);
```

`LocalProvider.path(key)` returns `/public/<bucket>/<key>` by default; set `opts.baseUrl` to control the URL prefix:

```typescript
new LocalProvider({ bucket: `uploads/${prefix}`, opts: { baseUrl: "/uploads" } });
```

**Important:** `LocalProvider` writes files with `fs.writeFileSync(path, fileBuffer)` — it expects `file.buffer` from formidable. Under Elysia, `file` is a `Blob`, not a `{ buffer }` object. You need to wrap it:

```typescript
class ElysiaCompatLocalProvider extends BaseProvider {
    constructor(public dir: string, private baseUrl: string) {
        super(dir);
    }
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
```

See [templates/upload-provider-bun.ts](../templates/upload-provider-bun.ts) for both branches unified.

## Error modes and fixes

| Symptom | Cause | Fix |
|---|---|---|
| Uploaded file saves as `undefined` or `[object File]` | Using `provider: { aws: {...} }` (built-in AWS provider) under Elysia | Write a custom `BaseProvider`; treat `file` as `Blob` |
| `file.path is undefined` in custom provider | Copy-pasted from old Express example | Replace `fs.createReadStream(file.path)` with `file.arrayBuffer()` or pass `file as Blob` |
| Image renders fine in show, broken in list | No `filePath` virtual column set up for list view | Include `filePath: "imageFilePath"` in the feature properties |
| Multiple features on same resource, only one works | Colliding default virtual property names (`file`, `filePath`, `filesToDelete`) | Rename each feature's virtual props to unique names |
| `MimeType validation error` on valid file | Browser-reported MIME differs from `file.type` | Widen `validation.mimeTypes` or use `@gramio/...` style magic-byte sniffing server-side |
| File uploaded, record saved, but URL 404s on next request | Key vs path confusion — `provider.path()` doesn't match where `provider.upload()` put it | Ensure both methods apply the same `prefix` / key transformation |
| `LocalProvider` crashes with `ENOENT` | Auto-creating nested dirs not on by default | Wrap with a compat provider that does `mkdir -p` (see above) |
| R2/MinIO: 301 redirect loop on `provider.path(...)` | Returning a URL without bucket in path-style S3 | Set `forcePathStyle: true` in the AWS SDK client; for Bun, use `endpoint: "https://<account>.r2.cloudflarestorage.com"` |

## Signed URLs (for private buckets)

If your bucket is private, `provider.path()` needs to return a **signed** URL:

```typescript
import { s3 } from "../services/s3";

class SignedS3Provider extends BaseProvider {
    async path(key: string) {
        return await s3.presign(`${this.prefix}/${key}`, { expiresIn: 3600 });
    }
    // upload + delete same as PrefixedS3Provider
}
```

Because AdminJS calls `provider.path()` once per record render, signed URLs expire per page load — set `expiresIn` generously (1h+) or enable same-origin caching.

## Verifying the provider contract on upgrade

```bash
cat node_modules/@adminjs/upload/types/features/upload-file/providers/base-provider.d.ts
```

If `upload`, `delete`, or `path` signatures change, update your provider. `@adminjs/upload@5+` (not released as of writing) is expected to change the file shape to Blob upstream — at that point you can delete the `as unknown as Blob` cast.
