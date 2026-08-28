# CCG Domain Knowledge — Auto-routing Rules

When the user's request matches trigger keywords below, automatically READ the corresponding skill file to gain domain expertise before responding. These knowledge files are installed at `~/.claude/skills/ccg/domains/`.

**IMPORTANT**: Read the skill file FIRST, then respond. Do NOT fabricate domain knowledge from training data when a skill file exists.

## Security Domain (`domains/security/`) — NOT installed by default

> Security domain files contain red team/pentest reference content that may trigger antivirus false positives.
> They are NOT installed by default. To enable, manually copy from the npm package:
> `cp -r $(npm root -g)/ccg-workflow/templates/skills/domains/security/ ~/.claude/skills/ccg/domains/security/`

| Trigger Keywords | Skill File | Description |
|------------------|-----------|-------------|
| pentest, red team, exploit, C2, lateral movement, privilege escalation, evasion, persistence | `~/.claude/skills/ccg/domains/security/red-team.md` | Red team attack techniques |
| blue team, alert, IOC, incident response, forensics, SIEM, EDR, containment | `~/.claude/skills/ccg/domains/security/blue-team.md` | Blue team defense & incident response |
| web pentest, API security, OWASP, SQLi, XSS, SSRF, RCE, injection | `~/.claude/skills/ccg/domains/security/pentest.md` | Web & API penetration testing |
| code audit, dangerous function, taint analysis, sink, source | `~/.claude/skills/ccg/domains/security/code-audit.md` | Source code security audit |
| binary, reversing, PWN, fuzzing, stack overflow, heap overflow, ROP | `~/.claude/skills/ccg/domains/security/vuln-research.md` | Vulnerability research & exploitation |
| OSINT, threat intelligence, threat modeling, ATT&CK, threat hunting | `~/.claude/skills/ccg/domains/security/threat-intel.md` | Threat intelligence & OSINT |

## Architecture Domain (`domains/architecture/`)

| Trigger Keywords | Skill File |
|------------------|-----------|
| API design, REST, GraphQL, gRPC, endpoint, versioning | `~/.claude/skills/ccg/domains/architecture/api-design.md` |
| caching, Redis, Memcached, cache invalidation, CDN | `~/.claude/skills/ccg/domains/architecture/caching.md` |
| cloud native, Kubernetes, Docker, microservice, service mesh | `~/.claude/skills/ccg/domains/architecture/cloud-native.md` |
| message queue, Kafka, RabbitMQ, event driven, pub/sub | `~/.claude/skills/ccg/domains/architecture/message-queue.md` |
| security architecture, zero trust, defense in depth, IAM | `~/.claude/skills/ccg/domains/architecture/security-arch.md` |

## AI / MLOps Domain (`domains/ai/`)

| Trigger Keywords | Skill File |
|------------------|-----------|
| RAG, retrieval augmented, vector database, embedding, chunking | `~/.claude/skills/ccg/domains/ai/rag-system.md` |
| AI agent, tool use, function calling, agent framework, orchestration | `~/.claude/skills/ccg/domains/ai/agent-dev.md` |
| LLM security, prompt injection, jailbreak, guardrail | `~/.claude/skills/ccg/domains/ai/llm-security.md` |
| prompt engineering, model evaluation, benchmark, fine-tuning | `~/.claude/skills/ccg/domains/ai/prompt-and-eval.md` |

## DevOps Domain (`domains/devops/`)

| Trigger Keywords | Skill File |
|------------------|-----------|
| Git workflow, branching strategy, trunk-based, GitFlow | `~/.claude/skills/ccg/domains/devops/git-workflow.md` |
| testing strategy, unit test, integration test, e2e, test pyramid | `~/.claude/skills/ccg/domains/devops/testing.md` |
| database, migration, schema design, indexing, query optimization | `~/.claude/skills/ccg/domains/devops/database.md` |
| performance, profiling, load test, latency, throughput | `~/.claude/skills/ccg/domains/devops/performance.md` |
| observability, logging, tracing, metrics, Prometheus, Grafana | `~/.claude/skills/ccg/domains/devops/observability.md` |
| DevSecOps, CI security, SAST, DAST, supply chain | `~/.claude/skills/ccg/domains/devops/devsecops.md` |
| cost optimization, cloud cost, FinOps, resource right-sizing | `~/.claude/skills/ccg/domains/devops/cost-optimization.md` |

## Development Domain (`domains/development/`)

When the user is working with a specific programming language, read the corresponding skill file for language-specific best practices:

| Language | Skill File |
|----------|-----------|
| Python | `~/.claude/skills/ccg/domains/development/python.md` |
| Go | `~/.claude/skills/ccg/domains/development/go.md` |
| Rust | `~/.claude/skills/ccg/domains/development/rust.md` |
| TypeScript / JavaScript | `~/.claude/skills/ccg/domains/development/typescript.md` |
| Java / Kotlin | `~/.claude/skills/ccg/domains/development/java.md` |
| C / C++ | `~/.claude/skills/ccg/domains/development/cpp.md` |
| Shell / Bash | `~/.claude/skills/ccg/domains/development/shell.md` |

## Frontend Design Domain (`domains/frontend-design/`)

| Trigger Keywords | Skill File |
|------------------|-----------|
| UI aesthetics, visual design, color theory, layout | `~/.claude/skills/ccg/domains/frontend-design/ui-aesthetics.md` |
| UX principles, usability, user flow, information architecture | `~/.claude/skills/ccg/domains/frontend-design/ux-principles.md` |
| component patterns, design system, atomic design | `~/.claude/skills/ccg/domains/frontend-design/component-patterns.md` |
| state management, Redux, Zustand, Pinia, context | `~/.claude/skills/ccg/domains/frontend-design/state-management.md` |
| frontend engineering, build tool, bundler, SSR, SSG | `~/.claude/skills/ccg/domains/frontend-design/engineering.md` |
| claymorphism | `~/.claude/skills/ccg/domains/frontend-design/claymorphism/SKILL.md` |
| glassmorphism | `~/.claude/skills/ccg/domains/frontend-design/glassmorphism/SKILL.md` |
| liquid glass | `~/.claude/skills/ccg/domains/frontend-design/liquid-glass/SKILL.md` |
| neubrutalism | `~/.claude/skills/ccg/domains/frontend-design/neubrutalism/SKILL.md` |

## SEO Domain (`domains/seo/`)

| Trigger Keywords | Skill File |
|------------------|-----------|
| SEO, CTR, impressions, GSC, Search Console, keywords, seoTitle, meta description, internal linking, content strategy, blog translation, watermark removal SEO, 曝光, 点击率, 踩词, 优化标题, 搜索排名 | `~/.claude/skills/ccg/domains/seo/seo-growth.md` |

## Data Engineering Domain (`domains/data-engineering/`)

| Trigger Keywords | Skill File |
|------------------|-----------|
| data pipeline, ETL, Airflow, Dagster, Prefect, Kafka Streams, Flink, Spark Streaming, dbt, data quality, Great Expectations, 数据管道, 流处理, 数据质量 | `~/.claude/skills/ccg/domains/data-engineering/SKILL.md` |

## Infrastructure Domain (`domains/infrastructure/`)

| Trigger Keywords | Skill File |
|------------------|-----------|
| Helm, Kustomize, Operator, CRD, GitOps, ArgoCD, Flux, IaC, Terraform, Pulumi, CDK, infrastructure as code, 基础设施即代码 | `~/.claude/skills/ccg/domains/infrastructure/SKILL.md` |

## Mobile Domain (`domains/mobile/`)

| Trigger Keywords | Skill File |
|------------------|-----------|
| iOS, Android, SwiftUI, UIKit, Jetpack Compose, Kotlin mobile, React Native, Flutter, mobile app, 移动开发, 跨平台开发 | `~/.claude/skills/ccg/domains/mobile/SKILL.md` |

## Routing Rules

1. **Keyword match is fuzzy** — match on intent, not exact string. "How to do SQL injection testing" triggers `pentest.md`.
2. **Multiple matches** — if a request spans two domains, read both skill files.
3. **Language detection** — automatically detect the programming language from file extensions or context, then read the corresponding development skill.
4. **Read once per conversation** — no need to re-read the same skill file within the same conversation.
5. **Skill files are authoritative** — when a skill file contradicts training data, the skill file wins.
