// src/admin/resources.ts
// getResources() skeleton with helper constants, navigation groups, upload feature,
// before/after hooks, and a custom record action. Adapt to your tables.

import path from "node:path";
import uploadFileFeature from "@adminjs/upload";
import type { ActionRequest, ActionResponse, ComponentLoader } from "adminjs";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { articlesTable, usersTable } from "../db/schema";
import { createProvider } from "./upload-provider";
import { Components } from "./index"; // uncomment if you add custom action components

// ─── Helper constants ───────────────────────────────────────────────────────
const READONLY    = { isDisabled: true };
const HIDDEN      = { isVisible: false };
const SHOW_ONLY   = { isVisible: { list: false, show: true, edit: false, filter: false } };
const EDIT_ONLY   = { isVisible: { list: false, show: true, edit: true, filter: false } };
const FILTER_ONLY = { isVisible: { list: false, show: true, edit: false, filter: true } };

const IMAGE_MIME_TYPES = [
    "image/bmp",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/tiff",
    "image/webp",
] as const;

// ─── Reusable hooks ─────────────────────────────────────────────────────────

/** Default-sort the list view by `order` ascending. Attach to `list.before`. */
function sortByOrder(request: ActionRequest) {
    if (!request.query?.sortBy) {
        request.query = { ...request.query, sortBy: "order", direction: "asc" };
    }
    return request;
}

/** After-save hook factory — recompute a derived column via an async service. */
function derivedSummaryHook(db: PostgresJsDatabase) {
    return async (response: ActionResponse, request: ActionRequest) => {
        if (request.method !== "post") return response;
        const { record } = response;
        if (record?.params?.content) {
            // Replace with your actual service
            const summary = String(record.params.content).slice(0, 200);
            await db
                .update(articlesTable)
                .set({ summary })
                .where(eq(articlesTable.id, record.params.id));
            record.params.summary = summary;
        }
        return response;
    };
}

// ─── Resources ──────────────────────────────────────────────────────────────

export function getResources(
    db: PostgresJsDatabase,
    componentLoader: ComponentLoader,
) {
    return [
        // ─── Users ──────────────────────────────────────────────────────────
        {
            resource: { table: usersTable, db },
            options: {
                navigation: { name: "Users", icon: "Users" },
                listProperties: ["id", "email", "name", "isBanned", "createdAt"],
                properties: {
                    id:            READONLY,
                    internalNotes: HIDDEN,
                    termsAcceptedAt: SHOW_ONLY,
                    createdAt:     READONLY,
                },
            },
        },

        // ─── Articles (with upload feature + hooks + custom action) ─────────
        {
            resource: { table: articlesTable, db },
            options: {
                navigation: { name: "Content", icon: "Book" },
                listProperties: ["id", "title", "posterFile", "order", "publishedAt"],
                properties: {
                    id:             READONLY,
                    content:        { type: "richtext" },
                    description:    { type: "textarea" },
                    posterPath:     HIDDEN,
                    posterMimeType: HIDDEN,
                    summary: {
                        isDisabled: true,
                        description: "Auto-generated from content on save.",
                    },
                    order: {
                        description: "Lower appears first in the app.",
                    },
                    createdAt: READONLY,
                    updatedAt: READONLY,
                },
                actions: {
                    list: { before: [sortByOrder] },
                    new:  { after:  [derivedSummaryHook(db)] },
                    edit: { after:  [derivedSummaryHook(db)] },

                    // Example custom record action — opens a modal with Components.PromoUpload
                    // uncomment + adapt once you've added the component
                    /*
                    importCsv: {
                        actionType: "record",
                        icon: "Upload",
                        component: Components.PromoUpload,
                        handler: async (request, _response, context) => {
                            if (request.method !== "post") {
                                return { record: context.record.toJSON(context.currentAdmin) };
                            }
                            const csvText = (request.payload as { csvText?: string })?.csvText?.trim();
                            if (!csvText) {
                                return {
                                    record: context.record.toJSON(context.currentAdmin),
                                    notice: { message: "CSV is empty", type: "error" as const },
                                };
                            }
                            // ...do work...
                            return {
                                record: context.record.toJSON(context.currentAdmin),
                                notice: { message: "Imported", type: "success" as const },
                            };
                        },
                    },
                    */
                },
            },
            features: [
                uploadFileFeature({
                    componentLoader,
                    provider: createProvider("articles"),
                    properties: {
                        key: "posterPath",
                        file: "posterFile",
                        mimeType: "posterMimeType",
                    },
                    uploadPath: (_record, filename) =>
                        `${crypto.randomUUID()}${path.extname(filename)}`,
                    validation: { mimeTypes: [...IMAGE_MIME_TYPES] },
                }),
            ],
        },
    ];
}
