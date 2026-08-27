# SEO 资料引用库

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md

## 使用方式

当需要校准 SEO 工具页原则、解释算法波动、补强 on-page checklist、判断内容质量风险或处理 AI search/GEO 表达时，优先查本文件列出的资料。不要把资料内容照抄进页面；只抽取原则、约束和验证问题。

## Google 官方

| 资料 | 地址 | 用途 |
|---|---|---|
| Helpful, reliable, people-first content | `https://developers.google.com/search/docs/fundamentals/creating-helpful-content` | 校准信息价值、E-E-A-T、Who/How/Why、AI/自动化披露、搜索引擎优先内容风险 |
| Spam policies | `https://developers.google.com/search/docs/essentials/spam-policies` | 检查 scaled content、doorway、scraping abuse、misleading functionality、keyword stuffing、link spam |
| SEO Starter Guide | `https://developers.google.com/search/docs/fundamentals/seo-starter-guide` | 校准标题、meta、URL、图片、重复内容、可索引性、无固定字数等基础规则 |
| Developer SEO guide | `https://developers.google.com/search/docs/fundamentals/get-started-developers` | 检查 Googlebot 可见性、JS 渲染、可抓取链接、站点地图、标题和 meta |
| Core updates | `https://developers.google.com/search/updates/core-updates` | 解释 core update 后的内容评估、恢复周期和不要做 quick fix 的原则 |
| Spam updates | `https://developers.google.com/search/updates/spam-updates` | 判断排名变化是否可能来自 spam 系统，并回查 spam policies |
| Search Status Dashboard | `https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history` | 核对最近 ranking update 的真实日期，避免用过期解读做判断 |

## On-page 与 AI Search

| 资料 | 地址 | 用途 |
|---|---|---|
| Backlinko On-Page SEO | `https://backlinko.com/on-page-seo` | 校准 title/meta、信息增量、搜索意图、自然关键词、内链、图片 alt、LLM-friendly formatting |
| Backlinko Internal Links | `https://backlinko.com/hub/seo/internal-links/` | 校准内链数量、锚文本自然性、从高权重页支持重点页 |
| Backlinko Meta Descriptions | `https://backlinko.com/hub/seo/meta-descriptions` | 校准 meta description 的 CTR 作用、唯一性、长度和价值表达 |
| Ahrefs On-Page SEO Checklist | `https://ahrefs.com/blog/on-page-seo-checklist/` | 校准短 URL、首段直达答案、描述性 H2、search intent、information gain、AI search、featured snippets、内外链和 schema |
| Ahrefs Internal Links | `https://ahrefs.com/blog/internal-links-for-seo/` | 校准内链结构、topic cluster、锚文本变化、正文链接优先级、orphan page、分页和 crawlable links |
| Moz On-Page SEO | `https://moz.com/learn/seo/on-site-seo` | 校准 on-page 的本质：让用户和搜索引擎理解页面、满足意图、避免关键词重复思维 |
| Moz On-Page Factors | `https://moz.com/learn/seo/on-page-factors` | 校准 title、URL、内容层级、内部链接、结构化数据等页面因素 |
| Moz Internal Links | `https://moz.com/learn/seo/internal-link` | 校准内部链接可抓取性、层级关系和锚文本 |
| Semrush Internal Linking Mistakes | `https://www.semrush.com/blog/internal-linking-mistakes/` | 检查内链错误：无关锚文本、断链、过度链接、重定向链、深层页面、orphan page、nofollow internal links |
| SearchPilot GEO Testing | `https://www.searchpilot.com/resources/blog/geo-testing` | 校准 GEO testing、RAG、fan-out 查询、AI last-click、事实层和 AI crawler 不执行 JS 的风险 |
| SearchPilot GEO / Fanout / Agents | `https://www.searchpilot.com/resources/blog/geo-fanout-agents-mike-kings-take-on-where-search-is-really-heading` | 校准 SEO 与 GEO 指标可能冲突、meta/答案块对 LLM 可见性的价值、结构化数据层和多渠道证据覆盖 |

## 实操案例

| 资料 | 地址 | 可借鉴点 |
|---|---|---|
| SearchPilot: internal linking category test | `https://www.searchpilot.com/resources/case-studies/seo-split-test-lessons-increasing-internal-linking` | 控制实验：给二级分类增加到三级分类的链接，二级和三级分类合计约 25% organic uplift；重点是更清晰的信息架构，不是乱加链接 |
| SearchPilot: footer internal links test | `https://www.searchpilot.com/resources/case-studies/adding-internal-links-to-home-page-footer` | 控制实验：首页 footer 增加相关内链整体约 5% uplift，桌面约 10%；只能作为行业/站点适配测试，不是 footer 链接越多越好 |
| SearchPilot: AI-generated content test | `https://www.searchpilot.com/resources/case-studies/ai-generated-content-improve-organic-traffic` | 控制实验：同一 AI 内容改动在美国市场约 +12.6% 预测 uplift，在澳洲不确定；用于提醒市场差异、人工审查和分组测试 |
| SearchPilot: AI content testing guidance | `https://www.searchpilot.com/resources/blog/what-seos-need-to-know-about-ai-testing` | 用于 AI 文案治理：人审、不要复制竞品、不要大规模瞬时上线、单元素测试、全漏斗评估、必要时测试删除无用内容 |
| SearchPilot: specifications section test | `https://www.searchpilot.com/resources/case-studies/pulling-specifications-into-standalone-section-improve-seo` | 控制实验：把规格表独立成 H2 模块后约 +5.5% uplift；用于支持功能页事实层、Key facts、格式/限制/价格表格的显性化 |
| SearchPilot: price/review schema test | `https://www.searchpilot.com/resources/case-studies/seo-split-test-lessons-adding-price-review-schema-product-pages` | 控制实验：price + review schema 不一定优于 review-only；schema 必须结合竞争语境，不是字段越多越好 |
| SearchPilot: client-side pricing title test | `https://www.searchpilot.com/resources/case-studies/adding-pricing-information-client-side-improve-seo` | 控制实验：JS 添加价格 title 约 +12% organic sessions，但推荐服务端实现；用于提醒动态价格/积分要避免 JS-only、缓存和页面事实不一致 |
| SearchPilot: reducing internal link block | `https://www.searchpilot.com/resources/case-studies/seo-split-test-lessons-reducing-link-block` | 控制实验：压缩大型内链块约 +10.2% 预测 uplift 但 95% 不确定；用于提醒链接块要服务导航和可读性，不是越大越好 |
| Semrush + Picsart internal linking case | `https://www.semrush.com/company/stories/picsart/` | 300+ 页面、50K+ contextual links，一周部署；观察期内 linked pages clicks +20%、impressions +124%，适合参考规模化内链流程 |
| BuzzStream value-first SEO case | `https://www.buzzstream.com/blog/seo-case-study/` | 第一人称实操：内容修剪、导航/内链精简、博客 UX、客户反馈、独特数据和作者经验，12 个月 organic sessions 约 8K 到 20K+ |
| Backlinko content relaunch | `https://backlinko.com/content-relaunch` | 旧内容重写、结构更新与再发布案例；用于判断何时优化旧页而不是新建相似页 |
| Backlinko Skyscraper 2.0 | `https://backlinko.com/skyscraper-technique-2-0` | 搜索意图匹配和内容差异化案例；只抽取 intent/UX/内容增量原则，不复制外联套路 |

## Reddit 与社区线索

Firecrawl 可搜索 Reddit 结果，但当前不支持抓取 `reddit.com` 或 `old.reddit.com` 正文。Reddit 只作为实操线索，不作为规则真源；使用前必须人工打开核验上下文、时间、站点类型、是否有截图或 GSC 数据。

| 线索 | 地址 | 用途 |
|---|---|---|
| r/SEO: SaaS organic traffic case | `https://www.reddit.com/r/SEO/comments/s3ry25/seo_case_study_0_to_200000_monthly_organic/` | 找无主动外链、内容和 on-page 驱动增长的社区讨论线索 |
| r/bigseo: internal linking only case | `https://www.reddit.com/r/bigseo/comments/1t0hdnn/fixed_8_page2_rankings_with_internal_linking_only/` | 找只改内链、page 2 到 page 1 的实操讨论线索；需核验正文和数据 |
| r/SEO: internal linking strategy discussions | `https://www.reddit.com/r/SEO/search/?q=internal%20linking%20case%20study&restrict_sr=1` | 搜索近期内链经验、失败案例和反例 |
| r/bigseo: technical/on-page experiments | `https://www.reddit.com/r/bigseo/search/?q=internal%20linking%20case%20study&restrict_sr=1` | 搜索更偏专业 SEO 的测试和争议讨论 |

## 算法解读

| 资料 | 地址 | 用途 |
|---|---|---|
| Search Engine Land: March 2026 core update complete | `https://searchengineland.com/google-march-2026-core-update-rollout-is-now-complete-473883` | 核对 2026 年 3 月 core update 时间线和 Google 未给新技巧的结论 |
| Search Engine Land: March 2026 volatility analysis | `https://searchengineland.com/march-2026-google-core-update-what-changed-474397` | 作为第三方观察：官方/专业/品牌/数据丰富来源增强，聚合与薄比较页承压 |
| Search Engine Journal: March 2026 core update complete | `https://www.searchenginejournal.com/google-confirms-march-2026-core-update-is-complete/571459/` | 交叉确认 core update 时间线、无新增官方指导、仍回到 helpful content |
| Search Engine Journal: March 2026 spam update | `https://www.searchenginejournal.com/google-begins-rolling-out-the-march-2026-spam-update/570428/` | 交叉确认 spam update 时间线和全球/全语言影响 |

## 使用原则

- Google 官方资料优先级最高；第三方解读只用于理解波动方向，不当成排名因子事实。
- 如果资料之间冲突，以 Google 官方文档和 Search Status Dashboard 为准。
- 控制实验优先级高于普通 case study；普通 case study 优先级高于 Reddit 讨论。
- Reddit 只能提供假设和反例，不能直接写进 checklist，除非有独立数据或权威资料交叉验证。
- 不从竞品或媒体复制文案，只抽取检查问题和页面结构原则。
- 对工具页最重要的结论：真实可用、首屏能完成任务、限制清楚、信息有增量、Googlebot 可见、不要 doorway、不要 scaled clone。
