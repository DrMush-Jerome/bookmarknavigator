# 书签导航台

让浏览器的新标签页成为你的书签工作台：找网站、整理分类、记录待办，打开就能用。

**bookmarknavigator** · DrMush 开发 · v1.13.2 · [MIT License](LICENSE)

![书签导航台首页示意，书签和内容均为虚构示例](docs/assets/overview.svg)

## 下载与安装

点击下表中的文件名，即可下载对应安装包。也可以[打开 v1.13.2 下载页面](https://github.com/MrMush-BUCM/bookmarknavigator/releases/tag/v1.13.2)，查看全部文件。

| 你使用的浏览器 | 点击下载安装包 | 安装教程 |
| --- | --- | --- |
| Chrome 116+ | [bookmarknavigator-v1.13.2-chrome.zip](https://github.com/MrMush-BUCM/bookmarknavigator/releases/download/v1.13.2/bookmarknavigator-v1.13.2-chrome.zip) | [Chrome / Edge 安装](docs/install.md#chrome--edge) |
| Edge 116+ | [bookmarknavigator-v1.13.2-edge.zip](https://github.com/MrMush-BUCM/bookmarknavigator/releases/download/v1.13.2/bookmarknavigator-v1.13.2-edge.zip) | [Chrome / Edge 安装](docs/install.md#chrome--edge) |
| Firefox 109+ | [bookmarknavigator-v1.13.2-firefox.zip](https://github.com/MrMush-BUCM/bookmarknavigator/releases/download/v1.13.2/bookmarknavigator-v1.13.2-firefox.zip) | [Firefox 安装](docs/install.md#firefox) |
| Safari 16+，macOS 12+ | [bookmarknavigator-v1.13.2-macos-local.dmg](https://github.com/MrMush-BUCM/bookmarknavigator/releases/download/v1.13.2/bookmarknavigator-v1.13.2-macos-local.dmg) | [Safari 安装](docs/install.md#safari) |

Chrome 和 Edge 下载后解压，再把解压出来的文件夹加载到浏览器。Safari 安装 App 后启用扩展。普通用户不需要编译，也不需要安装 Node.js 或 Xcode。

Firefox 当前为临时安装，重启后需要重新加载。Safari 当前为未公证的免费测试包，完全退出 Safari 后需要重新开启“允许未签名的扩展”。具体操作都在[安装教程](docs/install.md)中。

Safari 也可下载 [App ZIP](https://github.com/MrMush-BUCM/bookmarknavigator/releases/download/v1.13.2/bookmarknavigator-v1.13.2-macos-local.zip)，作为 DMG 的备用格式；`safari-web-extension.zip` 和 GitHub 自动生成的 **Source code** 供维护者使用。

## 主要功能

- **搜索书签**：按名称或网址查找，支持 `Ctrl + K` / `⌘ + K` 快捷键。
- **整理分类**：按现有书签文件夹浏览，或使用内置网站分类。
- **调整首页**：选择要显示的分类和模块，拖动调整顺序。
- **记录待办**：选择日期、时间点或时间区间，为事项标记颜色。
- **查看天气**：选择城市，查看天气与预报。
- **自定义图标**：使用内置图标，或上传、获取网站图标。

操作方法和配图见[使用指南](docs/usage.md)。

## 书签和数据

Chrome、Edge、Firefox 直接读取当前浏览器的书签，编辑、移动和真实删除会修改浏览器原书签。

Safari 默认使用导入的本地副本，整理它不会修改 Safari 原书签。需要自动读取和删除 Safari 原书签时，可另外开启[实验同步](docs/safari-sync.md)；每次导出可能要求系统密码验证，目前不能保证无人值守。

布局、待办、图标、隐藏项和回收站保存在扩展本地。本项目无需账号，没有自建的数据上传服务。天气使用 Open-Meteo；主动获取网站图标会访问所选网站。[数据与权限说明](docs/usage.md#数据与权限)

更新或批量整理前，请先导出书签备份。回收站保留导航台删除的单个书签 30 天，不能代替完整备份。

## 文档

按需要阅读，无需从头看完所有页面：

| 我想做什么 | 阅读哪一页 |
| --- | --- |
| 安装、升级或解决安装问题 | [安装教程](docs/install.md) |
| 搜索、分类、拖动布局、添加待办 | [使用指南](docs/usage.md) |

点击下载 [bookmarknavigator-v1.13.2-readme.html](https://github.com/MrMush-BUCM/bookmarknavigator/releases/download/v1.13.2/bookmarknavigator-v1.13.2-readme.html)，双击即可阅读完整图文指南。安装教程、使用指南、Safari 同步说明、配图和许可全文均已内嵌，阅读时无需联网，也无需下载其他文件。源码中的 **README.html** 是同一份单文件文档。GitHub 主页展示的是这份 README.md。

## 反馈与许可

作者：**DrMush**。反馈邮箱：[bookmarknavigator@163.com](mailto:bookmarknavigator@163.com)。请说明系统、浏览器、扩展版本和遇到问题的操作步骤，截图中请遮盖私密信息。

项目自有代码采用 [MIT License](LICENSE)，允许商业使用及用于闭源产品。字体、图片和外部数据服务分别适用其许可或权利人条款，详见[第三方资源版权与许可](THIRD_PARTY_NOTICES.md)。文档配图为操作示意，使用虚构内容。
