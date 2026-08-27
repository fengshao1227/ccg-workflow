# SERP 研究

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

## 深度

- 默认：分析 5 个有效自然结果。
- 深度：竞争强关键词、完整落地页或用户明确要求深度研究时分析 10 个结果。
- 有效结果不足时，分析可用结果并说明数量限制。

## 收集

先用 Firecrawl 搜索，再逐页抓取。不能只看 snippet。

每个结果记录：

- 标题和 URL
- 内容类型：工具、产品页、落地页、博客、视频、论坛、目录页
- 内容格式：教程、清单、对比、模板、评测、问答、直接工具
- 内容角度：最快、免费、新手、专业、高质量、隐私、工作流
- H1 和主要 H2
- 可借鉴点
- 缺失或薄弱信息

排除广告、目标站点自身、无关聚合页和不匹配搜索意图的页面。

## 真实查询词采集

写 FAQ 和长尾覆盖必须用真实数据。**禁止让模型凭空生成 People Also Ask** —— 模型会编造看似合理
的问题，且无从验证。以下两条不依赖 Firecrawl，拿到的是 Google 自己吐的数据和已排名页面的实际用词。

### Google autocomplete 收词

```
https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=<query>
```

返回 `[query, [suggestions...]]`，无需 key 和认证。

- 用法：**种子词 × 疑问前缀交叉跑**，前缀取 `""`、`how to `、`can you `、`is it `、
  `why does `、`does `、`what is `、`how do i `
- 请求间隔 ~120ms，全局去重
- 实测 14 个种子词 × 8 前缀 → **341 条真实建议词**

产出直接用于：写 FAQ 问题（**用用户的原话，不要改写**）、发现未覆盖的词簇、
判断同义词哪个有量（例：`image metadata remover` 有 10 条建议，`metadata cleaner` 零 —— 直接决定 H1 用词）。

⚠️ 必须滤噪音：品牌词会串到同音词（`synthid` → `synthroid` 甲状腺药；`nano banana` → 香蕉味）。
词簇里混进大量无关词时，说明该词本身有歧义，值得在页面里显式消歧。

### 竞品 FAQ 提取

抓排名页 HTML，正则提两处：

- FAQPage schema 内的 `"@type":"Question"` → `"name"`
- 以 `?` 结尾的 `<h2>`–`<h4>` / `<summary>` 文本

这是**已经在排名的页面实际使用的问题**，比 PAA 推测更硬。抓的同时顺手算关键词密度基准
（见 `feature-page-seo.md` 的「关键词覆盖与密度校准」），一次抓取拿两份数据。

## 意图判断

汇总：

- 主导页面类型和原因
- 重复出现的模块或回答顺序
- SERP/PAA/FAQ 问题
- 值得加入的信息缺口
- 风险：薄页 clone、doorway overlap、误导性功能承诺、法务/隐私敏感性

## Firecrawl 失败处理

- 抓取为空或只有导航：对该域名使用 `firecrawl_map`，再抓取更具体 URL。
- JS-only 或必须展开：只有缺失内容关键时才使用 `firecrawl_interact`。
- 仍然失败：记录失败原因并继续。

## 输出

除非用户要求完整证据，SERP 输出保持紧凑：

- **SERP 模式**
- **信息缺口**
- **页面角度**
- **证据 URL**
