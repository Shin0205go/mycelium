# Aegis-CLI

スキル駆動のロールベースアクセス制御（RBAC）を備えたMCPプロキシルーター

> **"Human-in-the-loopの代わりに、Policy-in-the-loop"**
>
> 人間が毎回判断する代わりに、事前に宣言されたポリシーがエージェントの行動を制約する。

## なぜAegisか？

MCPが業界標準になった今（OpenAI, Google, Microsoft採用）、**10,000+のMCPサーバー**に対するアクセス制御が必要です。特に：

- **マルチエージェント時代**: サブエージェントへの並行タスク委譲で毎回Human承認は非現実的
- **サーバー側宣言**: クライアント（エージェント）を信頼せず、サーバーが権限を定義
- **動的ロール生成**: スキルが`allowedRoles`を宣言 → ロールが自動生成

## 概要

Aegis-CLIは、Claude Agent SDKとMCP（Model Context Protocol）サーバーを統合し、**スキルから動的にロールを生成**するアクセス制御を提供します。

## 特徴

- **スキル駆動RBAC**: スキルが`allowedRoles`を宣言 → ロールが動的に生成
- **MCPプロキシ**: 複数のMCPサーバーを統合管理
- **動的ロール切り替え**: `set_role`でロールを変更
- **監査ログ**: 全ツール呼び出しを記録、CSV/JSONエクスポート対応
- **Rate Limiting**: ロールごとのQuota設定で暴走防止
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
│                    AegisRouterCore (司令塔)                  │
│  ├── StdioRouter (MCPサーバー接続管理)                       │
│  ├── RoleManager (ロール定義・権限チェック)                   │
│  └── ToolVisibilityManager (ツールフィルタリング)             │
│                                                             │
│  loadFromSkillManifest() → 動的ロール生成                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Role: formatter                                     │   │
│  │  - skills: [docx-handler]                            │   │
│  │  - tools: [filesystem__read, docx__parse]            │   │
│  │  - servers: [filesystem, docx]                       │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼ set_role
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

## ユースケース

### 1. マルチエージェント並行処理の安全な実行

Human-in-the-loopでは100並行タスクを毎回承認するのは非現実的。Aegisは**Policy-in-the-loop**で解決：

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator Agent                        │
│                          │                                   │
│         ┌────────────────┼────────────────┐                  │
│         ▼                ▼                ▼                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│   │SubAgent A│    │SubAgent B│    │SubAgent C│   ← 並行実行  │
│   │(analyst) │    │(writer)  │    │(reviewer)│              │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│        ▼               ▼               ▼                     │
│   [DB読取のみ]    [ファイル書込]   [読取のみ]   ← ロールで制限│
└─────────────────────────────────────────────────────────────┘
```

```yaml
# スキル定義で事前に許可を宣言（サーバー側）
id: data-analyst
allowedRoles: [analyst]
allowedTools:
  - postgres__select   # ✅ 読取OK
  - postgres__explain  # ✅ 実行計画OK
  # postgres__drop は含まない → 自動的に拒否
```

### 2. 監査ログとコンプライアンス対応

```typescript
// 全ツール呼び出しを自動記録
const stats = router.getAuditStats();
// {
//   totalEntries: 1523,
//   byResult: { allowed: 1500, denied: 20, error: 3 },
//   denialRate: 0.013,
//   topTools: [{ tool: 'filesystem__read', count: 500 }, ...]
// }

// CSV/JSONエクスポートで監査対応
const auditCsv = router.exportAuditLogsCsv();
```

### 3. サブエージェントの暴走防止（Rate Limiting）

```typescript
// ロールごとのQuota設定
router.setRoleQuota('guest', {
  maxCallsPerMinute: 10,    // 1分間に10回まで
  maxCallsPerHour: 100,     // 1時間に100回まで
  maxConcurrent: 3,         // 同時実行は3つまで
  toolLimits: {
    'openai__chat': { maxCallsPerMinute: 5 }  // 特定ツールは更に制限
  }
});
```

### 4. 開発/本番環境の権限分離

```yaml
# 開発者ロール - 広い権限
id: developer
allowedTools: [filesystem__*, git__*, npm__*]

# 本番オペレーター - 読取中心
id: operator
allowedTools: [kubernetes__get_*, monitoring__*]
# kubernetes__delete は除外 → 本番破壊を防止
```

### 5. サードパーティMCPサーバーの安全な統合

```
[10,000+ 公開MCPサーバー] → [Aegis Router] → [社内エージェント]
                              ↑
                    ・信頼できないサーバーからの保護
                    ・センシティブ情報の漏洩防止
                    ・APIコスト管理
```

## テスト

```bash
npm test
```

### テスト構成 (79テスト)

| ファイル | 内容 |
|---------|------|
| `role-manager.test.ts` | RoleManager: スキルマニフェストからのロール生成 |
| `tool-filtering.test.ts` | ロールごとのツールフィルタリング |
| `tool-visibility-manager.test.ts` | ToolVisibilityManager: ツール可視性管理 |
| `skill-integration.test.ts` | スキル統合テスト |
| `role-switching.test.ts` | ロール切り替えテスト |
| `real-e2e.test.ts` | 実際のaegis-skillsサーバーとのE2Eテスト |

## 関連リポジトリ

- [Aegis-skills](https://github.com/Shin0205go/Aegis-skills) - Skill MCP Server

## ライセンス

MIT
