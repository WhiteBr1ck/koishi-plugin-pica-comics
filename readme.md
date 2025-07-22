# koishi-plugin-pica-comics

[![npm](https://img.shields.io/npm/v/koishi-plugin-pica-comics?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-pica-comics)

一个为 [Koishi](https://koishi.chat/) 设计的 Pica 漫画搜索与下载插件。

## ✨ 功能特性

- **漫画搜索**：通过关键词搜索 Pica 上的漫画资源。
- **漫画下载**：支持下载指定漫画的特定章节或全部章节。
- **多种输出格式**：
  - **图片**：将漫画页面作为图片发送，支持单张发送和合并转发。
  - **PDF**：将漫画章节或整本合成为一个 PDF 文件发送。
- **高度可配置**：
  - 支持设置 PDF 密码、图片压缩质量。
  - 消息发送方式（合并转发/逐条发送）可独立配置。

## 📥 安装

在 Koishi 插件市场搜索 `pica-comics` 并安装即可。插件所需的所有依赖项将会被自动安装。

## 🚀 使用方法

### 指令列表

- **`picasearch <关键词>`**: 搜索漫画。
- **`picaid <漫画ID> [章节序号|full] [-o, --output <image|pdf>]`**: 下载漫画。

### 指令详解

#### **`picasearch <关键词>`**

根据关键词搜索漫画，并返回前 10 个结果。

- **示例**：`picasearch mygo`

#### **`picaid <漫画ID> [章节序号|full] [-o, --output <image|pdf>]`**

下载指定的漫画。

- **`comicId`** (必需): 漫画的唯一 ID，可以从 `picasearch` 的结果中获取。
- **`chapter`** (可选):
  - **数字**: 下载指定的章节序号（例如 `1` 代表第一话）。如果留空，默认下载第一话。
  - **`full`**: 下载该漫画的全部章节并合并（仅在 PDF 输出模式下建议使用）。
- **`-o, --output <image|pdf>`** (可选):
  - 指定输出格式。`image` 为图片，`pdf` 为 PDF 文件。
  - 如果不指定，则使用插件配置中的默认输出方式。

- **示例**:
  - `picaid a1b2c3d4e5f6a1b2c3d4e5f6` (下载指定ID漫画的第一话)
  - `picaid a1b2c3d4e5f6a1b2c3d4e5f6 3` (下载第三话)
  - `picaid a1b2c3d4e5f6a1b2c3d4e5f6 3 -o pdf` (将第三话下载为 PDF)
  - `picaid a1b2c3d4e5f6a1b2c3d4e5f6 full -o pdf` (将整本漫画下载为 PDF)

## ⚙️ 配置项

你可以在 Koishi 的插件配置页面中进行详细的设置。

### 账号设置

- **username**: Pica 登录用户名（注意：不是昵称）。
- **password**: Pica 登录密码。

### 消息发送设置

- **useForwardForSearch**: 是否默认使用合并转发的形式发送【搜索结果】。（默认开启）
- **useForwardForImages**: 当以图片形式发送漫画时，是否默认使用【合并转发】。（默认开启）
- **showImageInSearch**: 是否在【搜索结果】中显示封面图片。注意：在合并转发模式下，开启此项可能会因消息过长导致发送失败。（默认开启）

### PDF 输出设置

- **downloadPath**: PDF 文件和临时文件的保存目录。（默认: `./data/downloads/pica`）
- **defaultToPdf**: 是否默认将漫画下载为 PDF 文件。（默认开启）
- **pdfPassword**: 为生成的 PDF 文件设置一个打开密码。留空则不加密。
- **enableCompression**: 是否启用图片压缩以减小 PDF 文件体积。（默认开启）
- **compressionQuality**: JPEG 图片质量 (1-100)。（默认: 80）
- **pdfSendMethod**: PDF 发送方式。如果 Koishi 与机器人客户端不在同一台设备或 Docker 环境中，必须选择“Buffer”。（默认: `buffer`）

### 调试设置

- **debug**: 是否在控制台输出详细的调试日志。（默认关闭）

### 高级设置

- **apiHost**, **apiKey**, **hmacKey**: API 相关设置，除非你知道你在做什么，否则不要修改。

## 🙏 鸣谢

本插件的开发过程中，参考了以下优秀项目的实现，特此感谢：

-   [venera-app/venera](https://github.com/venera-app/venera): 本插件的 API 请求签名等相关逻辑，主要参考了此项目的实现。
-   [wahaha216/koishi-plugin-jmcomic](https://github.com/wahaha216/koishi-plugin-jmcomic): 本插件的 PDF 处理流程，受到了此项目优雅实现的启发。
-   以及在此插件的开发和调试过程中提供诸多帮助的 **Gemini 2.5 Pro**。

## 📜 免责声明

-   本插件仅供学习和技术研究使用，开发者不对其内容的合法性、准确性、完整性、有效性、及时性或适用性作任何保证。
-   用户通过本插件获取的所有内容，其版权归原作者和发行商所有。
-   用户应对使用本插件的行为负全部责任。任何由于使用本插件而导致的任何损失，开发者概不负责。
-   本插件与 Pica 官方没有任何关联。

## 📝 License

本项目使用 [MIT](LICENSE) 许可证。

© 2025, WhiteBr1ck.