// src/admin/csv-upload.tsx
// Record-action modal: file input → POST to action endpoint → success notice.
// Register via `action.component` and handle the POST in the action `handler`.

import { Box, Button, H5, MessageBox, Text } from "@adminjs/design-system";
import { useState } from "react";

type Notice = { type: "success" | "danger"; message: string };

type Props = {
    record: { id: string | number; params: Record<string, unknown> };
    resource: { id: string };
    // name of the action this component belongs to (matches the action key in resources.ts)
    // passed automatically by AdminJS — default "uploadCsv" for this template
};

const ACTION_NAME = "uploadCsv";

export default function CsvUpload({ record, resource }: Props) {
    const [rawText, setRawText] = useState("");
    const [fileName, setFileName] = useState("");
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<Notice | null>(null);

    const rows = rawText
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);

    function onFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        setNotice(null);
        const reader = new FileReader();
        reader.onload = ev => setRawText((ev.target?.result as string) ?? "");
        reader.readAsText(file);
    }

    async function submit() {
        if (!rows.length) return;
        setLoading(true);
        setNotice(null);
        try {
            const url = `/admin/api/resources/${resource.id}/records/${record.id}/${ACTION_NAME}`;
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ csvText: rawText }),
            });
            const data = await res.json().catch(() => ({}));
            setNotice({
                type: res.ok ? "success" : "danger",
                message:
                    (data?.notice?.message as string | undefined) ??
                    (res.ok ? "Done" : "Failed"),
            });
            if (res.ok) {
                setRawText("");
                setFileName("");
            }
        } catch (err) {
            setNotice({ type: "danger", message: String(err) });
        } finally {
            setLoading(false);
        }
    }

    return (
        <Box padding="xl">
            <H5>Upload CSV</H5>

            <Box mt="xl" p="xl" style={{ background: "#1a1a2e", borderRadius: 8 }}>
                <Text style={{ color: "#ff6b35", fontWeight: 700 }}>
                    Format
                </Text>
                <Text mt="sm" style={{ color: "#fff", lineHeight: 1.8 }}>
                    • One value per line<br />
                    • UTF-8, no BOM<br />
                    • No headers, no separators
                </Text>
            </Box>

            <Box mt="xl">
                <Text style={{ fontWeight: 600, marginBottom: 8 }}>
                    Choose file:
                </Text>
                <input
                    type="file"
                    accept=".csv,.txt,text/plain"
                    onChange={onFile}
                    style={{ display: "block", padding: "8px 0", fontSize: 14 }}
                />
            </Box>

            {rows.length > 0 && (
                <Box
                    mt="lg"
                    p="lg"
                    style={{
                        background: "#0f2318",
                        border: "1px solid #2a6b3a",
                        borderRadius: 6,
                    }}
                >
                    <Text style={{ color: "#7fff7f", fontWeight: 700 }}>
                        ✅ {fileName}: {rows.length} rows ready
                    </Text>
                </Box>
            )}

            <Box mt="xl">
                <Button
                    onClick={submit}
                    disabled={rows.length === 0 || loading}
                    variant="primary"
                    size="lg"
                >
                    {loading
                        ? "Uploading…"
                        : rows.length > 0
                            ? `Upload ${rows.length} rows`
                            : "Choose a file"}
                </Button>
            </Box>

            {notice && (
                <MessageBox
                    mt="xl"
                    variant={notice.type}
                    message={notice.message}
                    onCloseClick={() => setNotice(null)}
                />
            )}
        </Box>
    );
}
