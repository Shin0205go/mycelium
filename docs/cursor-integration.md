# Cursor / Windsurf / Cline との統合

MyceliumをCursor、Windsurf、ClineなどのMCP対応エディタと統合する方法。

## 概要

Myceliumは標準的なMCPプロトコルをサポートしているため、MCP対応の任意のエディタ/IDEと統合できます。

```
┌─────────────────────────────────────────────────────────────┐
│                  MCP対応エディタ                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │   Cursor    │ │  Windsurf   │ │    Cline    │            │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘            │
│         │               │               │                    │
│         └───────────────┴───────────────┘                    │
│                         │ stdio                              │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Mycelium MCP Server                     │    │
│  │  - ロールベースのツールフィルタリング              │    │
│  │  - スキルベースの動的ツール制御                    │    │
│  │  - 許可外ツールの完全隠蔽                          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Cursor

### 設定方法

1. Cursorの設定を開く（`Cmd+,` / `Ctrl+,`）
2. 「MCP」または「Model Context Protocol」セクションを探す
3. 以下の設定を追加

```json
{
  "mcp": {
    "servers": {
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
}
```

### 設定ファイルの場所

| OS | パス |
|----|------|
| macOS | `~/Library/Application Support/Cursor/User/settings.json` |
| Windows | `%APPDATA%\Cursor\User\settings.json` |
| Linux | `~/.config/Cursor/User/settings.json` |

または、`.cursor/mcp.json` をプロジェクトルートに配置：

```json
{
  "servers": {
    "mycelium": {
      "command": "node",
      "args": ["./packages/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "./config.json",
        "MYCELIUM_CURRENT_ROLE": "developer"
      }
    }
  }
}
```

## Windsurf

### 設定方法

Windsurfの設定ファイルでMCPサーバーを登録：

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

### 設定ファイルの場所

| OS | パス |
|----|------|
| macOS | `~/Library/Application Support/Windsurf/mcp_config.json` |
| Windows | `%APPDATA%\Windsurf\mcp_config.json` |

## Cline (VS Code拡張)

### 設定方法

1. VS Codeの拡張機能からClineをインストール
2. Clineの設定を開く
3. MCP Serversセクションで設定を追加

```json
{
  "cline.mcpServers": {
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

### プロジェクト固有の設定

`.vscode/mcp.json` を作成：

```json
{
  "servers": {
    "mycelium": {
      "command": "node",
      "args": ["${workspaceFolder}/packages/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "${workspaceFolder}/config.json",
        "MYCELIUM_CURRENT_ROLE": "developer"
      }
    }
  }
}
```

## 共通設定

### 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `MYCELIUM_CONFIG_PATH` | config.jsonのパス | `./config.json` |
| `MYCELIUM_CURRENT_ROLE` | 初期ロール | `default` |
| `MYCELIUM_CURRENT_SKILL` | 初期スキル（カンマ区切り） | - |

### ロール設定例

```json
// 開発用（ファイル編集、Git操作）
"MYCELIUM_CURRENT_ROLE": "developer"

// 読み取り専用（コードレビュー）
"MYCELIUM_CURRENT_ROLE": "reviewer"

// 管理者（全ツールアクセス）
"MYCELIUM_CURRENT_ROLE": "admin"
```

## スキルの動的制御

エディタからMyceliumのスキルを動的に制御できます：

### 利用可能なツール

| ツール名 | 説明 |
|---------|------|
| `mycelium-router__list_skills` | 利用可能なスキル一覧 |
| `mycelium-router__set_active_skills` | アクティブスキルを設定 |
| `mycelium-router__get_active_skills` | 現在のスキル状態を取得 |
| `mycelium-router__get_context` | 全体の状態を取得 |

### 使用例

エディタのAIアシスタントに対して：

```
"ファイル編集したいのでcode-modifierスキルを有効にして"

→ AIが mycelium-router__set_active_skills を呼び出し
→ ツールリストが更新
→ 編集用ツールが利用可能に
```

## プロジェクト固有設定のベストプラクティス

### 推奨ディレクトリ構造

```
project/
├── .cursor/
│   └── mcp.json          # Cursor用
├── .vscode/
│   └── mcp.json          # Cline用
├── config.json           # Mycelium設定
├── roles/
│   └── developer.yaml    # ロール定義
└── skills/
    ├── common/
    │   └── SKILL.yaml
    └── code-modifier/
        └── SKILL.yaml
```

### チーム共有設定

```json
// .cursor/mcp.json (リポジトリにコミット)
{
  "servers": {
    "mycelium": {
      "command": "node",
      "args": ["${workspaceFolder}/node_modules/@mycelium/core/dist/mcp-server.js"],
      "env": {
        "MYCELIUM_CONFIG_PATH": "${workspaceFolder}/config.json",
        "MYCELIUM_CURRENT_ROLE": "developer"
      }
    }
  }
}
```

## トラブルシューティング

### ツールが表示されない

1. MCPサーバーが正しく起動しているか確認
2. ロールの設定を確認
3. エディタのMCPログを確認

### 接続エラー

```bash
# 手動でサーバーを起動してテスト
node /path/to/mycelium/packages/core/dist/mcp-server.js

# または
myc server --role developer --verbose
```

### パスの問題

- **絶対パス**を使用することを推奨
- `~` は展開されないことがあるため、フルパスを使用
- Windows: バックスラッシュを `/` またはエスケープ `\\` に

### ログの確認

```bash
# Myceliumの詳細ログ
MYCELIUM_LOG_LEVEL=debug node /path/to/mcp-server.js

# 各エディタのログ
# Cursor: Help > Toggle Developer Tools > Console
# VS Code + Cline: Output パネル > MCP
```

## セキュリティ考慮事項

### プロジェクト固有設定の注意点

- `config.json` に機密情報を含めない
- `.gitignore` に環境固有のファイルを追加
- APIキーは環境変数で管理

```bash
# .gitignore
.cursor/mcp.local.json
.vscode/mcp.local.json
config.local.json
```

### 最小権限の原則

開発時のロール設定：

```json
// コードレビュー時
"MYCELIUM_CURRENT_ROLE": "reviewer"  // 読み取り専用

// 通常開発時
"MYCELIUM_CURRENT_ROLE": "developer"  // 編集可能

// 緊急対応時のみ
"MYCELIUM_CURRENT_ROLE": "admin"  // 全権限
```

## 関連ドキュメント

- [Claude Desktop統合](./claude-desktop-integration.md)
- [スキル定義ガイド](./skill-definition-guide.md)
- [ロール設定ガイド](./role-configuration-guide.md)
