# Firecrawl 工作流

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

## ⚠️ 本机现状：Firecrawl 不可用，走等价替代链

本机**没有 Firecrawl MCP，也没有 firecrawl CLI**（`which firecrawl` 为空），
所以下方表格里的 `firecrawl_*` 调用一条都跑不通。

⚠️ **但 Firecrawl 的 key 是有的**：`grok-search` MCP 自己配了
`FIRECRAWL_API_KEY` 与 Tavily（`get_config_info` 可查）。它不暴露
`firecrawl_search/scrape` 这类直接工具，而是通过 `web_search` 的
`extra_sources: N` 参数在背后调用。所以「多拿几个真实来源」这件事仍然做得到，
只是**没有逐页 scrape 的控制权** —— 需要精确抓某一页的正文时，
仍要走下表的替代链。

**不要因为工具不全就跳过 SERP 研究** —— 研究是这个技能的地基，
跳过就退化成凭空写模板文案。按下表换工具即可，
`serp-research.md` 的深度分级、记录字段与排除规则**一条不变**。

另：`grok-search.web_search` 用默认的 `grok-4.20-multi-agent` 模型时
**会返回空 content**（实测两次），要显式传 `model: 'grok-chat-expert'`。

| 任务 | Firecrawl | 本机替代 |
|---|---|---|
| 搜索 SERP | `firecrawl_search` | `mcp__exa__web_search_exa`（首选，返回带正文摘要）；`mcp__grok-search__web_search`；`mcp__open-websearch__search` |
| 抓取页面正文 | `firecrawl_scrape` | `mcp__exa__web_fetch_exa`；`mcp__grok-search__web_fetch`；`mcp__open-websearch__fetchWebContent` |
| 发现站内 URL | `firecrawl_map` | `mcp__grok-search__web_map`（直接对应）；退而求其次抓 `/sitemap.xml` |
| 动态交互 | `firecrawl_interact` | chrome-devtools MCP（`new_page` + `evaluate_script`）—— JS-only 页面用它，拿的是渲染后 DOM |

**替代链的失败处理**（覆盖下方「Firecrawl 失败处理」同名条目）：
某个搜索源结果太少或全是聚合页时，**换另一个源再搜一次**再判定；
三个源都拿不到有效结果，才记录数量限制并继续。抓取只拿到导航时，
先 `web_map` 定位更具体 URL；仍失败才上 chrome-devtools 渲染。

装上 Firecrawl 之后删掉本节，上游表格自动恢复为首选。

## MCP 优先级

默认使用 Firecrawl MCP。CLI 只作为 MCP 不可用、需要本地调试或用户明确要求时的后备。

| 任务 | MCP | CLI |
|---|---|---|
| 搜索 SERP | `firecrawl_search` | `firecrawl search "关键词" --limit 10 --pretty` |
| 抓取页面正文 | `firecrawl_scrape` | `firecrawl scrape URL --only-main-content --format markdown,links --pretty` |
| 发现站内 URL | `firecrawl_map` | `firecrawl map URL --search "主题" --json --pretty` |
| 动态交互 | `firecrawl_interact` | `firecrawl browser execute "snapshot"` |

## SERP 抓取参数

`firecrawl_search`:

- `query`: 目标关键词。
- `limit`: 默认 10。
- `country`: 默认 `us` 或用户指定市场。
- `sources`: 默认 `web`。
- `scrapeOptions`: 只有在需要一次性抓取少量结果时使用；默认先搜索，再逐页 scrape。

`firecrawl_scrape`:

- 常规页面：`formats=["markdown","links"]`，`onlyMainContent=true`。
- 需要标题/FAQ/价格等字段：`formats=["json"]`，带 schema。
- JS 页面：先加 `waitFor=5000`；仍失败再 map；最后 interact。

## 替代 Playwright 的执行方式

旧流程用浏览器打开 Google，再逐个点击结果。新流程直接用 Firecrawl 搜索结果列表作为 SERP 候选，然后用 scrape 抓正文：

1. `firecrawl_search` 得到候选 URL，数量按 `serp-research.md` 的 5/10 分级决定。
2. 逐个 `firecrawl_scrape` 抽取正文、H1/H2、FAQ、CTA、链接。
3. 抓取失败时 `firecrawl_map` 定位站内具体页面。
4. 只有必须点击或展开时才 `firecrawl_interact`。
5. 分析输出保持逐页证据，不合并跳过有效结果。

## CLI 安装与认证

官方 CLI 安装入口：

```bash
npx -y firecrawl-cli@latest init --all --browser
```

全局 CLI 安装：

```bash
npm install -g firecrawl-cli
firecrawl login --browser
firecrawl --status
```

也可通过环境变量认证：

```bash
export FIRECRAWL_API_KEY=fc-YOUR-API-KEY
```
