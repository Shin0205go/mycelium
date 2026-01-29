# Claude Desktop との統合

MyceliumをClaude DesktopのMCPサーバーとして使用する方法。

## 概要

Myceliumは**Policy-in-the-loop**アーキテクチャを採用したMCPサーバーです。Claude Desktopと統合することで：

- **ロールベースのツール制御**: 許可されたツールのみが表示される
- **スキルベースの動的フィルタリング**: タスクに応じてツールセットを切り替え
- **完全なツール隠蔽**: 許可外ツールは名前すら見えない

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Desktop                            │
│                         │                                    │
│                         ▼ stdio                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Mycelium MCP Server                     │    │
│  │  ┌─────────────────────────────────────────────┐   │    │
│  │  │  Role: developer                            │   │    │
│  │  │  Active Skills: [common, code-modifier]     │   │    │
│  │  │  Visible Tools: 12/50 (filtered)            │   │    │
│  │  └─────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
│                         │                                    │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │        Backend MCP Servers (filesystem, etc.)       │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## セットアップ

### 1. Myceliumをビルド

```bash
cd /path/to/mycelium
npm install
npm run build
```

### 2. Claude Desktop設定ファイルを編集

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mycelium": {
      "command": "node",
      "args": ["/path/to/mycelium/packages/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "/path/to/mycelium/config.json",
        "MYCELIUM_CURRENT_ROLE": "developer"
      }
    }
  }
}
```

### 3. Claude Desktopを再起動

設定後、Claude Desktopを再起動するとMyceliumのツールが利用可能になります。

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `MYCELIUM_CONFIG_PATH` | config.jsonのパス | `./config.json` |
| `MYCELIUM_CURRENT_ROLE` | 初期ロール | `default` |
| `MYCELIUM_CURRENT_SKILL` | 初期スキル（カンマ区切り） | - |

## ロールとスキルによるツール可視性

Myceliumは**2段階のフィルタリング**でツールを制御します：

### ステップ1: ロールベースフィルタ

```yaml
# roles/developer.yaml
allowedServers:
  - filesystem
  - mycelium-skills
  - mycelium-sandbox
toolPermissions:
  allow:
    - "filesystem__*"
    - "mycelium-skills__*"
```

### ステップ2: スキルベースフィルタ

```yaml
# skills/code-modifier/SKILL.yaml
allowedTools:
  - filesystem__read_file
  - filesystem__write_file
  - filesystem__list_directory
```

### 最終的な可視ツール

```
Role許可ツール ∩ Skill許可ツール = 見えるツール

例:
  Role許可: filesystem__*, mycelium-skills__*
  Skill許可: filesystem__read_file, filesystem__write_file
  ────────────────────────────────────────────────
  見えるツール: filesystem__read_file, filesystem__write_file
```

**重要**: 許可されていないツールはClaude Desktopに**表示されません**。名前すら見えない状態になります。

## 動的スキル管理

セッション中にスキルを切り替えることができます：

### 利用可能なMCPツール

| ツール名 | 説明 |
|---------|------|
| `mycelium-router__get_context` | 現在のロール・スキル状態を取得 |
| `mycelium-router__list_roles` | 利用可能なロール一覧 |
| `mycelium-router__list_skills` | 利用可能なスキル一覧 |
| `mycelium-router__set_active_skills` | アクティブスキルを設定 |
| `mycelium-router__get_active_skills` | 現在のアクティブスキルを取得 |

### 使用例（Claude Desktop内で）

```
ユーザー: "ファイルを編集したい"

Claude: [mycelium-router__set_active_skills を呼び出し]
        skills: ["common", "code-modifier"]

→ ツールリストが更新され、編集用ツールが利用可能に
```

## CLIからの起動

Claude Desktopを使わずにCLIからMCPサーバーを起動することもできます：

```bash
# フォアグラウンドで起動
myc server --role developer --verbose

# 別の設定ファイルを指定
myc server --config /path/to/config.json --role admin
```

## 設定例

### 開発者向け設定

```json
{
  "mcpServers": {
    "mycelium-dev": {
      "command": "node",
      "args": ["/path/to/mycelium/packages/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "/path/to/mycelium/config.json",
        "MYCELIUM_CURRENT_ROLE": "developer"
      }
    }
  }
}
```

### 管理者向け設定（全ツールアクセス）

```json
{
  "mcpServers": {
    "mycelium-admin": {
      "command": "node",
      "args": ["/path/to/mycelium/packages/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "/path/to/mycelium/config.json",
        "MYCELIUM_CURRENT_ROLE": "admin"
      }
    }
  }
}
```

## トラブルシューティング

### ツールが表示されない

1. `MYCELIUM_CURRENT_ROLE`が正しく設定されているか確認
2. そのロールにスキルが割り当てられているか確認
3. `myc server --verbose` で詳細ログを確認
4. `mycelium-router__get_context` ツールで現在の状態を確認

### 期待したツールが見えない

1. ロールの`allowedServers`にサーバーが含まれているか確認
2. アクティブスキルの`allowedTools`にツールが含まれているか確認
3. ログで "Tool filtered: skill_restricted" メッセージを確認

### 接続エラー

1. config.jsonのパスが正しいか確認
2. バックエンドMCPサーバー（filesystem、sandbox等）が正しく設定されているか確認
3. Node.jsのパスが正しいか確認

### ログの確認

```bash
# 詳細ログを有効にして起動
MYCELIUM_LOG_LEVEL=debug myc server --verbose

# Claude Desktopのログを確認
# macOS: ~/Library/Logs/Claude/
# Windows: %APPDATA%\Claude\logs\
```

## セキュリティ考慮事項

### Policy-in-the-loop

Myceliumは**Human-in-the-loop**ではなく**Policy-in-the-loop**を採用：

| 項目 | Human-in-the-loop | Policy-in-the-loop |
|------|-------------------|-------------------|
| ツール実行 | 毎回承認が必要 | ポリシーで自動判定 |
| 許可外ツール | 実行時にブロック | **そもそも見えない** |
| セキュリティ | 人間の判断に依存 | 設計で強制 |

### 最小権限の原則

- デフォルトは最小限のツール（commonスキルのみ）
- 必要に応じてスキルを追加
- タスク完了後にスキルを降格

### ツール隠蔽

許可外ツールは：
- リストに**表示されない**
- 名前を**推測できない**
- 呼び出しても**拒否される**（二重防御）

## 関連ドキュメント

- [Cursor/Cline統合](./cursor-integration.md)
- [スキル定義ガイド](./skill-definition-guide.md)
- [ロール設定ガイド](./role-configuration-guide.md)
