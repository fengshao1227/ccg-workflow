/**
 * Browser half — two surfaces.
 *
 * 1. The CCG card in Settings › Plugins › Plugin configuration. The Plugins tab
 *    renders no form it was not given: a plugin that wants a card there ships
 *    this file and registers into the `settings.plugin.item` slot.
 * 2. The panel view in the conversation. `tool.call.toolview` is keyed by wire
 *    tool name, so registering under `ccg_analyze` takes over how that tool's
 *    calls render — which is how a panel's answers come back side by side
 *    instead of as one blob of text in a generic card.
 *
 * Both read this plugin's own `/api/ccg/config` route rather than the client
 * settings scope, because the harness serves settings namespaces to the browser
 * from a fixed allowlist and a third-party namespace is deliberately not on it.
 * The Host still owns every write — see src/api.js.
 *
 * Written as a plain module rather than a bundled one: the loader hands the
 * factory its own `require`, so hand-written `React.createElement` needs no
 * build step, and what ships is what you can read.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ccg',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')

    /**
     * Borrow the harness's own component kit, if this deployment will lend it.
     *
     * `@deepseek-ai/dsh-client-ui-primitives` is NOT a plugin bundle: it has no
     * `dsh.client` entry and does not appear in `window.__DSH_BOOT__`, so a
     * plain module can only reach it through the shell's static registry — a
     * fact about the deployment, not a promise in a contract. The synchronous
     * `require` handed to a factory throws when a specifier resolves nowhere,
     * and that throw would take this whole file down with it: the settings
     * card, the panel view and the team strip all at once.
     *
     * So every borrowed piece has a fallback this file owns. The kit makes the
     * surfaces match the app exactly; its absence costs polish and nothing else.
     */
    function borrowKit() {
      try {
        const kit = require('@deepseek-ai/dsh-client-ui-primitives')
        return kit !== null && typeof kit === 'object' ? kit : {}
      } catch {
        return {}
      }
    }

    const kit = borrowKit()

    /** Dictionary namespace owned by this plugin. */
    const NS = 'ccg'

    /** Required browser services (cordis fiber inject). */
    const inject = ['slots', 'locale']

    /** Where the host half serves this card's section. */
    const API = '/api/ccg/config'

    /** Where the host half serves one conversation's team. */
    const TEAM_API = '/api/ccg/team'

    /**
     * How often the strip re-reads the roster while anything is in flight.
     *
     * The dock's owner share is a point-in-time snapshot and explicitly says not
     * to subscribe, and the harness exposes no event a third-party plugin could
     * listen to for "a teammate was hired". So it polls — but only while a turn
     * is running or a teammate is still working, and stops on its own once
     * everything has settled. An idle session with a settled team makes no
     * requests at all.
     */
    const TEAM_POLL_MS = 4000

    /**
     * Tag on the panel payload the host projects into the tool result's
     * presentation metadata. Kept in step with `PANEL_META_KIND` in
     * src/crosscheck.js — the two halves ship together, and a mismatch makes
     * this view stand down to the generic rendering rather than guess.
     */
    const PANEL_META_KIND = 'ccg.panel/1'

    const TIERS = ['strong', 'worker']

    const en = {
      title: 'CCG role matrix',
      summary:
        'Seven roles, each delegating to the model you give it, with its own expert persona. '
        + 'Set the two tiers as defaults, then give any single role a model of its own.',
      strong: 'Reasoning tier',
      strongHint: 'the default for analysis, design, debugging and review',
      worker: 'Fast tier',
      workerHint: 'the default for implementation, optimisation and tests',
      roles: 'Per-role model',
      rolesHint: 'Leave a role on its tier, or give it as many models as you like — two or more answer the same brief together and come back side by side.',
      followTier: 'follow tier',
      addModel: '+ add a model',
      panelOf: 'answer together',
      team: 'Teams',
      teamHint: 'Hiring lets a role be taken on as a live teammate that keeps working across turns, '
        + 'takes more work through send_message, and reports back on its own — for a job that splits '
        + 'across files. Each teammate runs on the model set for its role above.',
      teamOn: 'roles can be hired as teammates',
      teamOff: 'roles answer one question at a time',
      remove: 'remove',
      deploymentDefault: 'deployment default model',
      unset: 'not set',
      overridden: 'overridden',
      unsaved: 'Unsaved changes',
      save: 'Save',
      discard: 'Discard',
      saving: 'Saving…',
      loading: 'Loading…',
      failed: 'The harness did not accept that change.',
      unreachable: 'Could not reach the plugin. Is it still installed?',
      noModels: 'No provider route is configured yet — add one under Settings › Models.',
      analyzer: 'Analyze',
      architect: 'Design',
      builder: 'Build',
      debugger: 'Debug',
      optimizer: 'Optimize',
      reviewer: 'Review',
      tester: 'Test',
      'panel.title': 'Panel',
      'panel.running': '{count} models answering…',
      'panel.answered': '{answered} of {total} answered',
      'panel.stopped': 'Stopped',
      'panel.failed': 'The panel did not run',
      'panel.noAnswer': 'no answer',
      'panel.expand': 'Show full answers',
      'panel.collapse': 'Collapse',
      'panel.inspect': 'Inspect',
      'panel.read': 'Answered independently — where they disagree is the finding.',
      'dock.team': 'Team',
      'dock.hired': '{count} hired',
      'dock.running': '{count} working',
      'dock.owns': 'owns',
      'dock.ownsNothing': 'no files of its own',
      'dock.default': 'deployment default',
    }

    const zh = {
      title: 'CCG 角色矩阵',
      summary:
        '七个角色，每个都用你指定的模型派子代理，并带着自己的专家人设。'
        + '先把两个档位设成默认，再给任意单个角色单独指定模型。',
      strong: '推理档',
      strongHint: '分析、架构、调试、审查默认走这一档',
      worker: '快速档',
      workerHint: '实现、优化、测试默认走这一档',
      roles: '各角色模型',
      rolesHint: '保持跟随档位，或给它挂任意多个模型 —— 两个以上会同时作答同一份任务，答案并排返回。',
      followTier: '跟随档位',
      addModel: '+ 添加模型',
      panelOf: '同时作答',
      team: '团队',
      teamHint: '开启后，任何角色都能被雇成常驻队友：跨轮次持续工作，可以用 send_message 继续派活，'
        + '干完自己报回来 —— 适合能拆成几块并行推进的活。队友用的就是上面给该角色配的模型。',
      teamOn: '角色可被雇为常驻队友',
      teamOff: '角色只回答单次提问',
      remove: '移除',
      deploymentDefault: '部署默认模型',
      unset: '未设置',
      overridden: '已覆盖',
      unsaved: '有未保存的修改',
      save: '保存',
      discard: '放弃',
      saving: '保存中…',
      loading: '加载中…',
      failed: '本次修改未被 harness 接受。',
      unreachable: '连不上插件，它还装着吗？',
      noModels: '还没有配置任何模型路由 —— 先到 设置 › 模型 里加一个。',
      analyzer: '分析',
      architect: '架构',
      builder: '实现',
      debugger: '调试',
      optimizer: '优化',
      reviewer: '审查',
      tester: '测试',
      'panel.title': '模型群',
      'panel.running': '{count} 个模型作答中…',
      'panel.answered': '{answered} / {total} 已作答',
      'panel.stopped': '已中止',
      'panel.failed': '这次模型群没跑起来',
      'panel.noAnswer': '未作答',
      'panel.expand': '展开全文',
      'panel.collapse': '收起',
      'panel.inspect': '查看轨迹',
      'panel.read': '各自独立作答 —— 分歧处才是结论所在。',
      'dock.team': '队伍',
      'dock.hired': '{count} 人',
      'dock.running': '{count} 在跑',
      // "独占", not "负责": the claim is exclusive write ownership, which is the
      // guarantee being shown. It also stops colliding with a teammate label —
      // a model naming one "负责 parse.js" made the row read "负责 … 负责 …".
      'dock.owns': '独占',
      'dock.ownsNothing': '无独占文件',
      'dock.default': '部署默认模型',
    }

    // Colours come from the harness design tokens (`--dsw-alias-*`, defined by
    // dsh-client-ui-theme and switched per light/dark), each with the literal
    // that stood here before as its fallback — so a deployment whose theme does
    // not define one degrades to the old look rather than to nothing.
    const styles = `
.ccg-card { border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22)); border-radius: 10px;
  padding: 16px 18px; display: flex; flex-direction: column; gap: 13px; list-style: none; }
.ccg-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.ccg-title { font-weight: 600; margin: 0; }
.ccg-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid currentColor; opacity: 0.7; }
.ccg-summary, .ccg-note { margin: 0; font-size: 12.5px; line-height: 1.65;
  color: var(--dsw-alias-label-secondary, inherit); opacity: 0.9; }
.ccg-section { display: flex; flex-direction: column; gap: 9px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.16)); padding-top: 12px; }
.ccg-row { display: grid; grid-template-columns: minmax(96px, 150px) 1fr; gap: 12px;
  align-items: center; }
.ccg-row-label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ccg-row-name { font-size: 13px; font-weight: 600; display: flex; align-items: baseline; gap: 6px; }
.ccg-row-hint { font-size: 11.5px; font-family: ui-monospace, Menlo, monospace;
  color: var(--dsw-alias-label-tertiary, inherit); opacity: 0.75;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccg-select { height: 32px; padding: 0 8px; font: inherit; font-size: 13px; color: inherit;
  background: transparent; border-radius: 6px; width: 100%;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3)); }
.ccg-select:focus { outline: none; border-color: currentColor; }
.ccg-picks { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ccg-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px;
  font-family: ui-monospace, Menlo, monospace; padding: 3px 6px 3px 9px; border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.14)); }
.ccg-chip-x { cursor: pointer; border: none; background: none; color: inherit; font: inherit;
  opacity: 0.55; padding: 0 2px; line-height: 1; }
.ccg-chip-x:hover { opacity: 1; }
.ccg-add { height: 26px; padding: 0 6px; font: inherit; font-size: 12px; color: inherit;
  background: transparent; border-radius: 6px;
  border: 1px dashed var(--dsw-alias-border-l3, rgba(128,128,128,0.4)); }
.ccg-panel-badge { font-size: 11px; color: var(--dsw-alias-label-tertiary, inherit); opacity: 0.8; }
.ccg-switch { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px;
  color: var(--dsw-alias-label-secondary, inherit); cursor: pointer; }
.ccg-switch input { margin: 0; cursor: pointer; }
.ccg-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.16)); padding-top: 12px; }
.ccg-spacer { flex: 1; }
.ccg-btn { height: 30px; padding: 0 14px; font: inherit; font-size: 13px; border-radius: 6px;
  cursor: pointer; color: inherit; background: transparent;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3)); }
.ccg-btn[disabled] { opacity: 0.4; cursor: default; }
.ccg-btn-primary { border-color: transparent; color: #fff;
  background: var(--dsw-alias-button-primary-fill, #2f6feb); }
.ccg-status { font-size: 12px; color: var(--dsw-alias-label-secondary, inherit); }
.ccg-status-error { color: var(--dsw-alias-state-error-primary, #c0392b); }

.ccg-pv { display: flex; flex-direction: column; gap: 8px; margin: 2px 0;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22)); border-radius: 10px;
  padding: 10px 12px; background: var(--dsw-alias-bg-layer-2, transparent); }
.ccg-pv-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.ccg-pv-name { font-size: 12.5px; font-weight: 600; }
.ccg-pv-count { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); opacity: 0.85; }
.ccg-pv-count[data-error] { color: var(--dsw-alias-state-error-primary, #c0392b); opacity: 1; }
.ccg-pv-q { font-size: 12.5px; line-height: 1.5; min-width: 0; flex: 1;
  color: var(--dsw-alias-label-secondary, inherit);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccg-pv[data-open] .ccg-pv-q { white-space: normal; }
/* Narrow enough that three members still sit in one row at the conversation's
   width — a panel wrapped onto two rows is no longer a comparison. */
.ccg-pv-grid { display: grid; gap: 10px; align-items: start;
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr)); }
.ccg-pv-col { min-width: 0; display: flex; flex-direction: column; gap: 5px;
  border-top: 2px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22)); padding-top: 7px; }
.ccg-pv-col[data-error] { border-top-color: var(--dsw-alias-state-error-primary, #c0392b); }
.ccg-pv-col-head { display: flex; align-items: center; gap: 5px; min-width: 0; }
.ccg-pv-col-name { font-size: 12px; font-weight: 600; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.ccg-pv-col-route { font-size: 11px; font-family: ui-monospace, Menlo, monospace;
  color: var(--dsw-alias-label-tertiary, inherit); opacity: 0.8;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccg-pv-col-lens { font-size: 11px; color: var(--dsw-alias-label-tertiary, inherit); opacity: 0.8; }
/* Clamped by height rather than line count: the body holds rendered markdown,
   and -webkit-line-clamp counts lines only inside a -webkit-box, which a
   document of headings and lists is not. A height cut can land mid-line, so the
   fade below says the column continues rather than pretending it ended. */
.ccg-pv-body { font-size: 12.5px; line-height: 1.6; overflow-wrap: anywhere;
  position: relative; max-height: 19em; overflow: hidden; }
.ccg-pv-body::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0;
  height: 2.2em; pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--dsw-alias-bg-layer-2, transparent)); }
.ccg-pv[data-open] .ccg-pv-body { max-height: none; overflow: visible; }
.ccg-pv[data-open] .ccg-pv-body::after { content: none; }
.ccg-pv-body[data-error] { color: var(--dsw-alias-state-error-primary, #c0392b);
  white-space: pre-wrap; }
/* The fallback when no markdown renderer could be borrowed: the source text,
   preserved rather than collapsed. */
.ccg-plain { white-space: pre-wrap; }
/* Rendered markdown inside a column. The renderer sizes its blocks for a
   full-width message — 16px paragraphs — which in a third-width column both
   overflows the clamp in a few lines and, left alone, ends up LARGER than the
   headings above them. So the document is rescaled as a whole, and the
   wrapper's first/last block margins are dropped — the wrapper is a div of its
   own, so a plain child selector never reaches the actual first block.
   NOTE: no backticks anywhere in this stylesheet; it is a template literal. */
.ccg-pv-body > *:first-child, .ccg-pv-body > * > *:first-child { margin-top: 0; }
.ccg-pv-body > *:last-child, .ccg-pv-body > * > *:last-child { margin-bottom: 0; }
.ccg-pv-body :is(p, li, td, th, blockquote) { font-size: 12.5px; line-height: 1.6; }
.ccg-pv-body :is(h1, h2, h3, h4, h5, h6) { font-size: 13px; margin: 0.9em 0 0.3em; }
.ccg-pv-body :is(code, pre) { font-size: 11.5px; }
.ccg-pv-body :is(p, ul, ol, pre) { margin: 0.5em 0; }
.ccg-pv-body :is(ul, ol) { padding-left: 1.3em; }
/* A table written for a full-width message does not fit a third of one; let it
   scroll inside its own column rather than push the grid apart. */
.ccg-pv-body :is(pre, table) { overflow-x: auto; display: block; max-width: 100%; }
.ccg-pv-body table { font-size: 12px; }
/* The dot fallback, used only where the app's own StateDot is unavailable. */
.ccg-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; flex: none;
  background: var(--dsw-alias-label-tertiary, rgba(128,128,128,0.7)); }
.ccg-dot[data-state="ongoing"] { background: var(--dsw-alias-state-success-primary, #2e9e5b); }
.ccg-dot[data-state="error"] { background: var(--dsw-alias-state-error-primary, #c0392b); }
.ccg-btn-sm { height: 26px; padding: 0 10px; font-size: 12px; }
.ccg-pv-foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ccg-pv-read { font-size: 11.5px; flex: 1; min-width: 0;
  color: var(--dsw-alias-label-tertiary, inherit); opacity: 0.8; }
.ccg-pv-link { font: inherit; font-size: 11.5px; padding: 0; border: none; background: none;
  cursor: pointer; color: var(--dsw-alias-brand-text, inherit); text-decoration: underline;
  text-underline-offset: 2px; }

/* The dock is a full-width row, but the composer card inside it is not: it is
   centred at --dsh-composer-card-max-width inside --dsh-composer-side-clearance
   padding. A strip that ignored both would float over the empty margins instead
   of sitting on top of the card. Mirroring the shipped rules rather than a
   measured number keeps them aligned if the layout changes.
   Layout is the --dsh- variable family; colour is --dsw-alias-. */
.ccg-td-seat { width: 100%; box-sizing: border-box; display: flex; justify-content: center;
  padding: 0 var(--dsh-composer-side-clearance, 0px); }
.ccg-td { box-sizing: border-box; width: 100%;
  max-width: var(--dsh-composer-card-max-width, 780px);
  display: flex; flex-direction: column; gap: 6px; padding: 6px 10px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.22)); }
.ccg-td-head { display: flex; align-items: center; gap: 8px; width: 100%; cursor: pointer;
  font: inherit; color: inherit; background: none; border: none; padding: 0; text-align: left; }
.ccg-td-name { font-size: 12px; font-weight: 600; flex: none; }
.ccg-td-count { font-size: 11.5px; color: var(--dsw-alias-label-tertiary, inherit); opacity: 0.85; }
.ccg-td-spacer { flex: 1; }
.ccg-td-chevron { font-size: 10px; color: var(--dsw-alias-label-tertiary, inherit); flex: none; }
.ccg-td-rows { display: flex; flex-direction: column; gap: 5px; }
.ccg-td-row { display: flex; align-items: baseline; gap: 8px; font-size: 11.5px; min-width: 0; }
.ccg-td-role { font-weight: 600; flex: none; }
.ccg-td-label { color: var(--dsw-alias-label-secondary, inherit); min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ccg-td-route, .ccg-td-owns { font-family: ui-monospace, Menlo, monospace;
  color: var(--dsw-alias-label-tertiary, inherit); opacity: 0.85; }
.ccg-td-owns { margin-left: auto; flex: none; max-width: 55%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`

    /**
     * The app's own state dot, or a plain coloured circle.
     *
     * @param props - `{ state: 'done' | 'ongoing' | 'error' | 'warning' }`.
     * @returns the dot.
     */
    const Dot = kit.StateDot ?? function Dot(props) {
      return React.createElement('span', { className: 'ccg-dot', 'data-state': props.state })
    }

    /**
     * The app's own button, or a plain one wearing this file's classes.
     *
     * @param props - `{ variant, size, ...button }`.
     * @returns the button.
     */
    const Button = kit.Button ?? function Button(props) {
      const { variant, size, icon, className, children, ...rest } = props
      return React.createElement(
        'button',
        {
          type: 'button',
          className: `ccg-btn${variant === 'primary' ? ' ccg-btn-primary' : ''}`
            + `${size === 'sm' ? ' ccg-btn-sm' : ''}${className ? ` ${className}` : ''}`,
          ...rest,
        },
        children,
      )
    }

    /**
     * Assistant markdown rendered as markdown.
     *
     * This is the one borrowing that changes what the reader sees rather than
     * how it looks: a model's answer IS markdown, and shown as preformatted
     * text it arrives with its `##` and `**` intact — worst of all in the panel,
     * where the whole point is reading several answers against each other.
     *
     * @param props - `{ text }`.
     * @returns the rendered document, or the source text when there is no renderer.
     */
    const Markdown = kit.MarkdownText ?? function Markdown(props) {
      return React.createElement('div', { className: 'ccg-plain' }, props.text)
    }

    /** Inject the card's stylesheet; the disposer removes it. */
    function mountStyles() {
      const el = document.createElement('style')
      el.dataset.ccg = 'card'
      el.textContent = styles
      document.head.appendChild(el)
      return () => el.remove()
    }

    /** Encode a provider/model pair as one option value; '' means unset. */
    function pairKey(provider, model) {
      return provider && model ? JSON.stringify([provider, model]) : ''
    }

    /** Decode an option value back into a pair, or null when unset. */
    function parseKey(key) {
      if (!key) return null
      const [provider, model] = JSON.parse(key)
      return { provider, model }
    }

    /**
     * Reduce a payload to the selections the form edits: one option key per
     * tier and one per role ('' meaning the role follows its tier).
     *
     * @param payload - the `/api/ccg/config` body.
     * @returns the stored selection state.
     */
    function toSelection(payload) {
      const tiers = {}
      for (const tier of TIERS) {
        const entry = payload?.tiers?.[tier]
        tiers[tier] = pairKey(entry?.provider, entry?.model)
      }
      const roles = {}
      for (const entry of payload?.roles ?? []) {
        // Only a role that names its own models is edited here; one following
        // its tier shows no picks, so changing the tier keeps moving it.
        roles[entry.role] = entry.pinned
          ? (entry.members ?? []).map((member) => pairKey(member.provider, member.model))
          : []
      }
      // Hiring is on unless the document turned it off. Before the payload
      // arrives, match that default so the control does not flick.
      const team = payload?.team?.enabled !== false
      return { tiers, roles, team }
    }

    /** Whether two lists of option keys hold the same picks in the same order. */
    function samePicks(a = [], b = []) {
      return a.length === b.length && a.every((key, index) => key === b[index])
    }

    /**
     * The CCG card. Edits are staged and written only on save: a settings write
     * is a durable document mutation, so a control that committed as it settled
     * would store an edit the user never asked for.
     *
     * @param props - injected localisation binding.
     * @returns the card.
     */
    function CcgCard(props) {
      const { t } = props
      const [payload, setPayload] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      const load = React.useCallback(() => fetch(API, { headers: { Accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status)))), [])

      React.useEffect(() => {
        let cancelled = false
        load()
          .then((body) => {
            if (cancelled) return
            setPayload(body)
            publishConfig(body)
          })
          .catch(() => { if (!cancelled) setError('unreachable') })
        return () => { cancelled = true }
      }, [load])

      const stored = React.useMemo(() => toSelection(payload), [payload])
      const current = draft ?? stored
      const models = payload?.models ?? []

      const dirty = TIERS.some((tier) => current.tiers[tier] !== stored.tiers[tier])
        || current.team !== stored.team
        || Object.keys(current.roles).some(
          (role) => !samePicks(current.roles[role], stored.roles[role]),
        )

      const setTier = (tier, key) => {
        setError(null)
        setDraft({ ...current, tiers: { ...current.tiers, [tier]: key } })
      }
      const setRolePicks = (role, picks) => {
        setError(null)
        setDraft({ ...current, roles: { ...current.roles, [role]: picks } })
      }
      const addRoleModel = (role, key) => {
        if (!key) return
        const picks = current.roles[role] ?? []
        if (picks.includes(key)) return
        setRolePicks(role, [...picks, key])
      }
      const removeRoleModel = (role, key) => {
        setRolePicks(role, (current.roles[role] ?? []).filter((pick) => pick !== key))
      }
      const setTeam = (enabled) => {
        setError(null)
        setDraft({ ...current, team: enabled })
      }

      const save = async () => {
        setBusy(true)
        setError(null)
        const patch = {}
        for (const tier of TIERS) {
          if (current.tiers[tier] !== stored.tiers[tier]) patch[tier] = parseKey(current.tiers[tier])
        }
        const roles = {}
        for (const role of Object.keys(current.roles)) {
          if (samePicks(current.roles[role], stored.roles[role])) continue
          const picks = current.roles[role] ?? []
          // No picks means the role goes back to following its tier.
          roles[role] = picks.length === 0 ? null : { models: picks.map(parseKey) }
        }
        if (Object.keys(roles).length > 0) patch.roles = roles
        if (current.team !== stored.team) patch.team = current.team
        try {
          const response = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          })
          if (!response.ok) throw new Error(response.status)
          const body = await response.json()
          setPayload(body)
          // A role that just gained a second model is a panel from the next
          // call on; the conversation view needs to hear that without a reload.
          publishConfig(body)
          setDraft(null)
        } catch {
          setError('failed')
        } finally {
          setBusy(false)
        }
      }

      const h = React.createElement
      const writable = Boolean(payload?.writable) && !busy

      // Grouped by provider route, so the route and the model are both visible
      // in one control and no combination can be typed that does not exist.
      const byProvider = new Map()
      for (const entry of models) {
        if (!byProvider.has(entry.provider)) byProvider.set(entry.provider, [])
        byProvider.get(entry.provider).push(entry)
      }
      const modelOptions = (skip = []) => [...byProvider.entries()].map(([provider, entries]) => {
        const options = entries
          .filter((entry) => !skip.includes(pairKey(entry.provider, entry.id)))
          .map((entry) => h(
            'option',
            { key: `${entry.provider}//${entry.id}`, value: pairKey(entry.provider, entry.id) },
            entry.name,
          ))
        return options.length === 0
          ? null
          : h('optgroup', { key: provider, label: provider }, options)
      })

      /** A label naming a model, with the route it comes from. */
      const pickLabel = (key) => {
        const pair = parseKey(key)
        if (pair === null) return ''
        const known = models.find(
          (entry) => entry.provider === pair.provider && entry.id === pair.model,
        )
        return `${pair.provider} / ${known?.name ?? pair.model}`
      }

      const tierRows = TIERS.map((tier) => h(
        'div',
        { className: 'ccg-row', key: tier },
        h(
          'div',
          { className: 'ccg-row-label' },
          h(
            'span',
            { className: 'ccg-row-name' },
            t(tier),
            payload?.tiers?.[tier]?.overridden
              ? h('span', { className: 'ccg-badge' }, t('overridden'))
              : null,
          ),
          h('span', { className: 'ccg-row-hint', title: t(`${tier}Hint`) }, t(`${tier}Hint`)),
        ),
        h(
          'select',
          {
            className: 'ccg-select',
            value: current.tiers[tier],
            disabled: !writable,
            onChange: (event) => setTier(tier, event.target.value),
          },
          h('option', { value: '' }, `${t('unset')} — ${t('deploymentDefault')}`),
          modelOptions(),
        ),
      ))

      const roleRows = (payload?.roles ?? []).map((entry) => {
        const picks = current.roles[entry.role] ?? []
        return h(
          'div',
          { className: 'ccg-row', key: entry.role },
          h(
            'div',
            { className: 'ccg-row-label' },
            h(
              'span',
              { className: 'ccg-row-name' },
              t(entry.role),
              picks.length >= 2
                ? h('span', { className: 'ccg-panel-badge' }, `${picks.length} · ${t('panelOf')}`)
                : null,
            ),
            h('span', { className: 'ccg-row-hint', title: entry.tool }, entry.tool),
          ),
          h(
            'div',
            { className: 'ccg-picks' },
            picks.map((key) => h(
              'span',
              { className: 'ccg-chip', key },
              pickLabel(key),
              h(
                'button',
                {
                  type: 'button',
                  className: 'ccg-chip-x',
                  title: t('remove'),
                  disabled: !writable,
                  onClick: () => removeRoleModel(entry.role, key),
                },
                '×',
              ),
            )),
            h(
              'select',
              {
                className: 'ccg-add',
                value: '',
                disabled: !writable,
                onChange: (event) => addRoleModel(entry.role, event.target.value),
              },
              h(
                'option',
                { value: '' },
                picks.length === 0 ? `${t('followTier')} — ${t(entry.tier)}` : t('addModel'),
              ),
              modelOptions(picks),
            ),
          ),
        )
      })

      // Hiring is a capability, not a route, so it is a switch rather than a
      // selector — the models a teammate runs on are the per-role rows above.
      const teamRow = h(
        'div',
        { className: 'ccg-row', key: 'team' },
        h(
          'div',
          { className: 'ccg-row-label' },
          h(
            'span',
            { className: 'ccg-row-name' },
            t('team'),
            payload?.team?.overridden
              ? h('span', { className: 'ccg-badge' }, t('overridden'))
              : null,
          ),
          h('span', { className: 'ccg-row-hint', title: 'ccg_team' }, 'ccg_team'),
        ),
        h(
          'label',
          { className: 'ccg-switch' },
          h('input', {
            type: 'checkbox',
            checked: current.team !== false,
            disabled: !writable,
            onChange: (event) => setTeam(event.target.checked),
          }),
          h('span', null, t(current.team === false ? 'teamOff' : 'teamOn')),
        ),
      )

      const status = error
        ? t(error === 'unreachable' ? 'unreachable' : 'failed')
        : busy
          ? t('saving')
          : payload === null
            ? t('loading')
            : models.length === 0
              ? t('noModels')
              : ''

      return h(
        'li',
        { className: 'ccg-card' },
        h(
          'div',
          { className: 'ccg-head' },
          h('p', { className: 'ccg-title' }, t('title')),
          dirty ? h('span', { className: 'ccg-badge' }, t('unsaved')) : null,
        ),
        h('p', { className: 'ccg-summary' }, t('summary')),
        h('div', { className: 'ccg-section' }, tierRows),
        roleRows.length > 0
          ? h(
            'div',
            { className: 'ccg-section' },
            h('span', { className: 'ccg-row-name' }, t('roles')),
            h('p', { className: 'ccg-note' }, t('rolesHint')),
            roleRows,
          )
          : null,
        h(
          'div',
          { className: 'ccg-section' },
          h('p', { className: 'ccg-note' }, t('teamHint')),
          teamRow,
        ),
        h(
          'div',
          { className: 'ccg-actions' },
          h('span', { className: `ccg-status${error ? ' ccg-status-error' : ''}` }, status),
          h('span', { className: 'ccg-spacer' }),
          h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              disabled: !dirty || busy,
              onClick: () => { setDraft(null); setError(null) },
            },
            t('discard'),
          ),
          h(
            Button,
            {
              variant: 'primary',
              size: 'sm',
              disabled: !dirty || !writable,
              onClick: save,
            },
            t('save'),
          ),
        ),
      )
    }

    /**
     * Read one call's arguments, tolerating the partial JSON a streaming call
     * head carries before it is complete.
     *
     * @param raw - the `argsRaw` string off the call.
     * @returns the parsed object, or `{}` when it is not readable yet.
     */
    function parseArgs(raw) {
      if (typeof raw !== 'string' || raw.trim() === '') return {}
      try {
        const value = JSON.parse(raw)
        return value !== null && typeof value === 'object' ? value : {}
      } catch {
        return {}
      }
    }

    /** Flatten a settled result's content blocks to text. */
    function contentText(blocks) {
      if (!Array.isArray(blocks)) return ''
      return blocks
        .filter((block) => typeof block?.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim()
    }

    /**
     * Read the panel payload off a settled result.
     *
     * Returns null for anything this view cannot lay out honestly — a call that
     * failed before the tool ran, a host from a different version, a window cut
     * that dropped the metadata. The caller then falls back to showing the
     * result text as it is rather than an empty grid.
     *
     * @param meta - the result's presentation metadata.
     * @returns the payload, or null.
     */
    function readPanelMeta(meta) {
      if (meta === null || typeof meta !== 'object') return null
      if (meta.kind !== PANEL_META_KIND) return null
      if (!Array.isArray(meta.answers) || meta.answers.length === 0) return null
      return meta
    }

    /** Whether any column is long enough that the clamp will actually cut it. */
    function worthExpanding(texts) {
      return texts.some((text) => text.length > 320 || text.split('\n').length > 8)
    }

    /**
     * The route line under a column's name, or '' when the name is already it.
     *
     * A role's members carry no label of their own, so they are named by their
     * route — printing that twice reads like two different things.
     *
     * @param label - the member's display name.
     * @param provider - its provider route.
     * @param model - its model id.
     * @returns the route line, or '' when it would repeat the name.
     */
    function routeLine(label, provider, model) {
      const route = `${provider} / ${model}`
      return label === route ? '' : route
    }

    /**
     * One panel call, rendered as the answers side by side.
     *
     * This is the whole point of a panel made visible: the same brief went to
     * several models independently, and reading them in parallel columns is how
     * you see where they diverge. Folded into one scrolling blob — which is
     * what the generic tool card does with the model-facing report — that
     * comparison is exactly what gets lost.
     *
     * @param props - the keyed toolview share plus this plugin's roster and `t`.
     * @returns the panel row.
     */
    function CcgPanelView(props) {
      const { block, inspect, t } = props
      const roster = Array.isArray(props.roster) ? props.roster : []
      const [open, setOpen] = React.useState(false)
      const h = React.createElement

      // A running call is a bare head with no `kind`; a settled one is the
      // result node. Nothing else distinguishes them.
      const settled = block !== null && typeof block === 'object' && 'kind' in block
      const args = parseArgs(settled ? block.call?.argsRaw : block?.argsRaw)
      const brief = String(args.description ?? args.prompt ?? '').trim()

      const head = (...extras) => h(
        'div',
        { className: 'ccg-pv-head' },
        h('span', { className: 'ccg-pv-name' }, t('panel.title')),
        ...extras,
      )

      if (!settled) {
        return h(
          'div',
          { className: 'ccg-pv', 'data-tool': 'ccg-panel', 'data-state': 'running' },
          head(
            roster.length > 0
              ? h('span', { className: 'ccg-pv-count' }, t('panel.running', { count: roster.length }))
              : null,
            h('span', { className: 'ccg-pv-q', title: brief }, brief),
          ),
          // Naming the models while they think is most of what the wait is for:
          // it is the one moment the routing is visible without opening settings.
          roster.length === 0
            ? null
            : h(
              'div',
              { className: 'ccg-pv-grid' },
              roster.map((member, index) => {
                const label = member.label ?? `${member.provider} / ${member.model}`
                const route = routeLine(label, member.provider, member.model)
                return h(
                  'div',
                  { className: 'ccg-pv-col', key: `${member.provider}//${member.model}//${index}` },
                  h('span', { className: 'ccg-pv-col-name' }, label),
                  route === '' ? null : h('span', { className: 'ccg-pv-col-route' }, route),
                  member.lens ? h('span', { className: 'ccg-pv-col-lens' }, member.lens) : null,
                )
              }),
            ),
        )
      }

      const meta = readPanelMeta(block.meta)
      const stopped = block.error?.code === 'interrupted'
      const failed = block.isError === true

      const answers = meta?.answers ?? []
      const answered = answers.filter((answer) => answer.ok).length
      // What each column shows, and what the expand toggle is measured against.
      // With no payload there is one column: the result text as it stands.
      const bodies = meta === null
        ? [contentText(block.content)]
        : answers.map((answer) => String((answer.ok ? answer.answer : answer.error) ?? ''))

      const expandable = worthExpanding(bodies)
      const footer = !expandable && inspect === undefined
        ? null
        : h(
          'div',
          { className: 'ccg-pv-foot' },
          h(
            'span',
            { className: 'ccg-pv-read' },
            // Only true once two answers actually came back; with fewer there
            // is nothing to compare and saying so would be advice on nothing.
            answered >= 2 ? t('panel.read') : '',
          ),
          expandable
            ? h(
              Button,
              { variant: 'ghost', size: 'sm', onClick: () => setOpen((value) => !value) },
              t(open ? 'panel.collapse' : 'panel.expand'),
            )
            : null,
          inspect === undefined
            ? null
            : h(Button, { variant: 'ghost', size: 'sm', onClick: inspect }, t('panel.inspect')),
        )

      const shell = (...children) => h(
        'div',
        {
          className: 'ccg-pv',
          'data-tool': 'ccg-panel',
          'data-state': failed || answered === 0 ? 'error' : 'ok',
          'data-open': open || undefined,
        },
        ...children,
        footer,
      )

      // No payload: an older host, or a failure before the panel ever ran. Show
      // what the result does carry rather than an empty grid.
      if (meta === null) {
        return shell(
          head(
            failed
              ? h(
                'span',
                { className: 'ccg-pv-count', 'data-error': true },
                t(stopped ? 'panel.stopped' : 'panel.failed'),
              )
              : null,
            h('span', { className: 'ccg-pv-q', title: brief }, brief),
          ),
          bodies[0] === ''
            ? null
            : h(
              'div',
              { className: 'ccg-pv-body', ...(failed ? { 'data-error': true } : {}) },
              bodies[0],
            ),
        )
      }

      return shell(
        head(
          h(
            'span',
            { className: 'ccg-pv-count', ...(answered === answers.length ? {} : { 'data-error': true }) },
            t('panel.answered', { answered, total: answers.length }),
          ),
          h('span', { className: 'ccg-pv-q', title: meta.question }, meta.question),
        ),
        h(
          'div',
          { className: 'ccg-pv-grid' },
          answers.map((answer, index) => {
            const route = routeLine(answer.label, answer.provider, answer.model)
            return h(
              'div',
              {
                className: 'ccg-pv-col',
                key: `${answer.provider}//${answer.model}//${index}`,
                ...(answer.ok ? {} : { 'data-error': true }),
              },
              h(
                'span',
                { className: 'ccg-pv-col-head' },
                h(Dot, { state: answer.ok ? 'done' : 'error', size: 6 }),
                h('span', { className: 'ccg-pv-col-name' }, answer.label),
              ),
              route === '' ? null : h('span', { className: 'ccg-pv-col-route' }, route),
              answer.lens ? h('span', { className: 'ccg-pv-col-lens' }, answer.lens) : null,
              // An answer is markdown; the failure line is not, and running it
              // through a renderer would only invite it to reinterpret an error.
              answer.ok
                ? h('div', { className: 'ccg-pv-body' }, h(Markdown, { text: bodies[index] }))
                : h(
                  'div',
                  { className: 'ccg-pv-body', 'data-error': true },
                  `${t('panel.noAnswer')} — ${bodies[index]}`,
                ),
            )
          }),
        ),
      )
    }

    /**
     * The team strip above the composer: who is hired, and what is theirs.
     *
     * Ownership is the plugin's one mechanical guarantee — a hire that would
     * collide is refused rather than warned about — and until now it was only
     * visible by asking the model to read `ccg_roster`, which spends a turn to
     * learn something the harness already knows. Here it is just there, and it
     * is also the answer to "what is it actually doing right now".
     *
     * Renders nothing at all when nobody is hired. A permanent strip saying
     * "no teammates" would cost every solo session a line of chrome to tell it
     * a fact it never needed.
     *
     * @param props - the dock owner share plus this plugin's `t`.
     * @returns the strip, or null.
     */
    function CcgTeamDock(props) {
      const { t } = props
      const sessionId = props.session?.sessionId
      // A hire lands during a coordinator turn, so a turn in flight is one
      // reason to watch.
      const running = props.session?.running === true
      const [rows, setRows] = React.useState([])
      const [open, setOpen] = React.useState(false)
      const h = React.createElement

      // ...but not the only one, and this is the case that makes the strip worth
      // having: a teammate keeps working AFTER the coordinator's turn ends —
      // that is what continuable means. Watching only `running` would stop
      // exactly when the team is doing the work. Polling therefore continues
      // while anyone is still going, and stops of its own accord when the last
      // one settles. A report wakes the parent, so `running` turns back on and
      // covers the narrow window where a just-hired child is not listed yet.
      const anyLive = rows.some((row) => row.activity === 'running')

      React.useEffect(() => {
        if (!sessionId) return undefined
        let cancelled = false
        const load = () => fetch(
          `${TEAM_API}?session=${encodeURIComponent(sessionId)}`,
          { headers: { Accept: 'application/json' } },
        )
          .then((response) => (response.ok ? response.json() : null))
          .then((body) => {
            if (cancelled || body === null) return
            setRows(Array.isArray(body.teammates) ? body.teammates : [])
          })
          .catch(() => {
            // No route means the host half is not serving this deployment.
            // Keeping the last known roster is better than blanking the strip
            // on one failed poll.
          })

        load()
        if (!running && !anyLive) return () => { cancelled = true }
        const timer = setInterval(load, TEAM_POLL_MS)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [sessionId, running, anyLive])

      if (rows.length === 0) return null

      const live = rows.filter((row) => row.activity === 'running').length
      const summary = [
        t('dock.hired', { count: rows.length }),
        ...(live > 0 ? [t('dock.running', { count: live })] : []),
      ].join(' · ')

      const teammateRow = (row) => h(
        'div',
        { className: 'ccg-td-row', key: row.childId },
        h(Dot, { state: row.activity === 'running' ? 'ongoing' : 'done', size: 6 }),
        h('span', { className: 'ccg-td-role' }, row.role),
        h('span', { className: 'ccg-td-label', title: row.label }, row.label),
        h(
          'span',
          { className: 'ccg-td-route' },
          row.provider && row.model ? `${row.provider} / ${row.model}` : t('dock.default'),
        ),
        h(
          'span',
          {
            className: 'ccg-td-owns',
            title: row.owns.length > 0 ? row.owns.join(', ') : t('dock.ownsNothing'),
          },
          row.owns.length > 0
            ? `${t('dock.owns')} ${row.owns.join(', ')}`
            : t('dock.ownsNothing'),
        ),
      )

      return h(
        'div',
        { className: 'ccg-td-seat' },
        h(
          'div',
          { className: 'ccg-td', 'data-ccg': 'team-dock' },
          h(
            'button',
            {
              type: 'button',
              className: 'ccg-td-head',
              'aria-expanded': open,
              onClick: () => setOpen((value) => !value),
            },
            h(Dot, { state: live > 0 ? 'ongoing' : 'done', size: 7 }),
            h('span', { className: 'ccg-td-name' }, t('dock.team')),
            h('span', { className: 'ccg-td-count' }, summary),
            h('span', { className: 'ccg-td-spacer' }),
            h('span', { className: 'ccg-td-chevron' }, open ? '▲' : '▼'),
          ),
          open ? h('div', { className: 'ccg-td-rows' }, rows.map(teammateRow)) : null,
        ),
      )
    }

    /**
     * Everyone wanting the newest `/api/ccg/config` body.
     *
     * The card and the panel views need the same document for different
     * reasons, and they mount at different times — the card only when the user
     * opens Settings. Whoever reads it publishes here, so adding a second model
     * to a role starts rendering that role's calls as a panel on the next call
     * rather than on the next page load.
     */
    const configWatchers = new Set()

    /** Hand a freshly read payload to every watcher. */
    function publishConfig(payload) {
      for (const watcher of [...configWatchers]) {
        try {
          watcher(payload)
        } catch {
          // One watcher failing must not stop the others from updating.
        }
      }
    }

    /**
     * Claim the conversation rendering of every tool that answers as a panel.
     *
     * `tool.call.toolview` dispatches on the wire tool name, and an unclaimed
     * name falls back to the generic row — so this claims exactly the tools the
     * host says are panels, and releases one the moment it stops being a panel.
     * Claiming a single-model role tool would take over a rendering this view
     * has nothing better to offer for.
     *
     * @param ctx - the browser plugin context.
     * @param t - the bound translator.
     * @returns the disposer releasing every claim.
     */
    function mountPanelViews(ctx, t) {
      // Read at render time rather than baked into each registration, so a
      // roster change reaches a view that is already registered.
      const rosters = new Map()
      const claims = new Map()

      const sync = (payload) => {
        const panels = payload?.panels
        const wanted = panels !== null && typeof panels === 'object' ? panels : {}
        for (const [tool, dispose] of [...claims]) {
          if (wanted[tool] !== undefined) continue
          claims.delete(tool)
          rosters.delete(tool)
          dispose()
        }
        for (const [tool, members] of Object.entries(wanted)) {
          rosters.set(tool, Array.isArray(members) ? members : [])
          if (claims.has(tool)) continue
          claims.set(tool, ctx.slots.register({
            name: 'tool.call.toolview',
            key: tool,
            locale: NS,
            inject: () => ({ t, roster: rosters.get(tool) ?? [] }),
          }, CcgPanelView))
        }
      }

      let live = true
      configWatchers.add(sync)
      fetch(API, { headers: { Accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status))))
        .then((payload) => { if (live) sync(payload) })
        .catch(() => {
          // No route means the host half is not serving this deployment; the
          // generic tool row keeps rendering these calls.
        })

      return () => {
        live = false
        configWatchers.delete(sync)
        for (const dispose of claims.values()) dispose()
        claims.clear()
      }
    }

    /**
     * Mount the card into the plugin-configuration tab.
     *
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ccg: card dictionaries')
      ctx.effect(() => mountStyles(), 'ccg: card styles')

      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        id: 'ccg',
        order: 50,
        locale: NS,
        inject: () => ({ t }),
      }, CcgCard))

      ctx.slots.inject('tool.call.toolview', () => mountPanelViews(ctx, t))

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'ccg-team',
        order: 40,
        locale: NS,
        inject: () => ({ t }),
      }, CcgTeamDock))
    }

    module.exports = { apply, inject }
    return module.exports
  },
})
