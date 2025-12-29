# Aegis-CLI

ロールベースアクセス制御（RBAC）を備えたMCPプロキシルーター

## 概要

Aegis-CLIは、Claude Agent SDKとMCP（Model Context Protocol）サーバーを統合し、ロールに基づいたツール・サーバー・スキルのアクセス制御を提供します。

## 特徴

- **ロールベースアクセス制御**: 役割に応じたツール・サーバーへのアクセス制限
- **MCPプロキシ**: 複数のMCPサーバーを統合管理
- **動的ロール切り替え**: 実行時にロールを変更可能
- **エージェントスキル制御**: エージェントごとに利用可能なスキルを制限

## インストール

```bash
npm install
npm run build
```

## 使用方法

### CLIとして起動

```bash
npm start
# または
npx aegis
```

### MCPサーバーとして起動

```bash
npm run start:mcp
# または
npx aegis-router
```

## 設定

### ロール定義 (`roles/aegis-roles.json`)

```json
{
  "roles": {
    "frontend": {
      "allowedServers": ["filesystem"],
      "toolPermissions": {
        "allowPatterns": ["*__read_*", "*__write_*", "*__list_*"],
        "denyPatterns": ["*__delete_*", "*__execute_*"]
      }
    }
  }
}
```

### サーバー設定 (`config.json`)

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-server-filesystem", "/path/to/dir"]
    }
  }
}
```

## テスト

```bash
npm test
```

### テスト構成

4つのRBAC観点でテストを整理:

| ファイル | 観点 |
|---------|------|
| `role-config.test.ts` | ロール定義、サーバー制御、スキル制御 |
| `tool-filtering.test.ts` | ツール制御 |

## アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│                   Aegis-CLI                      │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────────────────┐   │
│  │   Agent     │  │     RoleConfigManager   │   │
│  │  (Claude)   │  │  - ロール定義           │   │
│  └──────┬──────┘  │  - サーバー制御         │   │
│         │         │  - ツール制御           │   │
│         ▼         │  - スキル制御           │   │
│  ┌─────────────┐  └─────────────────────────┘   │
│  │ MCP Proxy   │◄─────────────────────────────┤ │
│  │  Router     │                               │ │
│  └──────┬──────┘                               │ │
│         │                                       │ │
│         ▼                                       │ │
│  ┌─────────────────────────────────────────┐   │ │
│  │          Backend MCP Servers            │   │ │
│  │  ┌──────────┐ ┌──────────┐ ┌─────────┐ │   │ │
│  │  │filesystem│ │playwright│ │  ...    │ │   │ │
│  │  └──────────┘ └──────────┘ └─────────┘ │   │ │
│  └─────────────────────────────────────────┘   │ │
└─────────────────────────────────────────────────┘
```

## ロール一覧

| ロール | 説明 | サーバーアクセス |
|--------|------|-----------------|
| orchestrator | 統括（デフォルト） | なし |
| frontend | フロントエンド開発 | filesystem |
| backend | バックエンド開発 | @development |
| security | セキュリティ監査 | filesystem (読み取りのみ) |
| devops | インフラ管理 | @all |
| guest | ゲスト | filesystem (読み取りのみ) |

## ライセンス

MIT
