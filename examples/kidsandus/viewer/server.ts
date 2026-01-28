
import { join, extname } from "https://deno.land/std@0.208.0/path/mod.ts";

const PORT = 8000;
const DATA_DIR = join(Deno.cwd(), "../chatgpt_response_data");
const VIEWER_DIR = Deno.cwd();

console.log(`Server running at http://localhost:${PORT}/`);
console.log(`Serving data from: ${DATA_DIR}`);

Deno.serve({ port: PORT }, async (req) => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // API: List files
    if (pathname === "/api/files") {
        try {
            const files = [];
            for await (const dirEntry of Deno.readDir(DATA_DIR)) {
                if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
                    files.push(dirEntry.name);
                }
            }
            // Sort files by name (descending to see newest first usually, or ascending)
            files.sort().reverse();
            return new Response(JSON.stringify(files), {
                headers: { "content-type": "application/json" },
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
    }

    // API: Serve data file
    if (pathname.startsWith("/data/")) {
        const filename = pathname.replace("/data/", "");
        // Basic security check to prevent directory traversal
        if (filename.includes("..") || filename.includes("/")) {
            return new Response("Forbidden", { status: 403 });
        }
        try {
            const filePath = join(DATA_DIR, filename);
            const file = await Deno.readFile(filePath);
            return new Response(file, {
                headers: { "content-type": "application/json" },
            });
        } catch {
            return new Response("File not found", { status: 404 });
        }
    }

    // Serve Static Files
    let filePath;
    if (pathname === "/") {
        filePath = join(VIEWER_DIR, "index.html");
    } else {
        filePath = join(VIEWER_DIR, pathname.substring(1));
    }

    try {
        const file = await Deno.readFile(filePath);
        const ext = extname(filePath);
        const contentType = {
            ".html": "text/html",
            ".css": "text/css",
            ".js": "application/javascript",
            ".json": "application/json",
        }[ext] || "text/plain";

        return new Response(file, {
            headers: { "content-type": contentType },
        });
    } catch {
        return new Response("Not Found", { status: 404 });
    }
});
