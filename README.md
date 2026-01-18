# Mycelium

**Skill-Driven RBAC for the Agentic AI Era**

> ロールを定義するな。スキルに宣言させろ。
>
> *Don't define roles. Let skills declare them.*

## パッケージ構成

```
mycelium/
├── packages/
│   ├── shared/     # @mycelium/shared - 共通型定義
│   ├── rbac/       # @mycelium/rbac - ロール管理・ツール可視性
│   ├── a2a/        # @mycelium/a2a - A2Aエージェント間認証
│   ├── audit/      # @mycelium/audit - 監査ログ・レート制限
│   ├── gateway/    # @mycelium/gateway - MCPゲートウェイ
│   ├── core/       # @mycelium/core - 統合レイヤー
│   └── skills/     # @mycelium/skills - スキルMCPサーバー
```

| パッケージ | 説明 |
|-----------|---------|
| `@mycelium/shared` | 共通型定義（Role, Skill, ToolPermissions等） |
| `@mycelium/rbac` | RoleManager, ToolVisibilityManager, RoleMemoryStore |
| `@mycelium/a2a` | A2A Agent Card スキルベースのアイデンティティ解決 |
| `@mycelium/audit` | 監査ログとレート制限 |
| `@mycelium/gateway` | MCPサーバー接続管理 |
| `@mycelium/core` | 全パッケージの統合・再エクスポート |
| `@mycelium/skills` | スキル定義を提供するMCPサーバー |

## スキル駆動RBAC：設計思想

### 従来のRBACの限界

従来のロールベースアクセス制御（RBAC）には重大な制約がありました：

- **静的な権限管理**: ロールは事前に定義され、変更が難しい
- **柔軟性の欠如**: ツールやリソースへのアクセス権は硬直的
- **粒度の低い制御**: 細かい権限設定が困難
- **スケーラビリティの問題**: 組織の成長に伴い、ロール管理が複雑化

### イノベーション：スキルが権限を宣言する

Myceliumのスキル駆動RBACは、この課題に革新的なアプローチで挑みます：

1. **権限の動的宣言**
   - スキルそのものが「誰が、何を、どのように」使えるかを定義
   - ロールは自動的かつ動的に生成される
   - 最小権限の原則を厳密に適用

2. **具体的な例**

```yaml
# スキル定義例: web-artifacts-builder
skill:
  permissions:
    - resource: file_system
      actions: [read, write]
      conditions:
        - in_directory: '/projects/web'
    - resource: github_api
      actions: [clone, push]
      roles: [developer, frontend]
```

このスキル定義により：
- `developer`と`frontend`ロールが自動生成
- `/projects/web`内のファイルシステムへのアクセス権
- GitHub APIの特定の操作が許可される

3. **セキュリティと柔軟性**
   - サーバーサイドでの厳密な権限チェック
   - コンテキストと時間に基づく動的な権限制御
   - Red Teamによる継続的な検証

### アーキテクチャの革新

- **サーバーサイド権限解決**: エージェントの自己宣言を信用しない
- **継続的な監査**: 全アクセスを詳細にログ記録
- **マルチエージェント対応**: 安全で柔軟な協調環境

## アーキテクチャの最新アップデート

### SDK専用実装 (v0.3.0)

- MCPClientを完全に削除
- Claude Agent SDKを直接利用
- サブエージェントのセッション管理を強化

### セッションの持続性

```bash
# デバッグモードでセッション詳細を表示
DEBUG=1 npm start
```

セッション機能:
- ロール単位でのセッション永続化
- 会話履歴の自動継続
- `/status` コマンドでセッション情報を表示

### ターミナルウィンドウの再利用

同じロールのサブエージェントは、既存のターミナルウィンドウを自動的に再利用します:

```
🍄 Mycelium: frontend    # カスタムウィンドウタイトル
• Ctrl+C で既存セッションを中断
• 新しいタスクを同じウィンドウで実行
```

## その他の主要な特徴

- **スキル駆動RBAC**: スキルが「誰に使わせるか」を宣言
- **動的ロール生成**: スキル追加だけでロールを自動生成
- **セキュアな権限管理**: サーバー側で厳密に権限をチェック

## デバッグと監視

```bash
# セッション詳細と拡張デバッグ情報
DEBUG=1 npm start
```

表示される情報:
- セッションID
- クエリ履歴
- 認証情報
- ツールアクセス状況

## インストールと起動

```bash
npm install
npm run build
npm start  # CLIモード
```

## ライセンス

MIT
