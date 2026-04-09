#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isLoggedIn, login, clearConfig } from "./supabase.js";
import {
  listEngrams,
  feedSource,
  askEngram,
  searchArticles,
  readArticle,
  listArticles,
  captureKnowledge,
} from "./tools.js";

// Handle --token flag from install command
const tokenArg = process.argv.find((_, i) => process.argv[i - 1] === "--token");
if (tokenArg) {
  login(tokenArg).then((result) => {
    if (!result.success) {
      process.stderr.write(`Token validation failed: ${result.error}\n`);
    }
  });
}

const server = new McpServer({
  name: "engrams",
  version: "0.1.0",
});

const AUTH_URL = "https://engramsai.vercel.app/auth/mcp";

function requireAuth(fn: (params: any) => Promise<any>) {
  return async (params: any) => {
    try {
      const result = await fn(params);
      return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
      if (err.message === "NOT_LOGGED_IN") {
        return {
          content: [{
            type: "text" as const,
            text: `Not logged in to Engrams. Use the engrams_login tool first.\n\n1. Visit ${AUTH_URL} to get your token\n2. Call engrams_login with the token`,
          }],
        };
      }
      if (err.message === "TOKEN_EXPIRED") {
        return {
          content: [{
            type: "text" as const,
            text: `Your Engrams token has expired. Visit ${AUTH_URL} to get a new one, then call engrams_login.`,
          }],
        };
      }
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  };
}

// ── Auth tools ──

server.tool(
  "engrams_login",
  `Log in to Engrams. Visit ${AUTH_URL} to get your token, then pass it here.`,
  {
    token: z.string().describe("Your API token from engramsai.vercel.app/auth/mcp (starts with eng_)"),
  },
  async (params) => {
    const result = await login(params.token);
    if (result.success) {
      return { content: [{ type: "text", text: "Logged in to Engrams. You can now use all engrams tools." }] };
    }
    return { content: [{ type: "text", text: `Login failed: ${result.error}\nGet a new token at ${AUTH_URL}` }] };
  }
);

server.tool(
  "engrams_logout",
  "Log out of Engrams and clear stored credentials",
  {},
  async () => {
    clearConfig();
    return { content: [{ type: "text", text: "Logged out of Engrams." }] };
  }
);

// ── Knowledge tools ──

server.tool(
  "engrams_list_engrams",
  "List all your engrams (knowledge bases)",
  {},
  requireAuth(async () => await listEngrams())
);

server.tool(
  "engrams_feed_source",
  "Feed a source (text or URL) into an engram to compile into knowledge",
  {
    engram_slug: z.string().describe("The slug of the engram to feed into"),
    content: z.string().describe("The text content or URL to feed"),
    title: z.string().optional().describe("Optional title for the source"),
    source_type: z.enum(["text", "url"]).optional().describe("Type: 'text' or 'url'. Defaults to 'text'"),
  },
  requireAuth(async (params) => await feedSource(params))
);

server.tool(
  "engrams_ask",
  "Ask a question about an engram's knowledge and get a synthesized answer",
  {
    engram_slug: z.string().describe("The slug of the engram to query"),
    question: z.string().describe("The question to ask"),
  },
  requireAuth(async (params) => {
    const result = await askEngram(params);
    let text = result.answer_md ?? "No answer available.";
    if (result.articles_consulted?.length) {
      text += `\n\nArticles consulted: ${result.articles_consulted.join(", ")}`;
    }
    if (result.suggested_followups?.length) {
      text += `\n\nFollow-ups:\n${result.suggested_followups.map((f: string) => `- ${f}`).join("\n")}`;
    }
    return text;
  })
);

server.tool(
  "engrams_search_articles",
  "Search articles in an engram by keyword",
  {
    engram_slug: z.string().describe("The slug of the engram to search"),
    query: z.string().describe("Search query"),
  },
  requireAuth(async (params) => await searchArticles(params))
);

server.tool(
  "engrams_read_article",
  "Read the full content of a specific article",
  {
    engram_slug: z.string().describe("The slug of the engram"),
    article_slug: z.string().describe("The slug of the article to read"),
  },
  requireAuth(async (params) => {
    const article = await readArticle(params);
    let text = `# ${article.title}\n\n${article.content_md}`;
    text += `\n\nConfidence: ${((article.confidence ?? 0) * 100).toFixed(0)}% | Tags: ${(article.tags ?? []).join(", ")}`;
    if (article.backlinks?.length) {
      text += `\nBacklinks: ${article.backlinks.map((b: { title: string }) => b.title).join(", ")}`;
    }
    return text;
  })
);

server.tool(
  "engrams_list_articles",
  "List all articles in an engram",
  {
    engram_slug: z.string().describe("The slug of the engram"),
  },
  requireAuth(async (params) => await listArticles(params))
);

server.tool(
  "engrams_capture",
  `Capture durable knowledge from the current conversation into an engram. Use this when the user asks you to "save what we just figured out", "capture this to my wiki", "remember this for later", or similar. Pass the relevant conversation excerpt as 'content'. The tool extracts decisions, discoveries, corrections, and gotchas — filtering out greetings, retries, and dead ends — and files each as its own source in the engram. The wiki compiler picks them up and merges them into articles automatically. Omit chit-chat; include the substantive back-and-forth.`,
  {
    engram_slug: z
      .string()
      .describe("The slug of the engram to capture into"),
    content: z
      .string()
      .describe(
        "The conversation excerpt to extract knowledge from. Up to ~40k characters. Paste the relevant back-and-forth including your own prior messages and the user's.",
      ),
    context: z
      .string()
      .optional()
      .describe(
        "Optional one-line description of what the conversation was about. Helps the extractor pick the right items.",
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe(
        "Optional tag hints to attach to the captured sources. Lowercase, 1-2 words each.",
      ),
  },
  requireAuth(async (params) => {
    const result = await captureKnowledge(params);
    if (result.items_captured === 0) {
      const reason = result.skipped_reason ?? "no durable content";
      return `Nothing captured. Reason: ${reason}`;
    }
    const lines = [
      `Captured ${result.items_captured} item${result.items_captured === 1 ? "" : "s"} into '${params.engram_slug}':`,
      "",
      ...result.items.map(
        (it: { title: string; kind: string }) =>
          `- [${it.kind}] ${it.title}`,
      ),
      "",
      `The wiki compiler is now processing these. Run engrams_list_articles in a minute or two to see the new concept articles.`,
    ];
    return lines.join("\n");
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
