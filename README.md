# AEGIS

**Skill-Driven RBAC for the Agentic AI Era**

> ロールを定義するな。スキルに宣言させろ。
>
> *Don't define roles. Let skills declare them.*

## パッケージ構成

```
aegis/
├── packages/
│   ├── router/     # @aegis/router - MCPプロキシルーター
│   └── skills/     # @aegis/skills - スキルMCPサーバー
```

| パッケージ | 説明 |
|-----------|------|
| `@aegis/router` | スキル駆動RBACを実装したMCPプロキシ |
| `@aegis/skills` | スキル定義を提供するMCPサーバー |

## スキル駆動RBACとは？

従来のRBACは「ロールがツールを定義」する。AEGISは逆転の発想：

```
┌─────────────────────────────────────────────────────────────┐
│  従来のRBAC                    AEGIS (スキル駆動)            │
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

## なぜスキル駆動か？

### 1. サーバー側が権限を宣言（Trust Boundary）

```
従来: Agent → "俺はadminだ" → Server（信じるしかない）
AEGIS: Server → "このスキルはadmin専用" → Router → Agent
                     ↑
               サーバーが権限を決める
```

クライアント（エージェント）を**信頼しなくていい設計**。

### 2. マルチエージェント時代のアクセス制御

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator Agent                        │
│         ┌────────────────┼────────────────┐                  │
│         ▼                ▼                ▼                  │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│   │SubAgent A│    │SubAgent B│    │SubAgent C│  ← 100並行   │
│   │(analyst) │    │(writer)  │    │(reviewer)│              │
│   └────┬─────┘    └────┬─────┘    └────┬─────┘              │
│        ▼               ▼               ▼                     │
│   [DB読取のみ]    [ファイル書込]   [読取のみ]   ← ロールで制限│
└─────────────────────────────────────────────────────────────┘

Human-in-the-loop → 100回承認？ 非現実的
Policy-in-the-loop → 事前宣言で自律実行 ✅
```

### 3. 設定ファイル不要

```yaml
# スキルを追加するだけ（packages/skills/skills/に配置）
---
id: new-skill
allowedRoles: [developer, admin]
allowedTools: [git__*, npm__*]
---

# → developerロールが自動生成
# → git__*, npm__* が自動的に許可
```

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                 @aegis/skills (MCP Server)                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Skill: docx-handler                                 │   │
│  │  - allowedRoles: [formatter, admin]  ← スキルが宣言  │   │
│  │  - allowedTools: [filesystem__read, docx__parse]     │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │ list_skills
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                 @aegis/router (司令塔)                       │
│                                                              │
│  Skills → Roles 変換（Inverted RBAC）                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Role: formatter (自動生成)                          │   │
│  │  - skills: [docx-handler]                            │   │
│  │  - tools: [filesystem__read, docx__parse]            │   │
│  └─────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │ set_role
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent (Claude / ChatGPT / Gemini)              │
│  - set_role("formatter") → 許可されたツールのみ表示          │
│  - 許可されていないツールは見えない・呼べない                 │
└─────────────────────────────────────────────────────────────┘
```

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
npm run dev --workspace=@aegis/router
```

### MCPサーバーとして起動（Claude Desktop等から利用）

```bash
npm run start:mcp --workspace=@aegis/router
```

## スキル定義

スキルは `packages/skills/skills/` に配置し、`allowedRoles` を宣言：

```yaml
# packages/skills/skills/data-analyst/SKILL.md
---
id: data-analyst
displayName: Data Analyst
allowedRoles:
  - analyst
  - admin
allowedTools:
  - postgres__select
  - postgres__explain
  # postgres__drop は含めない → 自動的に拒否
---

# Data Analyst Skill

データ分析のためのスキル。SELECT文の実行と実行計画の確認が可能。
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
      "args": ["packages/skills/dist/index.js", "packages/skills/skills"]
    }
  }
}
```

## 追加機能

### 監査ログ

全ツール呼び出しを自動記録：

```typescript
const stats = router.getAuditStats();
const csv = router.exportAuditLogsCsv();  // コンプライアンス対応
```

### Rate Limiting（オプション）

ロールごとのQuota設定：

```typescript
router.setRoleQuota('guest', {
  maxCallsPerMinute: 10,
  maxConcurrent: 3
});
```

## テスト

```bash
npm test
```

## ライセンス

MIT
