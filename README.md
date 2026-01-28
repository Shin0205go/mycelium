# MYCELIUM

**Session-Based Dynamic Skill Management for AI Agents**

> AIに必要なツールだけを見せる。それ以外は存在しない。
>
> *Show AI only the tools it needs. Everything else doesn't exist.*

## なぜ Mycelium?

従来のコーディングエージェント（Claude Code、Cursor等）の課題：
- **なんでもできる**: 全ツールにアクセス可能で、タスクに不要なツールも使える
- **コンテキストが汚れる**: 無関係な操作でコンテキストが肥大化
- **承認疲れ**: human-in-the-loopで毎回確認が必要

Myceliumのアプローチ：
- **Policy-in-the-loop**: ポリシーが自動的にツールアクセスを制御
- **動的スキル管理**: 必要な時だけ必要なスキルを有効化（ユーザー承認付き）
- **認知の外への完全排除**: 許可されていないツールは**名前すら見せない**

## パッケージ構成

```
mycelium/
├── packages/
│   ├── cli/       # @mycelium/cli - コマンドラインインターフェース
│   ├── core/      # @mycelium/core - MCPルーター・RBAC統合
│   ├── shared/    # @mycelium/shared - 共通型定義
│   ├── skills/    # @mycelium/skills - スキルMCPサーバー
│   ├── session/   # @mycelium/session - セッション永続化
│   └── sandbox/   # @mycelium/sandbox - サンドボックス実行環境
```

| パッケージ | 説明 |
|-----------|------|
| `@mycelium/cli` | Chat Agent, Workflow Agent, Adhoc Agent を提供 |
| `@mycelium/core` | MCPサーバー接続管理、ツールルーティング |
| `@mycelium/shared` | SkillDefinition, Role 等の共通型定義 |
| `@mycelium/skills` | スキル定義を提供するMCPサーバー（30+スキル） |
| `@mycelium/session` | 会話セッションの保存・復元 |
| `@mycelium/sandbox` | OS レベルのサンドボックス実行 |

## コアコンセプト

### Session-Based Dynamic Skill Management

```
セッション開始
    │
    ▼
[common] ← 最小限の基本スキル
    │
    │ "ファイル編集して"
    ▼
⚠️ スキル昇格: [code-modifier]
有効にしますか？ [y/N]: y
    │
    ▼
[common] + [code-modifier] ← 承認後に昇格
    │
    │ "テストして"
    ▼
⚠️ スキル昇格: [test-runner]
有効にしますか？ [y/N]: y
    │
    ▼
[common] + [code-modifier] + [test-runner]
```

### Policy-in-the-loop vs Human-in-the-loop

| 項目 | Human-in-the-loop | Policy-in-the-loop |
|------|-------------------|-------------------|
| **ツール承認** | 毎回人間が承認 | ポリシーが自動判定 |
| **スキル昇格** | - | ユーザー承認が必要 |
| **許可外ツール** | 拒否される | **存在しない** |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Session State                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  activeSkills: [common, code-modifier]              │   │
│  │  availableTools: [read_file, write_file, ...]       │   │
│  │  userRole: developer (使用可能スキルの上限)          │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│              Intent Classifier                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  User Input → 必要なスキルを判定                     │   │
│  │  "ファイル編集して" → code-modifier 必要            │   │
│  │                                                      │   │
│  │  昇格: ユーザー承認後に追加                         │   │
│  │  降格: 自動（タスク終了検出時）                     │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                 Tool Filter                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  activeSkillsのallowedToolsをマージ                 │   │
│  │  → LLMに見えるツールリストを生成                    │   │
│  │  → 許可外ツールは名前すら渡さない                   │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│              Chat Agent (Claude Agent SDK)                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  - 見えるツールのみで応答                           │   │
│  │  - 会話履歴を維持                                   │   │
│  │  - スキル変更時に [skill名] を表示                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## インストール

```bash
npm install
npm run build
```

## 使用方法

### Chat Agent（推奨）

```bash
# 基本的な使い方
myc

# ロール指定（使用可能スキルの上限を設定）
myc --role developer
myc --role admin
```

### セッション例

```
$ myc

● [common]
こんにちは！何かお手伝いしましょうか？

myc> CLAUDE.mdを編集して

⚠️  スキル昇格: [code-modifier] - コードの作成・編集・リファクタリング
有効にしますか？ [y/N]: y
✓ [code-modifier] を有効化

● [common, code-modifier]
CLAUDE.mdを編集しました。

myc> テストして

⚠️  スキル昇格: [test-runner] - テストの実行
有効にしますか？ [y/N]: y
✓ [test-runner] を有効化

● [common, code-modifier, test-runner]
テスト結果は...
```

### REPL コマンド

```
/help      - ヘルプを表示
/skills    - 有効なスキルを表示
/all       - 全スキルを表示
/add <id>  - スキルを手動追加
/remove <id> - スキルを削除
/tools     - 使用可能なツールを表示
/exit      - 終了
```

## スキル定義

スキルは `packages/skills/skills/` に配置：

```yaml
# packages/skills/skills/code-modifier/SKILL.yaml
name: code-modifier
description: コードの作成・編集・リファクタリング

allowedRoles:
  - developer
  - admin

allowedTools:
  - filesystem__read_file
  - filesystem__write_file
  - filesystem__list_directory
  - mycelium-sandbox__bash

triggers:
  - 編集
  - 修正
  - 作成
  - edit
  - modify
  - create
```

### 利用可能なスキル（30+）

| カテゴリ | スキル |
|---------|--------|
| **開発** | code-modifier, test-runner, build-check, git-workflow |
| **ドキュメント** | doc-updater, docx, pdf, pptx, xlsx |
| **デザイン** | frontend-design, canvas-design, algorithmic-art |
| **その他** | data-analyst, browser-testing, mcp-builder |

## 設定

### config.json

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "mycelium-skills": {
      "command": "node",
      "args": ["packages/skills/dist/index.js", "packages/skills/skills"]
    },
    "mycelium-sandbox": {
      "command": "node",
      "args": ["packages/sandbox/dist/mcp-server.js"]
    }
  }
}
```

## 開発

```bash
npm install          # 依存関係インストール
npm run build        # TypeScriptビルド
npm start            # CLI起動 (myc)
npm test             # テスト実行
```

## Design Principles

詳細は [CLAUDE.md](./CLAUDE.md) を参照。

- **宣言が唯一の真実**: `allowedTools` に明示されたツールのみが存在
- **ツールの完全隠蔽**: 許可外ツールは名前すら渡さない
- **迂回の構造的排除**: 全ツール呼び出しはRouter経由
- **最小権限の自動強制**: スキル宣言のintersectionで権限決定

## ライセンス

MIT
