# 第三方素材与来源

## 行为模型与台词（`pet/src/main/motion.ts`）

- 来源仓库：<https://github.com/1190fasheqi/dafeiyu-pet>（`桌宠.py`，MIT）
- 移植内容：行走/休息/惯性/朝向判定/闲置小动作的**参数取值**，以及 `LINES` / `INNER_LINES` 台词表
  （社区梗，原样保留）。本实现把 Qt 的绘制形变改写成 CSS 动画，逻辑帧与参数保持一致。

## 鲸鱼娘（大肥鱼）三视图精灵

- 来源仓库：<https://github.com/1190fasheqi/dafeiyu-pet>
- 原许可：MIT（仓库 LICENSE，Copyright (c) 2026）
- 取用文件（已重命名，未改动像素内容）：

  | 本项目文件 | 上游文件 |
  | --- | --- |
  | `pet/src/renderer/public/sprites/whale-front.png` | `sprites/正面.png` |
  | `pet/src/renderer/public/sprites/whale-side.png` | `sprites/侧面.png` |
  | `pet/src/renderer/public/sprites/whale-back.png` | `sprites/背面.png` |
  | `pet/src/renderer/public/sprites/whale-icon.png` | `sprites/icon.png` |

- 上游对素材的处理说明（摘自其 `preprocess2.py` 注释）：白底抠图 → 边缘去污（按 alpha 反算真实颜色）
  → 预乘 alpha 缩放出各尺寸精灵。本项目直接使用 340px 高的精灵，由 CSS 缩放到窗口大小。

## 形象版权声明

「鲸鱼娘 / 大肥鱼」是基于 DeepSeek 官方形象的**社区二次创作**角色。上游仓库与本文档的 MIT 许可
只覆盖其**代码与素材文件**，不构成对角色形象本身的商用授权。请把本项目当作个人桌面玩具使用，
**不要商用**；二次分发时保留本文件与上游链接。

## 音效

`pet/src/renderer/public/sounds/*.wav` 为本项目作者自制/自备的提示音，随本项目以 MIT 发布。

## 备用角色

`Cat.tsx` / `Ghost.tsx` / `Slime.tsx` 是纯 SVG 手绘的原创角色（无第三方素材），同样是 MIT。
