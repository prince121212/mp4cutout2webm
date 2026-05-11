# mp4cutout2webm

本地浏览器绿幕转透明 WebM 工具。  
上传 MP4 后，先在网页里调参数预览，再把同一组参数应用到整段视频，导出带 alpha 的 VP9 WebM。

## 功能

- 本地处理，不上传服务器
- 中文 / 英文界面切换
- 三帧预览：第一帧 / 中间帧 / 最后一帧
- 预览背景切换：棋盘格 / 彩条 / 黑底 / 白底
- 抠像参数微调：`similarity`、`blend`、`despill`
- 左右 `- / +` 微调按钮，避免滑轨误触
- 导出透明 VP9 WebM

## 运行要求

- Node.js
- `ffmpeg` 和 `ffprobe` 可在 `PATH` 中直接调用

## 启动

```bash
npm install
npm start
```

默认打开：

```text
http://localhost:3000
```

如果 3000 被占用，可以设置别的端口：

```bash
PORT=3001 npm start
```

## 使用流程

1. 选择一个绿幕视频。
2. 在三帧预览之间切换，确认参数在整段视频里都稳定。
3. 调整抠像颜色、抠像强度、边缘柔和、去绿边参数。
4. 切换预览背景检查边缘和残留。
5. 点击导出，生成透明背景 WebM。

## 技术结构

- 前端：原生 HTML / CSS / JavaScript
- 后端：Node.js + Express
- 视频处理：系统 `ffmpeg`

## 目录

```text
public/   # 前端页面、样式、交互
server.js # 本地服务与 ffmpeg 调用
uploads/  # 上传的视频临时文件
temp/     # 抽帧和预览图
outputs/  # 最终导出的 webm
```

## 说明

- 这是纯本地工具，浏览器只负责界面。
- 预览通过抽帧完成，导出时把同样的参数套到整段视频。
- 如果你想更稳，可以先看第一帧、中间帧、最后一帧，再决定是否导出。
