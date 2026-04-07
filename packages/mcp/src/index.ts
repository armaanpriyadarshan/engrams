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
} from "./tools.js";

const server = new McpServer({
  name: "engrams",
  version: "0.1.0",
});

const AUTH_URL = "https://engrams-ai.vercel.app/auth/mcp";

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
    token: z.string().describe("Your API token from engrams-ai.vercel.app/auth/mcp (starts with eng_)"),
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
