# seo-page-builder/
> L2 | 父级: ~/.claude/skills/ccg/ | 改编自 yuzeiki 的同名技能，详见 SKILL.md 顶部来源说明

成员清单
SKILL.md: SEO 工具页构建器入口，只处理工具型 SEO 页面，保留触发边界、工具类型判断、最短流程、输出契约与质量栏。
references/: SEO 工具页参考库，承载 Firecrawl 流程、SERP 研究唯一真源、工具页模块信息价值 QA、资料引用库与 Google 标准校准。
scripts/: 可执行量具，stdlib only。`onpage-audit.py` 三模式（autocomplete 收词 / 竞品密度基准与 FAQ 提取 / 交付页打分），`targets.example.json` 为配置模板。

架构决策
`seo-page-builder/` 是 SERP 驱动 SEO 工具页的统一入口：只处理 generator、remover、enhancer、converter、editor、maker 等工具型页面。普通营销落地页不在本技能边界内，需先确认是否有更合适的专门技能；本技能先按工具类型决定模块轻重，再强调搜索意图、工具可用性、信息价值和可索引内容。

开发规范
修改 SERP 研究、模块信息价值、on-page 检查或链接策略时，先更新 `references/` 对应真源，再检查 `SKILL.md` 是否仍能正确路由。短规则合并到现有 reference，不新增碎片文件。

变更日志
2026-08-15: 新增 `scripts/`，把「先量再定」从口号变成可跑的量具。起因是一次真实审计：
  8 个功能页里 4 个的目标长尾词在正文中命中 **0 次**，而全站技术 SEO 零缺陷、正文 2400-3500 词。
  成因是 H1 与 title 用词不一致、修饰词劈断短语、以及**反灌水规范把指代压成 "this tool"
  从而把头部词挤出正文** —— 最后一条已写进 `feature-page-seo.md`，是本次最值得复用的教训。
  同时确立：密度靶子必须实测竞品得出（该次实测三个排名页，完整长尾词无一超过 0.62%，
  故「2% 密度」只能指单 token），SERP 问题取自 Google autocomplete 与竞品 FAQ schema，禁止模型编 PAA。
2026-08-04: Firecrawl MCP / CLI 非必需 —— `references/firecrawl-workflow.md` 顶部
  已备「等价替代链」（exa / grok-search / open-websearch / chrome-devtools），
  研究深度与记录字段不变；装了 Firecrawl 的环境可忽略该节。
  与 CCG 自带 `domains/seo/seo-growth.md` 的边界：那份管**站级增长运营**
  （GSC 诊断、博客选题、多语言批翻、内链、掉量分诊、外链），本技能管**单张工具页的构建**，
  两者互补不重叠 —— 博客与站级优化不要路由到本技能。
2026-05-05: 移除对已卸载 `marketing-skills/` 的普通落地页路由说明，保持本技能只承接 SEO 工具页。
2026-05-05: 新增 SEO 资料引用库 reference，集中收纳 Google、Moz、Backlinko 与算法解读资料供后续调用。
2026-05-05: 将 Google/Moz/Backlinko 标准校准纳入 reference 职责，补强工具页信任透明、可引用答案块与抓取可见一致性。
2026-05-05: 新增工具类型判断为入口输出项，避免删除、批量、生成编辑、增强修复、转换与模型页被同一模板束缚。
2026-05-05: 将技能边界收窄为只处理 SEO 工具页，移除普通 landing_page 模式，并把模块检查与 SEO QA 合并为模块信息价值 QA。
2026-05-05: 将技能目录与 skill name 从 `seo-landing-page` 重命名为 `seo-page-builder`，正文统一改为中文表达。
2026-05-05: 按奥卡姆剃刀优化技能结构，瘦身 `SKILL.md`，删除独立链接规范文件，确立 SERP 与 feature page 单一真源。
2026-05-05: 将 `marketing-skills/reference/feature-page-seo.md` 的 AI generator 功能页流程揉入本技能，后续已收窄为单一工具页入口。
2026-05-05: 将执行工具链改为 Firecrawl-first，新增 `references/firecrawl-workflow.md` 并更新 SERP 研究失败处理。
2026-05-05: 从 `f321240^` 恢复历史 `seo-landing-page/` 技能目录，并补齐 GEB 目录地图。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md
