# Aegis-CLI

スキル駆動のロールベースアクセス制御（RBAC）を備えたMCPプロキシルーター

## 概要

Aegis-CLIは、Claude Agent SDKとMCP（Model Context Protocol）サーバーを統合し、**スキルから動的にロールを生成**するアクセス制御を提供します。

## 特徴

- **スキル駆動RBAC**: スキルが`allowedRoles`を宣言 → ロールが動的に生成
- **MCPプロキシ**: 複数のMCPサーバーを統合管理
- **動的ロール切り替え**: `get_agent_manifest`でロールを変更
- **設定ファイル不要**: スキル追加だけで拡張可能

## インストール

```bash
npm install
npm run build
```

## 使用方法

### CLIとして起動

```bash
npm start
```

### MCPサーバーとして起動

```bash
npm run start:mcp
```

## アーキテクチャ (v2: スキル駆動)

```
┌─────────────────────────────────────────────────────────────┐
│                    Aegis-skills (MCP Server)                │
│  list_skills → スキル一覧を提供                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Skill: docx-handler                                 │   │
│  │  - allowedRoles: [formatter, admin]                  │   │
│  │  - allowedTools: [filesystem__read, docx__parse]     │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼ list_skills
┌─────────────────────────────────────────────────────────────┐
│                    Aegis Router                             │
│  loadFromSkillManifest() → 動的ロール生成                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Role: formatter                                     │   │
│  │  - skills: [docx-handler]                            │   │
│  │  - tools: [filesystem__read, docx__parse]            │   │
│  │  - servers: [filesystem, docx]                       │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼ get_agent_manifest
┌─────────────────────────────────────────────────────────────┐
│                    Agent (Claude)                           │
│  - ロール選択 → 利用可能なツールが変わる                      │
│  - スキルに基づいた権限で動作                                 │
└─────────────────────────────────────────────────────────────┘
```

## 設定

### サーバー設定 (`config.json`)

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home"]
    },
    "aegis-skills": {
      "command": "node",
      "args": ["node_modules/aegis-skills/index.js", "node_modules/aegis-skills/skills"]
    }
  }
}
```

## スキル定義（Aegis-skills側）

スキルは`allowedRoles`を宣言し、どのロールがそのスキルを使えるかを決定します：

```yaml
# SKILL.md
---
id: docx-handler
displayName: DOCX Handler
allowedRoles:
  - formatter
  - admin
allowedTools:
  - filesystem__read_file
  - filesystem__write_file
  - docx__parse
  - docx__export
---

# DOCX Handler Skill

DOCXファイルの読み取りと編集を行うスキル。
```

## テスト

```bash
npm test
```

### テスト構成 (54テスト)

| ファイル | 内容 |
|---------|------|
| `role-config.test.ts` | スキルマニフェストからのロール生成 |
| `tool-filtering.test.ts` | ロールごとのツールフィルタリング |
| `skill-integration.test.ts` | スキル統合テスト |
| `role-switching.test.ts` | ロール切り替えテスト |

## 関連リポジトリ

- [Aegis-skills](https://github.com/Shin0205go/Aegis-skills) - Skill MCP Server

## ライセンス

MIT
