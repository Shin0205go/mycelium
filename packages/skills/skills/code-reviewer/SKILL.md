---
name: code-reviewer
displayName: Code Reviewer
description: コードレビューとベストプラクティスの提案を行うスキル
allowed-tools:
  - filesystem__read_file
  - filesystem__read_text_file
  - filesystem__read_multiple_files
  - filesystem__list_directory
  - filesystem__directory_tree
  - filesystem__search_files
  - filesystem__get_file_info
allowedRoles:
  - developer
  - senior-developer
  - admin
---

# Code Reviewer Skill

このスキルはコードレビューを自動化し、品質向上のための提案を行います。

## 機能

- プルリクエストのコードレビュー
- コーディング規約の準拠チェック
- セキュリティ脆弱性の検出
- パフォーマンス改善の提案
- ベストプラクティスの推奨

## レビュー観点

### セキュリティ
- SQL インジェクション
- XSS 攻撃
- 認証・認可の問題
- 機密情報のハードコーディング

### コード品質
- DRY原則の遵守
- 適切な命名規則
- 関数・メソッドの責務分離
- 適切なエラーハンドリング

### パフォーマンス
- N+1 クエリ問題
- メモリリーク
- 非効率なアルゴリズム

## 使用方法

1. レビュー対象のファイルまたはPRを指定
2. レビュー観点（セキュリティ、品質、パフォーマンス）を選択
3. レビュー結果と改善提案を確認
