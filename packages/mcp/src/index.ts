#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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

server.tool(
  "engrams_list_engrams",
  "List all your engrams (knowledge bases)",
  {},
  async () => {
    const engrams = await listEngrams();
    return { content: [{ type: "text", text: JSON.stringify(engrams, null, 2) }] };
  }
);

server.tool(
  "engrams_feed_source",
  "Feed a source (text or URL) into an engram to compile into knowledge",
  {
    engram_slug: z.string().describe("The slug of the engram to feed into"),
    content: z.string().describe("The text content or URL to feed"),
    title: z.string().optional().describe("Optional title for the source"),
    source_type: z.enum(["text", "url"]).optional().describe("Type of source: 'text' or 'url'. Defaults to 'text'"),
  },
  async (params) => {
    const result = await feedSource(params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);

server.tool(
  "engrams_ask",
  "Ask a question about an engram's knowledge and get a synthesized answer",
  {
    engram_slug: z.string().describe("The slug of the engram to query"),
    question: z.string().describe("The question to ask"),
  },
  async (params) => {
    const result = await askEngram(params);
    return {
      content: [
        { type: "text", text: result.answer_md ?? "No answer available." },
        ...(result.articles_consulted?.length
          ? [{ type: "text" as const, text: `\nArticles consulted: ${result.articles_consulted.join(", ")}` }]
          : []),
        ...(result.suggested_followups?.length
          ? [{ type: "text" as const, text: `\nSuggested follow-ups:\n${result.suggested_followups.map((f: string) => `- ${f}`).join("\n")}` }]
          : []),
      ],
    };
  }
);

server.tool(
  "engrams_search_articles",
  "Search articles in an engram by keyword",
  {
    engram_slug: z.string().describe("The slug of the engram to search"),
    query: z.string().describe("Search query"),
  },
  async (params) => {
    const articles = await searchArticles(params);
    return { content: [{ type: "text", text: JSON.stringify(articles, null, 2) }] };
  }
);

server.tool(
  "engrams_read_article",
  "Read the full content of a specific article in an engram",
  {
    engram_slug: z.string().describe("The slug of the engram"),
    article_slug: z.string().describe("The slug of the article to read"),
  },
  async (params) => {
    const article = await readArticle(params);
    return {
      content: [
        { type: "text", text: `# ${article.title}\n\n${article.content_md}` },
        { type: "text", text: `\nConfidence: ${((article.confidence ?? 0) * 100).toFixed(0)}% | Tags: ${(article.tags ?? []).join(", ")} | Type: ${article.article_type}` },
        ...(article.backlinks?.length
          ? [{ type: "text" as const, text: `Backlinks: ${article.backlinks.map((b: { title: string }) => b.title).join(", ")}` }]
          : []),
      ],
    };
  }
);

server.tool(
  "engrams_list_articles",
  "List all articles in an engram",
  {
    engram_slug: z.string().describe("The slug of the engram"),
  },
  async (params) => {
    const articles = await listArticles(params);
    return { content: [{ type: "text", text: JSON.stringify(articles, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
