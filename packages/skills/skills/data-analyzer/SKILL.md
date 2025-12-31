---
name: data-analyzer
displayName: Data Analyzer
description: データ分析と可視化を行うスキル
allowed-tools:
  - filesystem__read_file
  - filesystem__read_text_file
  - filesystem__read_multiple_files
  - filesystem__write_file
  - filesystem__edit_file
  - filesystem__list_directory
  - filesystem__directory_tree
  - filesystem__search_files
  - filesystem__get_file_info
  - filesystem__create_directory
allowedRoles:
  - analyst
  - data-scientist
  - admin
  - "*"
---

# Data Analyzer Skill

このスキルはデータ分析と可視化を支援します。

## 機能

- CSV/JSON データの読み込みと解析
- 統計分析（平均、中央値、標準偏差など）
- データの可視化（グラフ生成）
- データクレンジングと前処理

## 対応データ形式

- CSV（カンマ区切り）
- TSV（タブ区切り）
- JSON
- Excel（.xlsx）
- Parquet

## 分析機能

### 基本統計
- 記述統計量の算出
- 相関分析
- 分布分析

### データ前処理
- 欠損値の処理
- 外れ値の検出
- データ型の変換
- 正規化・標準化

### 可視化
- 棒グラフ
- 折れ線グラフ
- 散布図
- ヒストグラム
- ヒートマップ

## 使用方法

1. 分析対象のデータソースを指定
2. 分析タイプを選択（基本統計、相関分析など）
3. 結果の出力形式を指定（テーブル、グラフなど）

## 注意事項

- `allowedRoles: ["*"]` により、全ロールがこのスキルを使用可能です
- 大規模データセット（100万行以上）は分割処理を推奨します
