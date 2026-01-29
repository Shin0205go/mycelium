# Claude Code Hooks 統合

MyceliumとClaude Codeを連携し、ビルトインツール（Bash, Edit, Write）に対してもPolicy-in-the-loopを適用する方法。

## 概要

Claude CodeのビルトインツールはMCP経由ではないため、通常のMyceliumルーティングでは制御できません。Hooks機能を使うことで、これらのツールにもロールベースのアクセス制御を適用できます。

```
┌─────────────────────────────────────────────────────┐
│  Claude Code                                        │
│  ┌─────────────────┐  ┌─────────────────────┐      │
│  │ ビルトインツール  │  │   MCPクライアント    │      │
│  │ - Bash          │  │                     │      │
│  │ - Edit          │  │                     │      │
│  │ - Write         │  │                     │      │
│  └────────┬────────┘  └──────────┬──────────┘      │
│           │                       │                 │
│     PreToolUse Hook          MCP Server            │
│           │                       │                 │
│           ▼                       ▼                 │
│  ┌────────────────────────────────────────────┐    │
│  │  ~/.mycelium/session-state.json            │    │
│  │  (ロール・許可ツール情報)                    │    │
│  └────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## セットアップ

### 1. Hooksディレクトリの確認

```bash
ls -la .claude/hooks/
# mycelium-hook.mjs        - メインフック
# subagent-role-hook.mjs   - サブエージェントロール管理
```

### 2. settings.local.json の設定

`.claude/settings.local.json` に以下を追加:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Edit|Write|Task",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/mycelium-hook.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/subagent-role-hook.mjs\"",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/subagent-role-hook.mjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

### 3. MCPサーバーの起動確認

`.mcp.json` でmycelium-routerが設定されていることを確認:

```json
{
  "mcpServers": {
    "mycelium-router": {
      "command": "node",
      "args": ["packages/core/dist/mcp-server.js"]
    }
  }
}
```

## 使い方

### ロール切り替え

MCPツールでロールを切り替えると、`~/.mycelium/session-state.json` が自動更新されます:

```
mcp__mycelium-router__mycelium-router__set_role(role: "viewer")
```

### サブエージェントにロール指定

Taskツールのプロンプトに `role: <ロール名>` を含めると、そのサブエージェントは指定されたロールで動作します:

```
「role: viewer でREADMEを確認して」
「viewerロールでファイル一覧を取得」
「as developer role, run the tests」
```

#### 認識されるパターン

| パターン | 例 |
|---------|-----|
| `role: <name>` | `role: viewer` |
| `as <name> role` | `as developer role` |
| `with <name> role` | `with tester role` |
| `<name>ロール` | `viewerロール` |
| `ロール: <name>` | `ロール: admin` |

### ロール別の権限

| ロール | Bash | Edit/Write | 用途 |
|--------|------|------------|------|
| `viewer` | ❌ | ❌ | 読み取り専用の調査 |
| `tester` | ✅ | ✅ | テスト実行 |
| `developer` | ✅ | ✅ | 開発作業 |
| `adhoc` | ✅ | ✅ | 全ツールアクセス |

## 仕組み

### セッション状態ファイル

`~/.mycelium/session-state.json`:

```json
{
  "enabled": true,
  "role": "viewer",
  "roleName": "Viewer",
  "activeSkills": ["viewer"],
  "allowedTools": [
    "filesystem__read_file",
    "filesystem__list_directory",
    "filesystem__search_files"
  ],
  "sessionId": "xxx",
  "updatedAt": "2026-01-29T12:00:00.000Z"
}
```

### ツールマッピング

ビルトインツールはMCPツールにマッピングされて権限チェックされます:

| ビルトインツール | 許可条件（いずれかがallowedToolsにあれば許可） |
|-----------------|---------------------------------------------|
| `Bash` | `filesystem__write_file`, `filesystem__create_directory` |
| `Edit` | `filesystem__write_file` |
| `Write` | `filesystem__write_file` |
| `Read` | `filesystem__read_file` |
| `Glob` | `filesystem__search_files`, `filesystem__list_directory` |

### フロー

```
1. Task("role: viewer でファイル確認")
      ↓
2. PreToolUse(Task) → pendingSubagentRole = "viewer" を保存
      ↓
3. SubagentStart → session-state.json をviewerに更新
      ↓
4. サブエージェント内でBash実行
      ↓
5. PreToolUse(Bash) → session-state読み込み
      ↓
6. viewerにはwrite_fileがない → Bashブロック
      ↓
7. SubagentStop → 元のロールに復元
```

## トラブルシューティング

### Hooksが動作しない

1. Claude Codeを再起動（hooks設定は起動時に読み込まれる）
2. `/hooks` コマンドで登録状況を確認
3. verbose mode (Ctrl+O) でhook出力を確認

### ロール変更が反映されない

1. MCPサーバーを再接続: `/mcp` → Reconnect
2. `~/.mycelium/session-state.json` を確認
3. MCPサーバーがビルド済みか確認: `npm run build`

### 自分がロックアウトされた

viewerロールなどでBash/Writeが使えなくなった場合:

```bash
# ターミナルで直接実行
echo '{"enabled":false}' > ~/.mycelium/session-state.json
```

### サブエージェントのロールが適用されない

1. Taskプロンプトに `role: <name>` が含まれているか確認
2. SubagentStart/Stop hooksが設定されているか確認
3. `subagent-role-hook.mjs` の ROLE_TOOLS に対象ロールがあるか確認

## 制限事項

- **Claude Code専用**: この方法はClaude Codeのhooks機能に依存
- **静的なロール定義**: `subagent-role-hook.mjs` 内のROLE_TOOLSは手動更新が必要
- **単一セッション**: 複数のClaude Codeインスタンスで同時使用すると競合の可能性

## 関連ドキュメント

- [Claude Desktop統合](./claude-desktop-integration.md)
- [Cursor統合](./cursor-integration.md)
- [CLAUDE.md](../CLAUDE.md) - プロジェクト設計指針
