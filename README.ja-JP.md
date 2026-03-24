# CCG - Claude + Codex + Gemini マルチモデル協調システム

<div align="center">

[![npm version](https://img.shields.io/npm/v/ccg-workflow.svg)](https://www.npmjs.com/package/ccg-workflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-green.svg)](https://claude.ai/code)
[![Tests](https://img.shields.io/badge/Tests-134%20passed-brightgreen.svg)]()

[简体中文](./README.zh-CN.md) | [English](./README.md) | 日本語

</div>

Claude Code が Codex + Gemini をオーケストレーションするマルチモデル協調開発システムです。フロントエンドタスクは Gemini に、バックエンドタスクは Codex にルーティングされ、Claude がオーケストレーションとコードレビューを担当します。

## なぜ CCG？

- **ゼロ設定のモデルルーティング** — フロントエンドタスクは自動的に Gemini へ、バックエンドタスクは Codex へ。手動切り替え不要。
- **セキュリティ・バイ・デザイン** — 外部モデルには書き込み権限がありません。パッチを返すだけで、Claude が適用前にレビューします。
- **27 個のスラッシュコマンド** — 計画から実行、Git ワークフローからコードレビューまで、すべて `/ccg:*` でアクセス可能。
- **仕様駆動開発** — [OPSX](https://github.com/fission-ai/opsx) と統合し、曖昧な要件を検証可能な制約に変換。AI の即興を排除します。

## アーキテクチャ

```
Claude Code（オーケストレーター）
       │
   ┌───┴───┐
   ↓       ↓
Codex   Gemini
(バックエンド) (フロントエンド)
   │       │
   └───┬───┘
       ↓
  統合パッチ
```

外部モデルには書き込み権限がありません — パッチを返すだけで、Claude が適用前にレビューします。

## クイックスタート

### 前提条件

| 依存関係 | 必須 | 備考 |
|----------|------|------|
| **Node.js 20+** | はい | `ora@9.x` は Node >= 20 が必要。Node 18 では `SyntaxError` が発生します |
| **Claude Code CLI** | はい | [インストールガイド](#claude-code-のインストール) |
| **jq** | はい | 自動認可フックに使用（[インストール](#jq-のインストール)） |
| **Codex CLI** | いいえ | バックエンドルーティングを有効化 |
| **Gemini CLI** | いいえ | フロントエンドルーティングを有効化 |

### インストール

```bash
npx ccg-workflow
```

初回実行時、CCG は言語選択（英語 / 中国語）を求めるプロンプトを表示します。この設定はすべてのセッションで保存されます。

### jq のインストール

```bash
# macOS
brew install jq

# Linux (Debian/Ubuntu)
sudo apt install jq

# Linux (RHEL/CentOS)
sudo yum install jq

# Windows
choco install jq   # または: scoop install jq
```

### Claude Code のインストール

```bash
npx ccg-workflow menu  # 「Install Claude Code」を選択
```

対応: npm, homebrew, curl, powershell, cmd。

## コマンド

### 開発ワークフロー

| コマンド | 説明 | モデル |
|----------|------|--------|
| `/ccg:workflow` | 完全な6フェーズ開発ワークフロー | Codex + Gemini |
| `/ccg:plan` | マルチモデル協調計画（フェーズ 1-2） | Codex + Gemini |
| `/ccg:execute` | マルチモデル協調実行（フェーズ 3-5） | Codex + Gemini + Claude |
| `/ccg:codex-exec` | Codex 全権実行（計画 → コード → レビュー） | Codex + マルチモデルレビュー |
| `/ccg:feat` | スマート機能開発 | 自動ルーティング |
| `/ccg:frontend` | フロントエンドタスク（高速モード） | Gemini |
| `/ccg:backend` | バックエンドタスク（高速モード） | Codex |

### 分析 & 品質

| コマンド | 説明 | モデル |
|----------|------|--------|
| `/ccg:analyze` | 技術分析 | Codex + Gemini |
| `/ccg:debug` | 問題診断 + 修正 | Codex + Gemini |
| `/ccg:optimize` | パフォーマンス最適化 | Codex + Gemini |
| `/ccg:test` | テスト生成 | 自動ルーティング |
| `/ccg:review` | コードレビュー（自動 git diff） | Codex + Gemini |
| `/ccg:enhance` | プロンプト強化 | 組み込み |

### OPSX 仕様駆動

| コマンド | 説明 |
|----------|------|
| `/ccg:spec-init` | OPSX 環境の初期化 |
| `/ccg:spec-research` | 要件 → 制約 |
| `/ccg:spec-plan` | 制約 → ゼロ判断計画 |
| `/ccg:spec-impl` | 計画の実行 + アーカイブ |
| `/ccg:spec-review` | デュアルモデル・クロスレビュー |

### Agent Teams（v1.7.60+）

| コマンド | 説明 |
|----------|------|
| `/ccg:team-research` | 要件 → 制約（並行探索） |
| `/ccg:team-plan` | 制約 → 並行実装計画 |
| `/ccg:team-exec` | Builder チームメイトを生成して並行コーディング |
| `/ccg:team-review` | デュアルモデル・クロスレビュー |

> **前提条件**: `settings.json` で Agent Teams を有効化: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

### Git ツール

| コマンド | 説明 |
|----------|------|
| `/ccg:commit` | スマートコミット（conventional commit 形式） |
| `/ccg:rollback` | 対話式ロールバック |
| `/ccg:clean-branches` | マージ済みブランチのクリーンアップ |
| `/ccg:worktree` | Worktree 管理 |

### プロジェクトセットアップ

| コマンド | 説明 |
|----------|------|
| `/ccg:init` | プロジェクト CLAUDE.md の初期化 |
| `/ccg:context` | プロジェクトコンテキスト管理（.context/ の初期化、ログ、圧縮、履歴） |

## ワークフローガイド

### 計画と実行の分離

```bash
# 1. 実装計画を生成
/ccg:plan implement user authentication

# 2. 計画をレビュー（編集可能）
# 計画は .claude/plan/user-auth.md に保存されます

# 3a. 実行（Claude がリファクタリング）— きめ細かい制御
/ccg:execute .claude/plan/user-auth.md

# 3b. 実行（Codex がすべてを実行）— 効率的、Claude トークン消費が低い
/ccg:codex-exec .claude/plan/user-auth.md
```

### OPSX 仕様駆動ワークフロー

[OPSX アーキテクチャ](https://github.com/fission-ai/opsx)と統合し、要件を制約に変換。AI の即興を排除します:

```bash
/ccg:spec-init                          # OPSX 環境を初期化
/ccg:spec-research implement user auth  # リサーチ → 制約
/ccg:spec-plan                          # 並行分析 → ゼロ判断計画
/ccg:spec-impl                          # 計画を実行
/ccg:spec-review                        # 独立レビュー（いつでも可）
```

> **ヒント**: `/ccg:spec-*` コマンドは内部的に `/opsx:*` を呼び出します。フェーズ間で `/clear` が可能です — 状態は `openspec/` ディレクトリに永続化されます。

### Agent Teams 並行ワークフロー

Claude Code Agent Teams を活用して、複数の Builder チームメイトを生成し並行コーディング:

```bash
/ccg:team-research implement kanban API  # 1. 要件 → 制約
# /clear
/ccg:team-plan kanban-api               # 2. 計画 → 並行タスク
# /clear
/ccg:team-exec                          # 3. Builder が並行でコーディング
# /clear
/ccg:team-review                        # 4. デュアルモデル・クロスレビュー
```

> **従来のワークフローとの比較**: Team シリーズはステップ間で `/clear` を使用してコンテキストを分離し、ファイルを通じて状態を受け渡します。3つ以上の独立モジュールに分解可能なタスクに最適です。

## 設定

### ディレクトリ構造

```
~/.claude/
├── commands/ccg/       # 26 個のスラッシュコマンド
├── agents/ccg/         # サブエージェント
├── skills/ccg/         # 品質ゲート + マルチエージェントオーケストレーション
├── bin/codeagent-wrapper
└── .ccg/
    ├── config.toml     # CCG 設定
    └── prompts/
        ├── codex/      # 6 個の Codex エキスパートプロンプト
        └── gemini/     # 7 個の Gemini エキスパートプロンプト
```

### 環境変数

`~/.claude/settings.json` の `"env"` で設定:

| 変数 | 説明 | デフォルト | 変更するタイミング |
|------|------|-----------|-------------------|
| `CODEAGENT_POST_MESSAGE_DELAY` | Codex 完了後の待機時間（秒） | `5` | Codex プロセスがハングする場合は `1` に設定 |
| `CODEX_TIMEOUT` | ラッパー実行タイムアウト（秒） | `7200` | 非常に長いタスクの場合に増加 |
| `BASH_DEFAULT_TIMEOUT_MS` | Claude Code Bash タイムアウト（ミリ秒） | `120000` | コマンドがタイムアウトする場合に増加 |
| `BASH_MAX_TIMEOUT_MS` | Claude Code Bash 最大タイムアウト（ミリ秒） | `600000` | 長いビルドの場合に増加 |

<details>
<summary>settings.json の例</summary>

```json
{
  "env": {
    "CODEAGENT_POST_MESSAGE_DELAY": "1",
    "CODEX_TIMEOUT": "7200",
    "BASH_DEFAULT_TIMEOUT_MS": "600000",
    "BASH_MAX_TIMEOUT_MS": "3600000"
  }
}
```

</details>

### MCP 設定

```bash
npx ccg-workflow menu  # 「Configure MCP」を選択
```

**コード検索**（いずれかを選択）:
- **ace-tool**（推奨） — `search_context` によるコード検索。[公式](https://augmentcode.com/) | [サードパーティプロキシ](https://acemcp.heroman.wtf/)
- **fast-context**（推奨） — Windsurf Fast Context、リポジトリ全体のインデックスなしで AI 搭載検索。Windsurf アカウントが必要
- **ContextWeaver**（代替） — ローカルハイブリッド検索、SiliconFlow API Key が必要（無料）

**オプションツール**:
- **Context7** — 最新のライブラリドキュメント（自動インストール）
- **Playwright** — ブラウザ自動化 / テスト
- **DeepWiki** — ナレッジベースクエリ
- **Exa** — 検索エンジン（API Key が必要）

### 自動認可フック

CCG は `codeagent-wrapper` コマンドを自動認可するフックを自動的にインストールします（[jq](#jq-のインストール) が必要）。

<details>
<summary>手動セットアップ（v1.7.71 より前のバージョン向け）</summary>

`~/.claude/settings.json` に追加:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' 2>/dev/null | grep -q 'codeagent-wrapper' && echo '{\"hookSpecificOutput\": {\"hookEventName\": \"PreToolUse\", \"permissionDecision\": \"allow\", \"permissionDecisionReason\": \"codeagent-wrapper auto-approved\"}}' || true",
            "timeout": 1
          }
        ]
      }
    ]
  }
}
```

</details>

## ユーティリティ

```bash
npx ccg-workflow menu  # 「Tools」を選択
```

- **ccusage** — Claude Code 使用量分析
- **CCometixLine** — ステータスバーツール（Git + 使用量トラッキング）

## アップデート / アンインストール

```bash
# アップデート
npx ccg-workflow@latest            # npx ユーザー
npm install -g ccg-workflow@latest  # npm グローバルユーザー

# アンインストール
npx ccg-workflow  # 「Uninstall」を選択
npm uninstall -g ccg-workflow  # npm グローバルユーザーはこの追加ステップが必要
```

## FAQ

### Codex CLI 0.80.0 プロセスが終了しない

`--json` モードでは、Codex は出力完了後に自動的に終了しません。

**修正方法**: 環境変数に `CODEAGENT_POST_MESSAGE_DELAY=1` を設定してください。

## コントリビューション

コントリビューションを歓迎します！ガイドラインについては [CONTRIBUTING.md](./CONTRIBUTING.md) をご覧ください。

始める場所をお探しですか？ [`good first issue`](https://github.com/fengshao1227/ccg-workflow/labels/good%20first%20issue) ラベルの付いた Issue をチェックしてください。

## コントリビューター

<!-- readme: contributors -start -->
<table>
<tr>
    <td align="center"><a href="https://github.com/fengshao1227"><img src="https://avatars.githubusercontent.com/fengshao1227?v=4&s=100" width="100;" alt="fengshao1227"/><br /><sub><b>fengshao1227</b></sub></a></td>
    <td align="center"><a href="https://github.com/SXP-Simon"><img src="https://avatars.githubusercontent.com/SXP-Simon?v=4&s=100" width="100;" alt="SXP-Simon"/><br /><sub><b>SXP-Simon</b></sub></a></td>
    <td align="center"><a href="https://github.com/RebornQ"><img src="https://avatars.githubusercontent.com/RebornQ?v=4&s=100" width="100;" alt="RebornQ"/><br /><sub><b>RebornQ</b></sub></a></td>
    <td align="center"><a href="https://github.com/Sakuranda"><img src="https://avatars.githubusercontent.com/Sakuranda?v=4&s=100" width="100;" alt="Sakuranda"/><br /><sub><b>Sakuranda</b></sub></a></td>
    <td align="center"><a href="https://github.com/Mriris"><img src="https://avatars.githubusercontent.com/Mriris?v=4&s=100" width="100;" alt="Mriris"/><br /><sub><b>Mriris</b></sub></a></td>
    <td align="center"><a href="https://github.com/23q3"><img src="https://avatars.githubusercontent.com/23q3?v=4&s=100" width="100;" alt="23q3"/><br /><sub><b>23q3</b></sub></a></td>
    <td align="center"><a href="https://github.com/MrNine-666"><img src="https://avatars.githubusercontent.com/MrNine-666?v=4&s=100" width="100;" alt="MrNine-666"/><br /><sub><b>MrNine-666</b></sub></a></td>
</tr>
<tr>
    <td align="center"><a href="https://github.com/GGzili"><img src="https://avatars.githubusercontent.com/GGzili?v=4&s=100" width="100;" alt="GGzili"/><br /><sub><b>GGzili</b></sub></a></td>
</tr>
</table>
<!-- readme: contributors -end -->

## クレジット

- [cexll/myclaude](https://github.com/cexll/myclaude) — codeagent-wrapper
- [UfoMiao/zcf](https://github.com/UfoMiao/zcf) — Git ツール
- [GudaStudio/skills](https://github.com/GuDaStudio/skills) — ルーティング設計
- [ace-tool](https://linux.do/t/topic/1344562) — MCP ツール

## Star 履歴

[![Star History Chart](https://api.star-history.com/svg?repos=fengshao1227/ccg-workflow&type=timeline&legend=top-left)](https://www.star-history.com/#fengshao1227/ccg-workflow&type=timeline&legend=top-left)

## お問い合わせ

- **メール**: [fengshao1227@gmail.com](mailto:fengshao1227@gmail.com) — スポンサーシップ、コラボレーション、開発アイデア
- **Issues**: [GitHub Issues](https://github.com/fengshao1227/ccg-workflow/issues) — バグ報告と機能リクエスト
- **Discussions**: [GitHub Discussions](https://github.com/fengshao1227/ccg-workflow/discussions) — 質問とコミュニティチャット

## ライセンス

MIT

---

v1.7.86 | [Issues](https://github.com/fengshao1227/ccg-workflow/issues) | [Contributing](./CONTRIBUTING.md)
