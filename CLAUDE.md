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

myc> こんにちは
[base]
こんにちは！何かお手伝いしましょうか？

myc> CLAUDE.mdを読んで
[base] → [reader]  ← スキル昇格通知
CLAUDE.mdの内容は...

myc> 少し修正して
[reader] → [reader, editor]  ← スキル追加
修正しました。

myc> 終わり、テスト実行して
[reader, editor] → [reader, tester]  ← editor降格、tester昇格
テスト結果は...
```

## Directory Structure

```
packages/
├── cli/                  # @mycelium/cli - Command-Line Interface
│   └── src/
│       ├── index.ts              # CLI entry point
│       ├── session/
│       │   ├── session-state.ts  # セッション状態管理
│       │   ├── skill-manager.ts  # スキル昇格/降格ロジック
│       │   └── intent-classifier.ts  # 意図→スキルマッピング
│       ├── agents/
│       │   └── chat-agent.ts     # 単一エージェント（orchestrator/worker統合）
│       └── lib/
│           ├── tool-filter.ts    # activeSkillsベースのツールフィルタ
│           └── ui.ts             # UI utilities
│
├── core/                 # @mycelium/core - Router & RBAC
│   └── src/
│       ├── router/
│       │   └── mycelium-core.ts  # ツールルーティング
│       └── rbac/
│           └── tool-visibility-manager.ts  # ツール可視性制御
│
├── skills/               # @mycelium/skills - Skill Definitions
│   └── skills/
│       ├── base/SKILL.yaml
│       ├── reader/SKILL.yaml
│       ├── editor/SKILL.yaml
│       ├── tester/SKILL.yaml
│       └── ...
│
└── shared/               # @mycelium/shared - Common types
    └── src/
        └── index.ts
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
- [x] 基本的なMCPルーター
- [x] スキル定義の読み込み
- [x] ツールフィルタリング

### TODO (新アーキテクチャ)
- [ ] セッション状態管理 (SessionState)
- [ ] 意図分類器 (IntentClassifier)
- [ ] 動的スキル昇格/降格
- [ ] スキル変更通知 (`[skill名]`)
- [ ] ロールベースのスキル上限

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
