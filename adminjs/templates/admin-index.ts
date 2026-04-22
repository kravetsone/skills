// src/admin/index.ts
// Complete AdminJS + Elysia entrypoint: themes, component loader, conditional auth.
// Copy verbatim, then swap imports (config / db / resources) to match your project.

import path from "node:path";
import { dark, light } from "@adminjs/themes";
import AdminJS, { ComponentLoader } from "adminjs";
import * as PgAdapter from "adminjs-drizzle/pg";
import { buildAuthenticatedRouter, buildRouter } from "adminjs-elysia";
import Elysia from "elysia";

import { config } from "../config";
import { db } from "../db";
import { getResources } from "./resources";

AdminJS.registerAdapter(PgAdapter);

const componentLoader = new ComponentLoader();

// Register custom components via absolute paths (CWD-independent).
// Add more here and reference via Components.XYZ in resources.ts.
export const Components = {
    Dashboard: componentLoader.add(
        "Dashboard",
        path.join(import.meta.dir, "dashboard"),
    ),
    // Example: PromoUpload: componentLoader.add("PromoUpload", path.join(import.meta.dir, "promo-upload")),
};

const admin = new AdminJS({
    rootPath: "/admin",
    // @ts-expect-error — adminjs-drizzle's Resource generic is over-broad
    resources: getResources(db, componentLoader),
    componentLoader,
    defaultTheme: dark.id,
    availableThemes: [dark, light],
    branding: {
        companyName: "My Project",
        logo: false,
        withMadeWithLove: false,
    },
    dashboard: {
        component: Components.Dashboard,
    },
});

async function createRouter() {
    // Dev mode: no creds configured → no auth gate
    if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
        return buildRouter(admin, {});
    }

    // Production: authenticated router
    const { DefaultAuthProvider } = await import("adminjs");

    const provider = new DefaultAuthProvider({
        componentLoader,
        authenticate: async ({ email, password }) => {
            if (email === config.ADMIN_EMAIL && password === config.ADMIN_PASSWORD) {
                return { email };
            }
            return null;
        },
    });

    return buildAuthenticatedRouter(
        admin,
        {
            provider,
            cookiePassword: config.ADMIN_COOKIE_SECRET,
            // CRITICAL: explicit cookieName — v0.1.4 has inconsistent defaults
            // that silently break auth. Do not rely on defaults.
            cookieName: "adminjs",
        },
        {},
    );
}

// `detail: { hide: true }` excludes the entire admin subtree from @elysiajs/openapi output.
export const adminRouter = new Elysia({ detail: { hide: true } }).use(
    await createRouter(),
);
