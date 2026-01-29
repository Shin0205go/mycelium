# Claude Desktop との統合

MyceliumをClaude DesktopのMCPサーバーとして使用する方法。

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
| `MYCELIUM_CURRENT_SKILL` | 初期スキル | - |

## ロール別のツール可視性

Myceliumはロールに基づいてツールをフィルタリングします：

```
developer ロール:
  - filesystem__read_file
  - filesystem__write_file
  - git__status, git__commit
  - mycelium-sandbox__bash

designer ロール:
  - filesystem__read_file
  - canvas__create
  - design__generate

admin ロール:
  - 全ツール
```

**重要**: 許可されていないツールはClaude Desktopに**表示されません**。名前すら見えない状態になります。

## CLIからの起動

Claude Desktopを使わずにCLIからMCPサーバーを起動することもできます：

```bash
# フォアグラウンドで起動
myc server --role developer --verbose

# 別の設定ファイルを指定
myc server --config /path/to/config.json --role admin
```

## トラブルシューティング

### ツールが表示されない

1. `MYCELIUM_CURRENT_ROLE`が正しく設定されているか確認
2. そのロールにスキルが割り当てられているか確認
3. `myc server --verbose` で詳細ログを確認

### 接続エラー

1. config.jsonのパスが正しいか確認
2. バックエンドMCPサーバー（filesystem、sandbox等）が正しく設定されているか確認

### ログの確認

```bash
# 詳細ログを有効にして起動
MYCELIUM_LOG_LEVEL=debug myc server --verbose
```

## Cursorとの統合

Cursorも同様の設定で利用可能です。Cursorの設定ファイルでMCPサーバーを登録してください。

## セキュリティ考慮事項

- **最小権限の原則**: 必要なロールのみを使用
- **ツール隠蔽**: 許可外ツールは完全に非表示
- **監査**: ツール呼び出しはログに記録可能
