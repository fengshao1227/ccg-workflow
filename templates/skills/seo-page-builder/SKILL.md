---
name: seo-page-builder
description: 用于创建、审计或优化 SEO 工具页、AI generator/remover/enhancer/converter/editor 功能页、feature page JSON、工具页 on-page SEO brief，以及 App Router/i18n 功能页路由。
user-invocable: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, WebFetch
argument-hint: "[目标关键词 或 页面路径]"
---

# SEO 工具页构建器

> **来源说明**：本技能改编自 yuzeiki 的 `seo-page-builder`，在其基础上大幅重写 ——
> 收窄边界为「只处理工具型 SEO 页面」、新增 `scripts/onpage-audit.py` 可执行量具、
> 用实测竞品数据替换了拍脑袋的密度指标。原作若有明确许可要求请提 issue，我们会立即遵从。
> 其余部分随 CCG 以 MIT 分发。

## 核心原则

本技能只处理工具型 SEO 页面。它不处理普通 campaign 落地页、博客、新闻页、资讯页或 programmatic 批量页。

用 Firecrawl 把搜索意图转成可索引、可使用、可信的工具页。执行路径保持最短：

1. 确认工具页关键词和现有模板。
2. 研究 SERP 意图。
3. 提取信息缺口和能力边界。
4. 判断工具页类型，决定模块轻重。
5. 产出页面文案、英文 source JSON 或实现说明。
6. 按模块执行信息价值与 SEO QA。

## 适用场景

用户提到以下任一场景时使用本技能：

- `add feature page`
- `new generator page`
- `new tool page`
- `feature page JSON`
- `AI generator page SEO`
- 工具页 route 接线
- i18n JSON 工具页文案
- generator / remover / enhancer / converter / editor / maker 页面

非工具页需求不由本技能处理；博客交给 `blog-writing`，普通营销页面先确认是否已有更合适的专门技能。

## Firecrawl

优先使用 Firecrawl MCP。只有 MCP 不可用或用户要求本地调试时才使用 CLI。细节见 `references/firecrawl-workflow.md`。

- 搜索：`firecrawl_search`
- 抓取：`firecrawl_scrape`
- 站内发现：`firecrawl_map`
- 动态交互：`firecrawl_interact`

## 必要输入

只询问会改变结果的缺失信息：

- `CORE_KEYWORD`：一个英文主关键词
- 品牌名或产品名
- 目标市场
- 现有 route、模板、JSON 或参考 URL
- 交付物：直接编辑、只写 JSON、只写 brief、只做审计
- 产品能力边界：格式、尺寸、时长、价格、登录、安全、隐私、法务限制
- 可证明素材：截图、示例、before/after、真实功能说明

默认只写英文 source JSON。多语言扩展交给后续 i18n 流程。

## 执行顺序

1. 读取 `references/feature-page-seo.md`。
2. 扫描仓库中最接近的工具页模板。
3. 按 `references/serp-research.md` 做 SERP 研究。Firecrawl 不可用时改用
   `scripts/onpage-audit.py --suggest` 取 Google autocomplete 真实词，**禁止让模型编 PAA**。
4. 建立关键词地图、FAQ、相关工具和 cannibalization 判断。FAQ 问题用用户原话，不要改写。
5. 判断工具页类型：删除、批量、生成编辑、增强修复、转换或模型页。
6. `scripts/onpage-audit.py --benchmark` 实测 3-5 个排名竞品，**先拿到密度区间再动笔**。
7. 严格镜像模板 route shape 与 JSON shape。
8. 只改必要接线：slug、namespace、import、metadata、page identifier、related links、页面文案。
9. 按模块跑信息价值与 SEO QA。
10. `scripts/onpage-audit.py --targets` 实测交付页，把关键词命中、密度、meta 长度、FAQ 深度写进 QA。

## 输出

1. **模板匹配**：选择的 route/JSON 与原因。
2. **工具页类型**：关键词对应的页面类型、首屏重点、必备模块和可省模块。
3. **SEO Brief**：搜索意图、长尾词、FAQ、信息缺口、独特角度、相关内链。
4. **实现说明**：需要改的文件、route、JSON key 与接线。
5. **优化后的 JSON**：英文，结构必须与模板一致。
6. **模块 QA**：逐模块确认信息价值、Google 政策门槛、可抓取性、schema、链接与薄页风险。

## 质量栏

- 工具必须真实可用，或诚实说明当前能力和限制。
- 页面先帮助用户完成任务，再追关键词。
- 每个主要模块都必须提供信息价值：独特说明、真实限制、可验证示例、具体场景、操作步骤或可信来源。
- 页面模块由关键词意图和工具类型决定，不把所有工具页写成同一个长模板。
- 关键词自然出现在 title、meta、H1、URL、首段、alt 和相关小节。
- 不套用固定密度数字，但必须**实测**：主关键词在正文的命中次数（**0 次是常见静默失败**），
  靶子由实测竞品区间给出，不用记忆或口头传闻的百分比。客户说「密度 2%」时先判定口径 ——
  按 `hits%` 对多词短语追 2% 就是堆词。详见 `references/feature-page-seo.md`。
- 提密度优先换指代词为实名、H2 写工具全名（零新增字数），不靠加句子；短于目标就如实报告。
- 不做薄页 clone、doorway page、假工具、无证据承诺、抓取改写或隐藏关键信息。
- 链接少而相关，锚文本描述具体目标；付费或赞助链接使用正确 `rel`。
- 结构化数据必须匹配页面可见内容。

## 参考资料

- `references/firecrawl-workflow.md`：Firecrawl MCP/CLI 映射。
- `references/serp-research.md`：SERP 深度、抓取、意图与失败处理。
- `references/feature-page-seo.md`：工具页流程、模块信息价值与 SEO QA。
- `references/seo-source-library.md`：Google、Moz、Backlinko 与算法解读资料引用库。
- `scripts/onpage-audit.py`：三个模式的量具，stdlib only，无需 key ——
  `--suggest` 取 Google autocomplete、`--benchmark` 量竞品密度并提取其 FAQ、`--targets` 打分交付页。
  配置模板见 `scripts/targets.example.json`。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
