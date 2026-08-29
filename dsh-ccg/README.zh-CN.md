# dsh-ccg

**把 CCG 的多模型角色矩阵搬进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —— 七个角色委派工具，各自跑在自己的模型上，不依赖任何外部 CLI。任一角色都能挂多个模型同时作答，也能被雇成有自己文件的常驻队友。所有权与项目决策都是持久的。**

[English](./README.md) · MIT · 跟随 dsh `0.1.x` · 隶属 [CCG](https://github.com/fengshao1227/ccg-workflow) —— ⭐ 请点仓库，不是这个目录

---

## 快速上手

```sh
dsh plugin --profile web add dsh-ccg
```

照常启动，然后打开 **设置 › 插件 › CCG 角色矩阵**，把两个档位设好 —— 一个推理模型、一个快速模型，都从 harness 已经能连上的路由里挑。

配置就这些。**没有任何命令要记。** 用自己的话说需求就行：

> **src/ 下三个 parser 是空壳，按 src/contract.md 实现**
>
> 我判断这是 **Team**：三个 parser 可并行实现，且各自是独立文件。我会让三位 builder 分别负责 `nginx.js`、`json.js`、`apache.js` —— 三个队友、各一轮，合计 3 次模型调用 —— 然后由我对照契约和样例统一验收。要按这个来吗？

Agent 读你说的话，判断这活值多大阵仗，说出选了哪档、花多少，然后等你点头。一行能答的问题它直接答 —— 为那种问题请示，比答案本身更浪费你的时间。

四件事，不用学任何命令：

| 你想要 | 你就说 | 会发生什么 |
|--------|--------|------------|
| 一个专家的意见 | *「审一下这个 diff」* | 一个子代理跑在审查角色的模型上，带 CCG 的审查人设 |
| 好几个意见 | *「这个我想稳一点」* | 在卡片里给某个角色挂两个模型 —— 同一份简报、独立作答、答案并排 |
| 并行干活 | *「把这四个模块实现掉」* | `ccg_team` 每块雇一个同事，各自独占自己的文件 |
| 让决定留下来 | *「记住我们定了用 SQLite」* | 写进 `.ccg/memory.md`，之后每个会话自动加载 |

**不配档位也能用，但很亏。** 七个角色照常注册、人设照常生效，但它们全跑在同一个模型上 —— 你拿到了人设，却没拿到让「派出去」这件事值回一次往返的路由。没配之前，插件会在自己的提示词里把这句话说出来。

**审批弹窗是常态。** dsh 的沙箱在工作区写入之外的动作前都会问，所以一次「自己端到端验收」的运行会问上几次。这是 harness 的策略、不是本插件的；嫌烦可以在设置里把默认权限模式放宽。

**它往你磁盘上写什么。** 只有两样。工作区里的 `.ccg/memory.md` —— **建议提交进仓库**，那是你项目的决策，队友也要读；哪条不成立了就删哪条。以及 `~/.dsh/storages/ccg_team.json`，所有权地图，**刻意留在仓库外**，因为那是机器状态、不是知识。除此之外什么都不写：没有缓存、没有锁文件、没有往你 home 里塞点文件。

---

## 它做什么

一个模型很难同时胜任所有环节：审查要细，实现要快，设计要能推理。[CCG](https://github.com/fengshao1227/ccg-workflow) 在 Claude Code 上已经把这套「**不同角色用不同模型**」的纪律跑了一年，代价是每个后端都得驱动一个厂商 CLI —— 要装、要登录，每次调用还要付启动开销。

在 dsh 上这一层直接消失。本插件给主代理七个委派工具：

| 工具 | 角色 | 默认档位 | 子代理干什么 |
|------|------|----------|--------------|
| `ccg_analyze` | 分析 | strong | 只读分析：方案对比、取舍、排序后的推荐 |
| `ccg_design` | 架构 | strong | 蓝图：边界划分、接口契约、迁移路径 |
| `ccg_build` | 实现 | worker | 按既定方案写出完整可运行的代码 + 验证命令 |
| `ccg_debug` | 调试 | strong | 根因：证据、排序假设、修复方向 |
| `ccg_optimize` | 优化 | worker | 先测量、定位瓶颈、定向修复 |
| `ccg_review` | 审查 | strong | 分级发现（含 `file:line`）+ PASS / NEEDS_IMPROVEMENT |
| `ccg_test` | 测试 | worker | 集成与契约测试、边界用例 |

每个工具派出的子代理都跑在**自己的模型**上，并带着**自己的专家人设**（即 CCG 生产环境在用的角色提示词）。你只配两个档位，七个角色自动归位。

### 用户只管说话，harness 自己挑档位

没有命令要记。你把需求说出来，agent 自己判断这活值得多大阵仗、一句话说明判断，并且**在花钱之前**把代价报给你：

> **我想给 API 加限流。**
>
> 这个看起来是 **Deep**：限流取决于你的技术栈、部署拓扑，以及限额是否要跨实例生效。我会走 分析 → 架构 → 实现 → 测试 → 审查，合计 **5 次委派 / 8 次模型调用**。回复「yes, deep」开始，或者「standard」走更轻的 3 次委派版本。

问它 `isEven` 是干什么的，它直接答——为一个一行的问题请示，比答案本身更浪费你的时间。

这份菜单由**实际挂载的角色**生成，所以它不可能宣称一个本部署跑不了的步骤，也不可能报一个跟实际扣费对不上的模型数。你也可以直接点名档位，它就走那一档。`triage: false` 可以整段关掉。

### 子代理从什么开始

子代理默认**看不到你的对话**。多数时候这是对的——一个意见只有在独立形成时才值得问——但这样一来全部重量都压在你写的简报上，而那些**接着你的活往下做**的角色，本不该还要被告知刚刚商定了什么。

所以每个角色自己选：

```yaml
    roles:
      builder: { context: inherit }   # 从当前对话开始
      reviewer: { context: brief }    # 默认：只看你写的简报
```

`inherit` 走 dsh 的 `fork` provider，把父会话**已完成的每一轮**都种给子代理。对一个 fork 的 builder 问「我们用的哪个数据库」，简报里一个字没提，它照样答得出三轮之前商定的结论。

**模型群不许继承。** 读过你推理过程的成员是回声，不是第二意见——所以「挂了两个以上模型 + `context: inherit`」这种组合会在挂载时**直接报错**，而不是悄悄产出一片附和。

### 一个角色可以挂任意多个模型

给某个角色挂上多个模型，它就变成一个**模型群**：它们拿到同一份任务、戴着同一套专家人设、各自独立作答，答案并排返回。这才是 CCG 的另一半 —— 它的 `analyze` / `review` / `debug` 一直在做的事：两个模型分别回答，你真正要处理的是**它们分歧的地方**。

```yaml
ccg:
  roles:
    analyzer:
      models:                       # 想挂几个挂几个
        - { provider: gateway-a, model: a-reasoning-model }
        - { provider: gateway-b, model: a-rival-model }
        - { provider: gateway-c, model: a-third-opinion }
```

挂一个模型就是普通委派，走官方子代理工具；挂两个及以上才成为模型群。这里**不投票也不合并**：多数模型可以一起错，而把两个答案取平均通常会毁掉各自对的那部分 —— 所以每个答案都原样返回，裁决权留给手里握着上下文的那个模型。

`ccg_crosscheck` 是同一套机制、但不套角色人设的版本，适合那种不属于任何单一专业的问题。它问的是你配置的 `panel`，没配就问两个档位。

每一跳都是 provider API 请求。没有二进制桥接，没有逐厂商登录，没有冷启动税。

**而且答案是并排读的。** 模型群的调用会在对话流里渲染成一模型一列 —— 名字、路由、各自被指定的视角，以及**按它本来的样子渲染出来的 markdown** —— 而不是通用工具卡片给你的那一大坨滚动文本。跑的过程中，列里先列出正在被问的模型，所以不打开设置也看得见路由。

只有真正以模型群作答的工具会被接管渲染，挂一个模型的角色仍然用官方那一行 —— 它本来就渲染得很好。答案通过工具的 `output.presentationMeta`（harness 自己的持久呈现通道）送到浏览器，因此刷新页面、重放 session log 之后依然在，而不是只活在调用当时。

### 也可以把角色雇成常驻队友

角色工具是问一个问题、拿一个答案。`ccg_team` 则是**雇人**：同一个角色变成跨轮次存活的同事，可以用 `send_message` 继续派活，干完自己报回来。

```
ccg_team(role: "builder", description: "parser rewrite",
         owns: ["src/parse/"], prompt: "…")
→ builder teammate hired: 776d6301-…  Running on claude / claude-sonnet-5
```

雇几个就是几个人同时干。并行到底是帮忙还是把代码库搅烂，取决于两条规矩，插件把两条都写进了提示词：

- **一个文件只能有一个写者。** 每个并行队友拿到互不重叠的 `owns`，直接写进它的人设。两个 agent 改同一个文件会**无声**地互相覆盖 —— 这条同样约束编排者本人：整合时发现某个活队友的文件有问题，要把修改派回去，而不是自己偷偷改掉。
- **先把契约敲死。** 队友之间互相看不见，任何两人交汇的接口都必须先定下来、写进双方的简报，否则各自会造一个都挺合理但对不上的版本。

等待是免费的：报告会自己把编排者唤醒，所以**结束当前轮次就是等待的正确姿势** —— 不要 sleep，不要轮询，也不要去审查一个还没人写出来的文件凑数。发现某个队友明显在做错东西时，`interrupt_agent` 只停掉它当前那一轮、队友照样活着等你纠正。实测：被打断的队友转录里是 `turn 1 aborted (parent)`，然后 turn 2 干的是改正后的活。

**队友没法自己再雇一支队伍。** 在子代理里压掉约定只是拿走了邀请、没拿走能力，所以本插件启动的每个子代理都会被摘掉本插件的全部工具 —— 从一个真实队友的工具表里验证过：11 个 `ccg_*` 全部消失，它的 `report` 回传通道完好。它仍有 harness 自带的 `subagent`，那个跑在部署默认模型上，不会冒出按模型计价的意外。

这就是 CCG 的 Agent Teams，在 dsh 上不需要任何桥接：`startContinuable`、`send_message`、`report`、`interrupt_agent`、`list_agents` 全是原生的。本插件补的是每个队友背后的那个 CCG 角色 —— 它的人设、它的模型、它的文件所有权。设 `team: false` 则不注册 `ccg_team`。

### 雇人之前会先问你

每次雇人都要先确认才会启动：雇的哪个角色、跑在哪个模型上、要独占哪些文件。它走的是 harness 自己的 user-questions 通道和 `plan-review` 意图，所以呈现出来就是一次真正的「计划待审」，而不是本插件自造的卡片；拒绝会作为**普通结果**返回给模型，不是错误 —— 于是它会换个拆法，而不是原样重试。

这是这里唯一一件读下一条消息也撤不回来的事：同事立刻开始干活、跨轮次继续跑、并且把文件从所有人手里拿走（包括编排者自己）。提示词里的约定是「请你先问」，确认才是机制。没人盯着的场景把 `confirmHires` 设成 false 即可；没有询问 provider 的部署（headless）会自己跳过而不是卡死，而任何**没能完成确认**的雇佣都会在报告里明说，绝不假装问过。

### 所有权是强制的，不是请求的

「一个文件一个写者」是整套东西赖以成立的前提，所以它没有被留给人设里的一段散文。每次雇人都记进 harness 自己的持久存储域，而**伸手去碰别人文件的雇佣会在子代理启动之前就被拒**：

```
ccg: those files already belong to a teammate, and two writers on one file lose each
other's work with no error:
  builder (e9b3109d-abac) already owns memtest/src/parse.js
    — you asked for memtest/src, which overlaps their memtest/src/parse.js

Either give this teammate different files, or send the work to the owner with
send_message. To take the files back first, call ccg_roster with action "release".
```

判定刻意放宽 —— `src/`、`src/*.js`、`./src/a.js` 都会跟 `src/a.js` 判为相撞 —— 因为误报的代价是重写一次任务描述，漏报的代价是一次无声覆盖。

`ccg_roster` 把这张地图读回来：队伍里有谁、跑在什么模型上、哪些文件是谁的、当前什么状态 —— 而且**边读边清理**：harness 已经不再持有的队友，其记录会被退掉，免得一个被遗弃的队友永远占着没人能再写的文件。剪枝只依据服务自己的枚举、绝不靠启发式：列举失败就一行不动，刚雇几秒的队友天然免疫（服务本来就会暂时略过 descriptor 还没落盘的子代理）。**它活得比对话长。** 上下文一压缩，transcript 里那份就没了，这时它是唯一还知道谁管什么的东西。同一工作区里**别的会话**占着的文件会以警告形式出现而不是拒绝 —— 你没法给别人的队友发消息，一道你无从解除的锁只会变成死结。

### 项目记忆

`ccg_remember` 把一件事写到下个会话找得到的地方 —— 一个决定和它凭什么赢过备选、两边都要遵守的契约、一条约定、一个坑。落在工作区的 `.ccg/memory.md`：Markdown，人能读、能在 diff 里审、能把那条已经不成立的删掉。

这个文件随后会自动装进编排者的提示词，有字节上限，超了保留最新的。**冷启动实测过**：一个会话写下的契约，被**重启进程后的全新会话零工具调用**答了出来 —— 来自提示词，不是读文件。

刻意做窄。它不是流水账 —— transcript 已经是了，而一份塞满流水账的记忆就不值得再加载。

## 是实测，不是宣称

在真实 dsh 环境（`0.1.0-rc.6`，pi-ai 网关）读 session 存储验证 —— 哪个模型服务了哪一轮，那里是唯一真相：

```
父 session          model: glm-5.2            ← 编排者
ccg_review  子代理  model: deepseek-v4-pro    ← strong 档
ccg_build   子代理  model: deepseek-v4-flash  ← worker 档
```

一次会话，三个模型，按角色分流。子代理的记录里也带着它的角色人设，`provider: spawn` 证明它跑在进程内 —— 全程没有拉起任何 CLI。零配置安装时七个工具也全部可用。

并排渲染也是同样的验法：一次三模型的 `ccg_analyze` 调用渲染成三列，然后重启服务、刷新页面，渲染结果一模一样 —— 这才证明答案是走持久呈现通道来的，而不是靠任何活的东西撑着。

队伍常驻条是跑完一整次雇人验的：轮次进行中人数从 1 变 2、新来的标成在跑，结算后落回去，交给它的那个文件（`add(a, b)`，别人碰不到）事后确实在那儿。全部结算十秒后条子一个请求都没再发 —— 这是一个轮询式 UI 必须自己挣来的那部分。

雇佣确认两条臂都验过。同意时渲染成 harness 自己的「计划待审」卡片（角色、模型、文件、简报俱全），队友随即启动、干活、结算。拒绝时**一个都没起**：没有子代理、没有文件、所有权表里也没有多出一行；模型收到的是普通结果 "Not hired"，然后就停下了，没有再试一次。

团队也是同样的验法，用的是一个三份解析器、共用一份契约的活。编排者没被提示就自己选了 Team，报出怎么拆、等到确认才动手；雇了三个 builder，`owns` 分别是 `[src/nginx.js] / [src/json.js] / [src/apache.js]`，契约抄进了每一份简报；三人全部报回并结算，编排者把成品端到端跑了一遍 —— 六行样例解析出五行、第六行按约定拒绝、畸形输入没有一个抛异常。第二次跑验证了反向通路：一个队友、两件任务，第二件是在第一份报告到达后通过 `send_message` 派下去的。

## 自带的 skills

本包还通过官方 filesystem provider 发布六个 skill，用的是独立的 provider 名，你原有的 skill 根不受影响：

| Skill | 是什么 |
|-------|--------|
| `ccg-workflow` | 编排 playbook：哪个阶段派哪个角色、怎么给「看不到上下文的子代理」写清任务简报、哪些决策必须留在主模型手里、何时可以并行、以及怎么带一支团队 |
| `verify-change` | 分析 diff，标出没跟上改动的文档 |
| `verify-quality` | 复杂度、重复代码、命名、函数与文件长度 |
| `verify-security` | 危险模式、注入面、密钥泄漏 |
| `verify-module` | 新模块的结构完整性与必备文档 |
| `gen-docs` | 生成模块的 README 与 DESIGN 骨架 |

五个关卡是 CCG 自己的扫描器，原样打包。它们是确定性的量具 —— 在 `ccg_review` 之前先跑，让审查模型把这一轮花在判断上，而不是花在脚本已经知道的事实上。

`skills: false` 可以一个都不发布；`skillDirs` 可以再加入你自己的 skill 根目录。

## 安装

```sh
dsh plugin --profile web add ./dsh-ccg     # 从本地检出安装
```

装完照常启动。**不配置也能用**：七个角色照常注册，子代理跑在部署默认模型上，人设立刻生效；配上档位才开启模型分流。

想先试再装：

```sh
dsh --profile headless --patch ./cordis.dev.yml "你的任务"
```

（先改 `cordis.dev.yml` 里的绝对路径 —— 加载器需要真实的源码路径。）

## 在界面里配置

插件自带的浏览器半边有三个界面。

矩阵在 **设置 › 插件 › 插件配置** 里有一张卡片：两个档位可直接编辑、被用户层覆盖的档位带「已覆盖」标记、每个角色一行可以从 harness 真正能连上的路由里挂任意多个模型，还有一个「是否允许雇队友」的开关。编辑是暂存的，点保存才落盘 —— 写设置是一次持久的文档变更，不该由某个控件在失焦时替你完成。给某个角色加上第二个模型之后，它的调用从下一次起就按模型群渲染，不用刷新页面。

第二个就是上面说的模型群并排视图，注册在对话流的 `tool.call.toolview` 插槽上，以每个模型群工具自己的名字为 key。

三个界面都**能借就借 harness 自己的组件库**（`dsh-client-ui-primitives`）—— 跟 app 其余部分同一套按钮、状态点和 markdown 渲染器；借不到就退回本插件自己的那套。两种情况下都不需要构建步骤。

第三个是输入框上方的**队伍常驻条**：谁被雇了、各自独占哪些文件、谁还在跑。只有真的有队伍时才出现，单干的会话永远看不到它。所有权是这个插件唯一一条机械保证，而在此之前想看一眼只能花一轮让模型去读 `ccg_roster` —— 去问 harness 一件它本来就知道的事。它读自己的 `/api/ccg/team` 路由，**只在有轮次在跑或还有队友在干活时轮询**，全部结算后一个请求都不发。读它永远不会改动名册：`ccg_roster` 会清理 harness 已经不认识的行，因为模型去读名册是一次有意识的动作，而浏览器后台的一个 GET 悄悄把文件解除占用不是。

这张卡片读写走的是本插件自己的 `/api/ccg/config` 路由，而不是客户端 settings scope。这不是偷懒：`dsh-host-apiproxy` 用一份固定白名单决定哪些 settings namespace 下发给浏览器，原则是「**后来注册的 namespace 不会默认变成可远程读写**」，第三方 namespace 刻意不在其中。写入仍然由主机端通过 profile patch 之下的同一个 settings scope 完成，且非本机的写入一律拒绝。

## 手工配置

写进 profile 的 `cordis.patch.yml`：

```yaml
- id: ccg
  name: dsh-ccg
  config:
    strong:
      provider: my-gateway      # llm-pi-ai.providers 下的路由名
      model: a-reasoning-model
    worker:
      provider: my-gateway
      model: a-fast-model
```

`provider` 指向你在 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers` 里声明的路由。任何厂商 API 或 OpenAI 兼容网关都可以。

……或者写进 harness 的设置文档（`$DSH_HOME/settings.yaml`）——设置面板里「打开配置文件」打开的就是它，而且**改完实时生效、无需重启**：

```yaml
ccg:
  strong: { provider: my-gateway, model: a-reasoning-model }
  worker: { provider: my-gateway, model: a-fast-model }
```

插件把 `ccg` 注册成了 settings namespace：profile patch 是合成基座，这一段是压在它上面的用户层。改动会先退掉当前这批角色工具，再原地注册新的一批。

单个角色的覆盖写在 `roles` 下：

```yaml
    roles:
      builder:   { tier: strong }                          # 把某个角色挪到另一档
      reviewer:  { provider: other-gw, model: specialist }  # 单独钉死某角色的模型
      optimizer: { enabled: false }                        # 关掉某个角色
      analyzer:  { toolName: deep_think }                  # 重命名它的工具
```

| 配置项 | 默认 | 含义 |
|--------|------|------|
| `strong` / `worker` | 未设 | 两个模型档位。未设时子代理走部署默认模型。 |
| `roles.<name>` | — | 单角色的 `enabled`、`tier`、`provider`、`model`、`maxTokens`、`toolName`。 |
| `subagentProvider` | `spawn` | 委派走的 `ctx.subagents` provider。`spawn` 在进程内跑子代理，人设正是靠它支持。 |
| `maxDepth` | `2` | 角色子代理的委派深度上限。 |
| `backgroundMode` | `one-shot` | `one-shot` 默认前台返回结果 —— 编排轮次通常要的就是这个。 |
| `team` | `true` | 注册 `ccg_team`：把角色雇成常驻队友。需要 subagent provider 支持让子代理存活。 |
| `teamTool` | `ccg_team` | 给雇人工具改名。 |
| `memory` | `true` | 通过存储域持久记录文件所有权、拒绝相撞的雇佣、注册 `ccg_roster`。 |
| `knowledge` | `true` | 注册 `ccg_remember`，并把工作区的 `.ccg/memory.md` 装进编排者提示词。 |
| `knowledgeMaxBytes` | `8192` | 装进提示词的项目记忆字节上限；超出时保留最新的笔记。 |
| `isolateChildren` | `true` | 把本插件自己的工具从它启动的每个子代理里摘掉，免得子代理去雇一支用户没批准的队伍。需要 provider 具备 `toolFilter` 能力（默认的 `spawn` 有）。 |
| `routingPrompt` | `true` | 把路由约定（哪个工具干什么、跑在哪个模型上）写进系统提示词。 |
| `skills` | `true` | 发布自带的 skill：工作流 playbook 与质量关卡。 |
| `skillDirs` | `[]` | 额外的 skill 根目录：指向 `<name>/SKILL.md` 集合的绝对路径。 |

角色名或档位名写错会**在挂载时响亮报错**并列出合法值，而不是静默把子代理降级到默认模型。

## 工作原理

本插件不重造委派轮子，而是**按角色多次挂载官方的
[`@deepseek-ai/dsh-tool-subagent`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/subagent)**，每个实例通过它 schema 校验过的 `agentOptions` 与 `persona` 钉住模型和人设。后台任务、深度检查、取消、渲染、结算全部保持官方行为；本包新增的是角色→模型矩阵、人设，以及路由约定。只有官方工具表达不了的两件事才自带工具：一是 panel —— 多个成员并行作答同一份简报；二是雇人 —— 必须一次调用就能雇到任意角色，而不是每个角色挂一个实例。

写进系统提示词的各项约定由解析后的真实矩阵生成，因此**不可能**宣称某个角色跑在它其实没绑定的模型上。它们还**只发给正在跟你对话的那个 agent** —— `systemPrompt` 注册是全局的，不做这层隔离的话，每个被委派的子代理都要为一份「怎么分诊」的约定付 token，还会被邀请在深度上限内自己去雇一支队伍。

## 依赖要求

- DeepSeek Harness `0.1.0-rc.6` 或更新（开发者预览版，插件 API 仍在变动）
- 至少配置一个 provider 路由，且凭据已存进 harness（网页 **设置 › 模型** 页会写入）—— `apiKeyEnv` 没设的路由会在第一次请求时失败，而不是启动时
- 人设需要 subagent provider 具备 `persona` 能力（默认的 `spawn` 具备）

## 开发

```sh
node --test test/*.test.mjs
```

角色矩阵的解析收敛在一个纯函数（`resolveRoles`）里，所以「哪个角色用哪个模型」可以脱离 harness、不花一个 token 就完成单测。

## 它是 CCG 的一部分

这个插件就住在 [**CCG**](https://github.com/fengshao1227/ccg-workflow) 仓库的 `dsh-ccg/` 目录下。CCG 是同一套纪律在 Claude Code 上的形态（`npx ccg-workflow`），同一套角色提示词在那里驱动 Claude、Codex、Gemini、Grok、Kimi 与 OpenCode。一个仓库、两个包：issue、star 和 PR 都归 CCG。

如果它对你有用，star 请点[仓库](https://github.com/fengshao1227/ccg-workflow)。

MIT。
