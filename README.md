# MYCELIUM

**Skill-Driven RBAC for the Agentic AI Era**

> ロールを定義するな。スキルに宣言させろ。
>
> *Don't define roles. Let skills declare them.*

## パッケージ構成

```
mycelium/
├── packages/
│   ├── shared/       # @mycelium/shared - 共通型定義
│   ├── core/         # @mycelium/core - Router, RBAC, MCP統合
│   ├── cli/          # @mycelium/cli - 対話型CLI
│   ├── skills/       # @mycelium/skills - スキルMCPサーバー
│   ├── session/      # @mycelium/session - セッション管理
│   ├── sandbox/      # @mycelium/sandbox - 安全なコード実行
│   ├── orchestrator/ # @mycelium/orchestrator - ワークフロー実行
│   └── adhoc/        # @mycelium/adhoc - アドホック調査
```

| パッケージ | 説明 |
|-----------|------|
| `@mycelium/shared` | 共通型定義（Role, Skill, ToolPermissions等） |
| `@mycelium/core` | Router, RoleManager, ToolVisibilityManager, MCP統合 |
| `@mycelium/cli` | 対話型REPL、ロール切替、モデル選択 |
| `@mycelium/skills` | スキル定義を提供するMCPサーバー |
| `@mycelium/session` | 会話セッションの保存・復元・圧縮 |
| `@mycelium/sandbox` | OS分離による安全なコマンド実行 |
| `@mycelium/orchestrator` | 複数ロールを使ったワークフロー実行 |
| `@mycelium/adhoc` | 調査・デバッグ用のアドホックタスク |

## スキル駆動RBACとは？

従来のRBACは「ロールがツールを定義」する。MYCELIUMは逆転の発想：

```
┌─────────────────────────────────────────────────────────────┐
│  従来のRBAC                    MYCELIUM (スキル駆動)            │
│                                                              │
│  Role: admin                   Skill: docx-handler           │
│    └── tools: [a, b, c]          └── allowedRoles: [admin]   │
│                                                              │
│  Role: user                    Skill: data-analysis          │
│    └── tools: [a]                └── allowedRoles: [analyst] │
│                                                              │
│  中央集権                       分散宣言                      │
│  設定ファイル変更が必要         スキル追加だけで拡張           │
└─────────────────────────────────────────────────────────────┘
```

**スキルが「誰に使わせるか」を宣言** → ロールは自動生成

## インストール

```bash
npm install
npm run build

# グローバルコマンドとして登録
npm link
```

## 使用方法

### 対話型CLI

```bash
# 起動
myc
# または
npm start

# 特定ロールで起動
myc --role developer

# 特定モデルで起動
myc --model claude-sonnet-4-5-20250929
```

#### CLIコマンド

| コマンド | 説明 |
|---------|------|
| `/roles` | ロール選択（矢印キーで選択） |
| `/skills` | 現在のロールで使えるスキル一覧 |
| `/tools` | 現在のロールで使えるツール一覧 |
| `/status` | 現在の状態（ロール、モデル、ツール数） |
| `/model <name>` | モデル変更 |
| `/help` | ヘルプ表示 |
| `/quit` | 終了 |

#### セッション管理コマンド

| コマンド | 説明 |
|---------|------|
| `/save [name]` | 現在のセッションを保存 |
| `/sessions` | 保存済みセッション一覧 |
| `/resume <id>` | セッションを再開 |
| `/compress <id>` | セッションを圧縮 |
| `/fork <id>` | セッションをフォーク |
| `/export <id>` | セッションをエクスポート |

### MCPサーバーとして起動（Claude Desktop等）

```bash
npm run start:mcp
```

`.mcp.json` 設定例：

```json
{
  "mcpServers": {
    "mycelium-router": {
      "command": "node",
      "args": ["packages/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "config.json"
      }
    }
  }
}
```

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                 @mycelium/skills (MCP Server)                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Skill: docx-handler                                 │   │
│  │  - allowedRoles: [formatter, admin]  ← スキルが宣言  │   │
│  │  - allowedTools: [filesystem__read, docx__parse]     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Skill: session-management                           │   │
│  │  - allowedRoles: ["*"]  ← ワイルドカードで全ロール   │   │
│  │  - allowedTools: [mycelium-session__*]               │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │ list_skills
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                 @mycelium/core (Router)                        │
│  ├── RoleManager        (スキル→ロール変換)                  │
│  ├── ToolVisibilityManager (ロール別ツールフィルタ)         │
│  └── StdioRouter        (MCPサーバー接続管理)               │
│                                                              │
│  Skills → Roles 変換（Inverted RBAC）                       │
│  - allowedRoles: ["*"] → 全ロールに展開                     │
│  - allowedTools: [server__*] → ワイルドカードマッチ          │
└───────────────────────┬─────────────────────────────────────┘
                        │ set_role / MCP tools
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              @mycelium/cli (Interactive REPL)                 │
│  - /roles, /skills, /tools → MCP tools経由                  │
│  - /status → get_context MCP tool                           │
│  - Claude Agent SDK統合                                     │
└─────────────────────────────────────────────────────────────┘
```

## スキル定義

スキルは `packages/skills/skills/` に配置し、`allowedRoles` を宣言：

```yaml
# packages/skills/skills/data-analyst/SKILL.yaml
---
id: data-analyst
displayName: Data Analyst
description: データ分析のためのスキル

allowedRoles:
  - analyst
  - admin

allowedTools:
  - postgres__select
  - postgres__explain
  # postgres__drop は含めない → 自動的に拒否
---
```

### 全ロール共通スキル

`allowedRoles: ["*"]` で全ロールに適用：

```yaml
# packages/skills/skills/session-management/SKILL.yaml
---
id: session-management
displayName: Session Management
description: セッション管理（全ロール共通）

allowedRoles:
  - "*"  # 全ロールに展開

allowedTools:
  - mycelium-session__*  # ワイルドカードで全セッションツール
---
```

## 設定

### サーバー設定 (`config.json`)

```json
{
  "mcpServers": {
    "mycelium-skills": {
      "command": "node",
      "args": ["packages/skills/dist/index.js", "packages/skills/skills"]
    },
    "mycelium-session": {
      "command": "node",
      "args": ["packages/session/dist/mcp-server.js", "sessions"]
    },
    "mycelium-sandbox": {
      "command": "node",
      "args": ["packages/sandbox/dist/mcp-server.js"]
    }
  }
}
```

## 環境変数

| 変数 | 説明 |
|-----|------|
| `MYCELIUM_CONFIG_PATH` | config.jsonのパス |
| `MYCELIUM_ROUTER_PATH` | MCPサーバーのパス |
| `ANTHROPIC_API_KEY` | APIキー（オプション、Claude Code認証優先） |

## 開発

```bash
# ビルド
npm run build

# 開発モード（tsx）
npm run dev

# テスト
npm test

# CLIデバッグ
npm run cli:dev
```

## テスト

```bash
npm test
```

## ライセンス

MIT
