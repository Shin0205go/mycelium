# CLAUDE.md - Mycelium-CLI Codebase Guide

This document provides guidance for AI assistants working with the Mycelium-CLI codebase.

## Project Overview

Mycelium-CLI is a **skill-driven autonomous AI agent system** that integrates Claude Agent SDK with Model Context Protocol (MCP) servers. It provides **session-based dynamic skill management** with **policy-in-the-loop** security.

### Why Mycelium?

従来のコーディングエージェント（Claude Code、Cursor等）の課題：
- **なんでもできる**: 全ツールにアクセス可能で、タスクに不要なツールも使える
- **コンテキストが汚れる**: 無関係な操作でコンテキストが肥大化
- **承認疲れ**: human-in-the-loopで毎回確認が必要

Myceliumのアプローチ：
- **Policy-in-the-loop**: ポリシーが自動的にツールアクセスを制御（承認不要）
- **動的スキル管理**: 必要な時だけ必要なスキルを有効化
- **クリーンなコンテキスト**: タスクに関連するツールのみ可視

### Key Concepts

- **MCP (Model Context Protocol)**: Anthropic's protocol for tool/resource integration
- **Skill**: ツールセット + システムプロンプトの組み合わせ
- **Policy-in-the-loop**: 人間の承認なしでポリシーが自動的に制御
- **Session-based Skill Management**: セッション中にスキルを動的に追加/削除

## Design Philosophy

### Core Principles

1. **Policy-in-the-loop**: 承認プロンプトなし、ポリシーが自動判定
2. **最小権限**: デフォルトは最小限のツール、必要に応じて昇格
3. **透明性**: スキル変更時は通知（`[skill名]`）
4. **可逆性**: スキルの昇格も降格も可能

### Session-based Dynamic Skill Management

```
セッション開始
    │
    ▼
[base skills] ← 最小限の安全なツール
    │
    │ "ファイル読んで"
    ▼
[base] + [reader] ← 自動昇格 + 通知
    │
    │ "編集して"
    ▼
[base] + [reader] + [editor] ← さらに昇格
    │
    │ "編集終わり、テストして"
    ▼
[base] + [reader] + [tester] ← editor降格、tester昇格
    │
    │ セッション終了
    ▼
リセット
```

### Policy-in-the-loop vs Human-in-the-loop

| 項目 | Human-in-the-loop | Policy-in-the-loop |
|------|-------------------|-------------------|
| **承認** | 人間が毎回承認 | ポリシーが自動判定 |
| **UX** | 承認疲れ | スムーズ |
| **安全性** | 人間依存 | ポリシー依存 |
| **スケール** | 困難 | 容易 |

**Policy-in-the-loopの仕組み:**
1. エージェントはポリシーで許可されたツールしか**見えない**
2. 許可されていないツールは選択肢に存在しない
3. 「危険な操作を試みて拒否」ではなく「そもそも選択肢にない」

## MYCELIUM Design Principles

### スキル駆動型RBACの究極形：認知の外への完全排除

#### 1. 宣言が唯一の真実（Declaration is the Single Source of Truth）

スキル（SKILL.yaml）の`allowedTools`に明示的に記載されたツールだけが、システム内に「存在する」ものとして扱われる。

- 記載されていないツール（ビルトインBash、code_executionのraw機能、filesystem writeなど）は、**存在しないもの**として扱う
- **名前すらAIに渡さない**

#### 2. ツールの完全隠蔽（Total Non-Existence for Unauthorized Tools）

`ToolVisibilityManager`は、ロールごとのツールカタログをホワイトリスト専用に生成。

許可外ツールの扱い：
- ツールIDが存在しない（名前空間プレフィックスで強制マスキング or 削除）
- ツール記述・パラメータ・例示すらプロンプトに含めない
- AIが「そんなツールあるかも？」と推測する余地をゼロにする

**結果**: AIは許可ツールしか「知らない」状態になる

#### 3. 迂回・代替手段の構造的排除（No Bypass by Design）

- ビルトイン機能（Bash, Python raw exec, code interpreter fallbackなど）をラップせずに直接呼べる状態にしない
- すべてのツール呼び出しはmyceliumのRouterを経由し、Routerは宣言外を即座に拒否（存在しない扱い）
- 「似た機能だから自前で実装しよう」というAIの試みも、code generationツール自体を宣言外にすれば防げる

#### 4. 宣言ミスは悪影響ゼロ（Fail-Safe by Ignorance）

不正・不明なツールが`allowedTools`に書かれていた場合：
- そのスキル全体を無効化（ロードせず）
- AI側に一切の情報漏洩なし
- 過剰宣言が起きても、intersection（共通部分）採用で最もrestrictiveな権限だけ適用

#### 5. 動的・薄いCLI中心の可視性（Developer Trust via Transparency）

外部AI（Claudeなど）依存を排除した薄いCLIで：
- 今のロールで本当に見えているツールだけを表示
- スキル追加/変更 → 即時プレビュー & 反映確認
- 開発者が「これでAIは本当にこれしか知らない」とCLIで即確信できる体験を提供

#### 6. 最小権限の自動強制（Least Privilege by Construction）

- ロールはスキル宣言のintersection（共通部分）で自動生成
- 継承・union的な拡張を禁止（明示的に複数スキルで宣言が必要）
- **結果**: adminでも「必要なツールだけ」しか見えず、過剰権限が設計上発生しない

### 実装指針（優先順）

#### 1. ToolVisibilityManagerの進化

```typescript
// ツールIDに必須プレフィックス（skill_id__tool_name）を強制
// getVisibleToolsForRole() で許可外を完全に抹消（空リスト or null）
// AIプロンプト生成時にツール記述をロール専用にカスタム生成
```

#### 2. スキルロード時の厳格検証

- `allowedTools`を既知ツールカタログと照合 → 不一致でスキル無効化
- ログに「スキル 'xxx' 無効：不明ツール 'bash__raw'」と明記（AIには絶対漏らさない）

#### 3. CLIコマンドセット（薄く・動的）

```bash
list tools [role]          # 今見えているツールだけ表示
preview skill <name>       # 追加したらどうなるか差分表示
load / reload skill <name> # 動的反映
set-role <role>            # ロール切り替え → 即ツールリスト更新
status                     # 隠蔽率・有効スキル数・invalidスキル表示
watch                      # ファイル変更監視 + auto-reload
```

#### 4. ビルトイン迂回対策の最強形

- デフォルトで code interpreter / bash を mycelium のツールリストから除外
- 必要な場合のみ、専用スキル（`safe-code-exec`など）でラップして宣言

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Session State                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  activeSkills: [base, reader, editor]               │   │
│  │  availableTools: [Read, Edit, Grep, ...]            │   │
│  │  userRole: developer (許可スキルの上限を決定)        │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│              Intent Classifier                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  User Input → 必要なスキルを判定                     │   │
│  │  "ファイル編集して" → editor skill 必要              │   │
│  │                                                      │   │
│  │  昇格: activeSkillsに追加 + 通知                     │   │
│  │  降格: activeSkillsから削除 + 通知                   │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│                 Tool Filter                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  activeSkillsのallowedToolsをマージ                 │   │
│  │  → LLMに見えるツールリストを生成                    │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────┼─────────────────────────────────┐
│              Single Agent (orchestrator/worker分離なし)      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Claude Agent SDK                                    │   │
│  │  - 見えるツールのみで応答                           │   │
│  │  - スキル変更時に [skill名] を表示                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Skill Definition

```yaml
# skills/reader/SKILL.yaml
name: reader
description: ファイル読み取りスキル
allowedTools:
  - filesystem__read_file
  - filesystem__list_directory
triggers:  # 自動検出用キーワード（オプション）
  - "読んで"
  - "確認して"
  - "見せて"
```

```yaml
# skills/editor/SKILL.yaml
name: editor
description: ファイル編集スキル
allowedTools:
  - filesystem__read_file
  - filesystem__write_file
  - filesystem__list_directory
triggers:
  - "編集"
  - "書き換え"
  - "修正"
```

### User Role (Skill上限の制御)

ユーザーのロールが使用可能なスキルの上限を決定：

```yaml
# roles/developer.yaml
allowedSkills:
  - base
  - reader
  - editor
  - tester
  - git-workflow
# admin-tools は使用不可
```

```yaml
# roles/admin.yaml
allowedSkills:
  - "*"  # 全スキル使用可能
```

## CLI Usage

```bash
# 基本的な使い方（動的スキル管理）
myc                    # セッション開始、最小権限でスタート

# ロール指定（スキル上限を設定）
myc --role developer   # developerが使えるスキルまで
myc --role admin       # 全スキル使用可能

# Adhoc（従来の全ツールアクセス、例外的使用）
myc adhoc              # 全ツール、デバッグ用
```

### Session Example

```
$ myc --role developer

● [common]
こんにちは！何かお手伝いしましょうか？

myc> CLAUDE.mdを編集して

⚠️  スキル昇格: [code-modifier] - コードの作成・編集・リファクタリング
有効にしますか？ [y/N]: y
✓ [code-modifier] を有効化

● [common, code-modifier]
CLAUDE.mdを編集しました。内容は...

myc> テストして

⚠️  スキル昇格: [test-runner] - テストの実行
有効にしますか？ [y/N]: y
✓ [test-runner] を有効化

● [common, code-modifier, test-runner]
テスト結果は...
```

### REPL Commands

```
/help      - ヘルプを表示
/skills    - 有効なスキルを表示
/all       - 全スキルを表示（有効/無効マーク付き）
/add <id>  - スキルを手動追加
/remove <id> - スキルを削除
/tools     - 使用可能なツールを表示
/exit      - 終了
```

## Directory Structure

```
packages/
├── cli/                  # @mycelium/cli - Command-Line Interface
│   └── src/
│       ├── index.ts              # CLI entry point (myc / mycelium)
│       ├── session/
│       │   ├── index.ts          # Re-exports
│       │   ├── session-state.ts  # SessionStateManager
│       │   ├── skill-manager.ts  # SkillManager (昇格/降格)
│       │   └── intent-classifier.ts  # IntentClassifier
│       ├── agents/
│       │   ├── chat-agent.ts     # Chat Agent（推奨）
│       │   ├── workflow-agent.ts # Workflow Agent（スキル制限付き）
│       │   └── adhoc-agent.ts    # Adhoc Agent（全ツールアクセス）
│       ├── commands/
│       │   ├── skill.ts          # mycelium skill add/list
│       │   ├── init.ts           # mycelium init
│       │   ├── mcp.ts            # mycelium mcp start/stop
│       │   ├── config.ts         # mycelium config
│       │   ├── adhoc.ts          # mycelium adhoc
│       │   ├── policy.ts         # mycelium policy check
│       │   └── workflow.ts       # mycelium workflow
│       └── lib/
│           ├── skill-loader.ts   # ディスクからスキル読み込み
│           ├── agent.ts          # Agent SDK wrapper
│           └── ui.ts             # UI utilities (chalk, ora)
│
├── core/                 # @mycelium/core - Router & RBAC
│   └── src/
│       ├── router/
│       │   └── mycelium-core.ts  # ツールルーティング
│       └── rbac/
│           └── tool-visibility-manager.ts
│
├── skills/               # @mycelium/skills - Skill MCP Server
│   ├── src/
│   │   └── index.ts      # MCP Server entry point
│   └── skills/           # スキル定義（30+）
│       ├── common/SKILL.yaml
│       ├── code-modifier/SKILL.yaml
│       ├── test-runner/SKILL.yaml
│       ├── git-workflow/SKILL.yaml
│       └── ...
│
├── session/              # @mycelium/session - Session persistence
│   └── src/
│       ├── mcp-server.ts
│       └── session-store.ts
│
├── sandbox/              # @mycelium/sandbox - Sandboxed execution
│   └── src/
│       ├── mcp-server.ts
│       └── sandbox-manager.ts
│
└── shared/               # @mycelium/shared - Common types
    └── src/
        └── index.ts      # SkillDefinition, Role, etc.
```

## Skill Definition Format

```yaml
# SKILL.yaml
name: skill-id
displayName: Human Readable Name
description: スキルの説明

# このスキルで使用可能なツール
allowedTools:
  - server__tool_name
  - server__another_tool

# 自動検出用トリガー（オプション）
triggers:
  - キーワード1
  - キーワード2

# このスキルを使用可能なロール
allowedRoles:
  - developer
  - admin
```

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript
npm start            # Run CLI (myc)
npm test             # Run tests
```

## Configuration

### config.json

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  },
  "session": {
    "defaultSkills": ["base"],
    "defaultRole": "developer"
  }
}
```

## Implementation Status

### Completed
- [x] 基本的なMCPルーター (`@mycelium/core`)
- [x] スキル定義の読み込み (`@mycelium/skills`)
- [x] ツールフィルタリング
- [x] セッション状態管理 (`SessionStateManager`)
- [x] 意図分類器 (`IntentClassifier`)
- [x] 動的スキル昇格/降格
- [x] スキル変更通知 (`● [skill名]`)
- [x] ロールベースのスキル上限
- [x] 全スキル承認フロー（`requireApproval: true`）
- [x] 会話履歴によるコンテキスト維持
- [x] Protected Skills（降格禁止スキル）

### Future Enhancements
- [ ] スキルロード時の厳格検証（不明ツールでスキル無効化）
- [ ] CLIの`preview skill`コマンド（差分プレビュー）
- [ ] ファイル変更監視 + auto-reload
- [ ] 隠蔽率・有効スキル数の統計表示

## Best Practices

### スキル設計

```yaml
# ✅ 良い例: 最小限のツール
name: reader
allowedTools:
  - filesystem__read_file
  - filesystem__list_directory

# ❌ 悪い例: 広すぎる権限
name: file-all
allowedTools:
  - filesystem__*
```

### セキュリティ

1. **デフォルトは最小権限**: baseスキルは読み取り専用など
2. **ロールで上限設定**: ユーザーが使えるスキルを制限
3. **降格を活用**: 不要になったスキルは外す
4. **ログ**: スキル変更履歴を記録

## Code Style

- **TypeScript**: Strict mode, ES2022
- **Module**: ESM (NodeNext)
- **Naming**: PascalCase (classes), camelCase (functions)
