---
name: browser-testing
displayName: Browser Testing
description: ブラウザ自動化とE2Eテストを行うスキル
allowed-tools:
  - playwright__browser_navigate
  - playwright__browser_navigate_back
  - playwright__browser_click
  - playwright__browser_fill_form
  - playwright__browser_type
  - playwright__browser_press_key
  - playwright__browser_select_option
  - playwright__browser_hover
  - playwright__browser_drag
  - playwright__browser_take_screenshot
  - playwright__browser_snapshot
  - playwright__browser_evaluate
  - playwright__browser_run_code
  - playwright__browser_wait_for
  - playwright__browser_tabs
  - playwright__browser_close
  - playwright__browser_resize
  - playwright__browser_console_messages
  - playwright__browser_network_requests
  - playwright__browser_handle_dialog
  - playwright__browser_file_upload
  - playwright__browser_install
allowedRoles:
  - developer
  - senior-developer
  - admin
  - tester
---

# Browser Testing Skill

このスキルはPlaywrightを使用したブラウザ自動化とE2Eテストを支援します。

## 機能

- Webページのナビゲーション
- 要素のクリック・入力
- フォームの自動入力
- スクリーンショット撮影
- コンソールログ・ネットワークリクエストの監視
- ダイアログ処理
- ファイルアップロード

## 使用方法

### 基本的なナビゲーション
1. `browser_navigate` でURLに移動
2. `browser_click` で要素をクリック
3. `browser_type` でテキスト入力

### スクリーンショット
- `browser_take_screenshot` でページ全体または要素のスクリーンショットを撮影
- `browser_snapshot` でアクセシビリティスナップショットを取得

### デバッグ
- `browser_console_messages` でコンソールログを確認
- `browser_network_requests` でネットワークリクエストを監視

## 注意事項

- ブラウザは自動的にインストールされます（初回実行時）
- ヘッドレスモードで実行されます
- セッションは明示的に閉じるまで維持されます
