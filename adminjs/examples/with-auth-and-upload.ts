// examples/with-auth-and-upload.ts
// Production-shape single-file example: auth, Bun S3 uploads, custom record action,
// before/after hooks, navigation groups, rich text.
//
// Requires .env with:
//   ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_COOKIE_SECRET
//   S3_BUCKET, S3_ENDPOINT, S3_ACCESS, S3_SECRET, S3_REGION
//
// Run: bun examples/with-auth-and-upload.ts

import path from "node:path";
import uploadFileFeature from "@adminjs/upload";
import { BaseProvider } from "@adminjs/upload";
import { dark, light } from "@adminjs/themes";
import AdminJS, { ComponentLoader, DefaultAuthProvider } from "adminjs";
import type { ActionContext, ActionRequest, ActionResponse, UploadedFile } from "adminjs";
import * as PgAdapter from "adminjs-drizzle/pg";
import { buildAuthenticatedRouter, buildRouter } from "adminjs-elysia";
import { S3Client } from "bun";
import { drizzle } from "drizzle-orm/postgres-js";
import {
    boolean,
    integer,
    jsonb,
    pgTable,
    serial,
    text,
    timestamp,
} from "drizzle-orm/pg-core";
import Elysia from "elysia";
import postgres from "postgres";

// ─── Config ────────────────────────────────────────────────────────────────
const env = (k: string, d = "") => process.env[k] ?? d;
const config = {
    DATABASE_URL: env("DATABASE_URL", "postgres://localhost/test"),
    ADMIN_EMAIL: env("ADMIN_EMAIL"),
    ADMIN_PASSWORD: env("ADMIN_PASSWORD"),
    ADMIN_COOKIE_SECRET: env("ADMIN_COOKIE_SECRET"),
    S3_BUCKET: env("S3_BUCKET"),
    S3_ENDPOINT: env("S3_ENDPOINT"),
    S3_REGION: env("S3_REGION", "auto"),
    S3_ACCESS: env("S3_ACCESS"),
    S3_SECRET: env("S3_SECRET"),
    S3_STATIC_URL: env("S3_STATIC_URL", `${env("S3_ENDPOINT")}/${env("S3_BUCKET")}`),
};

// ─── Schema ────────────────────────────────────────────────────────────────
const articlesTable = pgTable("articles", {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content"),
    summary: text("summary"),
    posterPath: text("poster_path"),
    posterMimeType: text("poster_mime_type"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    order: integer("order").default(0),
    isPublished: boolean("is_published").default(false),
    createdAt: timestamp("created_at").defaultNow(),
});

const db = drizzle(postgres(config.DATABASE_URL), { schema: { articles: articlesTable } });

// ─── S3 provider ───────────────────────────────────────────────────────────
const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS,
    secretAccessKey: config.S3_SECRET,
    bucket: config.S3_BUCKET,
});

class PrefixedS3Provider extends BaseProvider {
    constructor(bucket: string, private prefix: string) { super(bucket); }

    async upload(file: UploadedFile, key: string, _ctx: ActionContext) {
        await s3.write(`${this.prefix}/${key}`, file as unknown as Blob, { type: file.type });
    }
    async delete(key: string, _bucket: string, _ctx: ActionContext) {
        await s3.delete(`${this.prefix}/${key}`);
    }
    path(key: string, _bucket: string, _ctx: ActionContext): string {
        return `${config.S3_STATIC_URL}/${this.prefix}/${key}`;
    }
}

// ─── AdminJS setup ─────────────────────────────────────────────────────────
AdminJS.registerAdapter(PgAdapter);

const componentLoader = new ComponentLoader();

// Visibility helpers
const READONLY = { isDisabled: true };
const HIDDEN = { isVisible: false };

// Hooks
function sortByOrder(request: ActionRequest) {
    if (!request.query?.sortBy) {
        request.query = { ...request.query, sortBy: "order", direction: "asc" };
    }
    return request;
}

function summaryHook() {
    return async (response: ActionResponse, request: ActionRequest) => {
        if (request.method !== "post") return response;
        const { record } = response;
        if (record?.params?.content) {
            const text = String(record.params.content).replace(/<[^>]+>/g, " ").slice(0, 200);
            record.params.summary = text;
        }
        return response;
    };
}

const admin = new AdminJS({
    rootPath: "/admin",
    componentLoader,
    defaultTheme: dark.id,
    availableThemes: [dark, light],
    branding: { companyName: "Example Admin", logo: false, withMadeWithLove: false },
    // @ts-expect-error — over-broad Resource generic from adminjs-drizzle
    resources: [
        {
            resource: { table: articlesTable, db },
            options: {
                navigation: { name: "Content", icon: "Book" },
                listProperties: ["id", "title", "posterFile", "order", "isPublished", "createdAt"],
                properties: {
                    id:             READONLY,
                    content:        { type: "richtext" },
                    summary:        { isDisabled: true, description: "Auto-computed on save." },
                    posterPath:     HIDDEN,
                    posterMimeType: HIDDEN,
                    metadata:       { type: "mixed" },
                    createdAt:      READONLY,
                },
                actions: {
                    list: { before: [sortByOrder] },
                    new:  { after:  [summaryHook()] },
                    edit: { after:  [summaryHook()] },

                    publish: {
                        actionType: "record",
                        icon: "Send",
                        guard: "Publish this article?",
                        isAccessible: ({ record }) => {
                            const pub = record?.params.is_published;
                            return !(pub === true || pub === "true");
                        },
                        handler: async (_req, _res, context) => {
                            try {
                                // ...real logic here...
                                return {
                                    record: context.record.toJSON(context.currentAdmin),
                                    notice: { message: "Published", type: "success" as const },
                                };
                            } catch (error) {
                                return {
                                    record: context.record.toJSON(context.currentAdmin),
                                    notice: {
                                        message: error instanceof Error ? error.message : "Unknown error",
                                        type: "error" as const,
                                    },
                                };
                            }
                        },
                    },
                },
            },
            features: [
                uploadFileFeature({
                    componentLoader,
                    provider: new PrefixedS3Provider(config.S3_BUCKET, "articles"),
                    properties: {
                        key: "posterPath",
                        file: "posterFile",
                        mimeType: "posterMimeType",
                    },
                    uploadPath: (_record, filename) =>
                        `${crypto.randomUUID()}${path.extname(filename)}`,
                    validation: {
                        mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"],
                        maxSize: 5 * 1024 * 1024,
                    },
                }),
            ],
        },
    ],
});

// ─── Router ────────────────────────────────────────────────────────────────
async function createRouter() {
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
        return buildRouter(admin, {});
    }
    const provider = new DefaultAuthProvider({
        componentLoader,
        authenticate: async ({ email, password }) => {
            if (email === config.ADMIN_EMAIL && password === config.ADMIN_PASSWORD) return { email };
            return null;
        },
    });
    return buildAuthenticatedRouter(
        admin,
        {
            provider,
            cookiePassword: config.ADMIN_COOKIE_SECRET,
            cookieName: "adminjs", // explicit — v0.1.4 has inconsistent defaults
        },
        {},
    );
}

const adminRouter = new Elysia({ detail: { hide: true } }).use(await createRouter());

new Elysia()
    .onError(({ error, code }) => { console.error("[admin]", code, error); })
    .use(adminRouter)
    .get("/", () => "visit /admin")
    .listen(3000, () => console.log("→ http://localhost:3000/admin"));
