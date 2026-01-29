# MCP Server 本格化 実装計画

## 目標

Myceliumを**独立したMCPサーバー**として本格的に位置づけ、外部AIエージェント（Claude Desktop、Claude Code、Cursor）とシームレスに統合できるようにする。

**核心原則**: 許可外ツールは**名前すら見せない**（認知の外への完全排除）

---

## Phase 1: クライアント分離（優先度: 高）

### 1.1 現状の問題

```
現在のアーキテクチャ:
┌─────────────────────────────────────────┐
│  @mycelium/cli                          │
│  ├── chat-agent.ts  (Claude Agent SDK)  │
│  ├── adhoc-agent.ts (Claude Agent SDK)  │
│  └── workflow-agent.ts                  │
│            ↓                            │
│  createAgentOptions() で内部的に        │
│  mycelium-router を子プロセス起動       │
└─────────────────────────────────────────┘
```

**問題点**:
- CLIとMCPサーバーが密結合
- Claude Desktop/Cursor から直接接続できない
- 各CLIセッションが独自にルーターを起動（リソース無駄）

### 1.2 目標アーキテクチャ

```
新アーキテクチャ:
┌─────────────────────────────────────────────────────────────┐
│                  外部クライアント                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │Claude Desktop│ │ Claude Code │ │   Cursor    │            │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘            │
│         │               │               │                    │
│         └───────────────┴───────────────┘                    │
│                         │ stdio/SSE                          │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │        @mycelium/core (MCP Server)                  │    │
│  │  ┌─────────────────────────────────────────────┐   │    │
│  │  │  mcp-server.ts (独立プロセス)               │   │    │
│  │  │  - ListTools: ロール別フィルタリング        │   │    │
│  │  │  - CallTool: アクセスチェック後ルーティング │   │    │
│  │  │  - set_role: 動的ロール切り替え             │   │    │
│  │  └─────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
│                         │                                    │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           Backend MCP Servers                       │    │
│  │  mycelium-skills │ filesystem │ sandbox │ etc.     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  @mycelium/cli (オプション)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  薄いクライアント + REPL                            │   │
│  │  - /tools: 現在見えるツール一覧                     │   │
│  │  - /skills: スキル管理                              │   │
│  │  - /status: 状態確認                                │   │
│  │  - MCPサーバーへ接続（起動済みに）                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 実装タスク

#### Task 1.3.1: MCPサーバー独立起動モード
**ファイル**: `packages/core/src/mcp-server.ts`

```typescript
// 現在: package.jsonのstart:mcpで起動可能だが、ドキュメント/整備不足
// 改善:
// 1. 起動時のログ出力強化（接続待ち状態を明示）
// 2. 環境変数での設定（MYCELIUM_DEFAULT_ROLE, MYCELIUM_LOG_LEVEL）
// 3. Graceful shutdown対応
```

**新規追加**:
```bash
# 新しい起動コマンド
myc server                    # MCPサーバー単独起動
myc server --role developer   # デフォルトロール指定
myc server --port 3000        # HTTP/SSEモード（将来）
```

#### Task 1.3.2: CLIをMCPクライアントとして分離
**ファイル**: `packages/cli/src/commands/server.ts` (新規)

```typescript
// server.ts - MCPサーバー起動コマンド
export async function runServer(options: ServerOptions): Promise<void> {
  // 1. config.json読み込み
  // 2. MyceliumCoreを初期化
  // 3. stdioでMCPサーバー起動
  // 4. 接続待ち（ログ出力）
}
```

**ファイル**: `packages/cli/src/commands/client.ts` (新規)

```typescript
// client.ts - MCPクライアントモード（既存サーバーに接続）
export async function runClient(options: ClientOptions): Promise<void> {
  // 1. 既存のMCPサーバープロセスに接続
  // 2. 薄いREPL提供
  // 3. /tools, /skills, /status コマンド
}
```

#### Task 1.3.3: package.json スクリプト整理

```json
{
  "scripts": {
    "start": "node dist/index.js",
    "server": "node dist/index.js server",
    "client": "node dist/index.js client",
    "chat": "node dist/index.js chat"
  },
  "bin": {
    "myc": "dist/index.js",
    "mycelium": "dist/index.js",
    "mycelium-server": "dist/server.js"
  }
}
```

---

## Phase 2: ToolVisibilityManager強化（優先度: 高）

### 2.1 現状の問題

```typescript
// 現在の実装 (tool-visibility-manager.ts)
// - ロールベースのサーバー制限あり
// - ツールレベルのフィルタリングあり
// - ただし、スキルベースの動的フィルタリングが不完全
```

**問題点**:
- スキルの`allowedTools`がCLI側（SessionStateManager）で管理
- MCPサーバー側（ToolVisibilityManager）との連携が弱い
- 同一ロールでもスキル変更時のツール更新が不完全

### 2.2 目標アーキテクチャ

```
ツール可視性の決定フロー:
┌─────────────────────────────────────────────────────────────┐
│  Step 1: ロールベースフィルタ                               │
│  role.allowedServers → サーバーレベルで絞り込み            │
│  role.toolPermissions → ツールレベルで絞り込み             │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 2: スキルベースフィルタ（新規強化）                   │
│  activeSkills[].allowedTools → さらに絞り込み              │
│  ロール許可 ∩ スキル許可 = 最終的に見えるツール            │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 3: MCPレスポンス生成                                  │
│  getVisibleTools() → フィルタ済みツールリストのみ返す      │
│  許可外ツールは名前・説明・スキーマ一切含めない            │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 実装タスク

#### Task 2.3.1: ToolVisibilityManagerにスキル連携追加
**ファイル**: `packages/core/src/rbac/tool-visibility-manager.ts`

```typescript
// 新規追加
interface ToolVisibilityConfig {
  currentRole: string;
  activeSkills: string[];        // 新規: アクティブスキルID
  skillDefinitions: Map<string, SkillDefinition>;  // 新規: スキル定義
}

class ToolVisibilityManager {
  private activeSkills: string[] = [];
  private skillDefinitions: Map<string, SkillDefinition> = new Map();

  // 新規メソッド
  setActiveSkills(skillIds: string[]): void {
    this.activeSkills = skillIds;
    this.recalculateVisibility();
  }

  loadSkillDefinitions(skills: SkillDefinition[]): void {
    this.skillDefinitions = new Map(skills.map(s => [s.id, s]));
  }

  private recalculateVisibility(): void {
    // 1. ロールベースのフィルタ（既存）
    // 2. スキルベースのフィルタ（新規）
    //    - activeSkillsの各スキルのallowedToolsをマージ
    //    - ロール許可 ∩ スキル許可 = 最終可視ツール
  }

  getVisibleTools(): ToolInfo[] {
    // 現在のロール + アクティブスキルに基づいてフィルタ
  }
}
```

#### Task 2.3.2: MyceliumCoreにスキル状態管理追加
**ファイル**: `packages/core/src/router/mycelium-core.ts`

```typescript
// 新規追加
class MyceliumCore {
  // 新規メソッド
  setActiveSkills(skillIds: string[]): void {
    this.toolVisibility.setActiveSkills(skillIds);
    // ツールリスト更新イベント発火
    this.emit('toolsChanged', this.getVisibleTools());
  }

  // 新規ルーターツール
  private handleSetActiveSkills(args: { skills: string[] }): void {
    this.setActiveSkills(args.skills);
    return { success: true, activeSkills: args.skills };
  }
}

// ROUTER_TOOLS に追加
const ROUTER_TOOLS = [
  'mycelium-router__get_context',
  'mycelium-router__list_roles',
  'mycelium-router__set_active_skills',  // 新規
  'mycelium-router__get_active_skills',  // 新規
];
```

#### Task 2.3.3: MCPサーバーにスキル管理ツール追加
**ファイル**: `packages/core/src/mcp-server.ts`

```typescript
// 新規ツール定義
const SKILL_MANAGEMENT_TOOLS = [
  {
    name: 'mycelium-router__set_active_skills',
    description: 'アクティブスキルを設定（ツール可視性に影響）',
    inputSchema: {
      type: 'object',
      properties: {
        skills: { type: 'array', items: { type: 'string' } }
      },
      required: ['skills']
    }
  },
  {
    name: 'mycelium-router__get_active_skills',
    description: '現在のアクティブスキルを取得',
    inputSchema: { type: 'object', properties: {} }
  }
];
```

---

## Phase 3: Claude Desktop/Cursor統合（優先度: 中）

### 3.1 実装タスク

#### Task 3.1.1: Claude Desktop設定ドキュメント
**ファイル**: `docs/claude-desktop-integration.md` (新規)

```markdown
# Claude Desktop との統合

## 設定方法

`~/Library/Application Support/Claude/claude_desktop_config.json`:

\`\`\`json
{
  "mcpServers": {
    "mycelium": {
      "command": "node",
      "args": ["/path/to/mycelium/packages/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "/path/to/mycelium/config.json",
        "MYCELIUM_DEFAULT_ROLE": "developer"
      }
    }
  }
}
\`\`\`

## 使用例

Claude Desktopで:
- ツールリストはロールに基づき自動フィルタリング
- "ファイル編集して" → code-modifierスキルのツールのみ表示
```

#### Task 3.1.2: Cursor/Cline設定ドキュメント
**ファイル**: `docs/cursor-integration.md` (新規)

---

## Phase 4: 将来の拡張（優先度: 低）

### 4.1 HTTP/SSEモード
- WebSocket/SSEでリモート接続対応
- 認証（JWT/APIキー）追加

### 4.2 Tool Search対応
- ツール数が多い場合の検索機能
- コンテキスト節約

### 4.3 確認フロー
- ファイル生成系ツールに`userConfirmationRequired`フラグ

---

## 実装スケジュール

| Phase | タスク | 工数目安 | 優先度 |
|-------|--------|---------|--------|
| 1.3.1 | MCPサーバー独立起動モード | 2-3時間 | 高 |
| 1.3.2 | CLI分離（server/clientコマンド） | 3-4時間 | 高 |
| 1.3.3 | package.json整理 | 30分 | 高 |
| 2.3.1 | ToolVisibilityManagerスキル連携 | 3-4時間 | 高 |
| 2.3.2 | MyceliumCoreスキル状態管理 | 2-3時間 | 高 |
| 2.3.3 | MCPサーバースキル管理ツール | 1-2時間 | 高 |
| 3.1.1 | Claude Desktop統合ドキュメント | 1時間 | 中 |
| 3.1.2 | Cursor統合ドキュメント | 1時間 | 中 |

**合計**: 約14-18時間（Phase 1-2のみ）

---

## 変更対象ファイル一覧

### 新規作成
- `packages/cli/src/commands/server.ts`
- `packages/cli/src/commands/client.ts`
- `docs/claude-desktop-integration.md`
- `docs/cursor-integration.md`

### 大幅修正
- `packages/core/src/rbac/tool-visibility-manager.ts`
- `packages/core/src/router/mycelium-core.ts`
- `packages/core/src/mcp-server.ts`
- `packages/cli/src/index.ts`
- `packages/cli/package.json`

### 軽微修正
- `config.json`
- `README.md`
- `CLAUDE.md`

---

## 検証方法

### Phase 1 完了確認
```bash
# MCPサーバー単独起動
myc server --role developer
# → "MCP Server ready, waiting for connections..."

# 別ターミナルでClaude Desktop起動
# → myceliumツールが表示される
```

### Phase 2 完了確認
```bash
# ロール: developer, スキル: [common]
# → list_skills, get_skill のみ表示

# スキル追加: [common, code-modifier]
# → filesystem__read_file, write_file なども表示

# ロール: admin, スキル: [adhoc-tools]
# → 全ツール表示
```
