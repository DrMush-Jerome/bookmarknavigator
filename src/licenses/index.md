# 第三方资源版权与许可

本文件说明书签导航台 v1.13.2 随包资源及外部数据服务的来源、版权归属和适用条件。项目自有代码采用 [MIT License](project-MIT.txt)，版权声明为 **Copyright (c) 2026 DrMush <bookmarknavigator@163.com>**。第三方资源分别适用下述许可或权利人条款。

## 字体

字体内嵌于 `fonts.css`，以 WOFF2 数据在本机加载，不向字体服务发起请求。包内版本号来自字体自身的名称元数据；字重是 CSS 使用声明。

| 字体 | 包内版本与字重 | 版权声明 | 许可全文 |
| --- | --- | --- | --- |
| Outfit | 1.100；400、500、600、700 | Copyright 2021 The Outfit Project Authors | [SIL Open Font License 1.1](OFL-Outfit.txt) |
| JetBrains Mono | 2.211；400、500 | Copyright 2020 The JetBrains Mono Project Authors | [SIL Open Font License 1.1](OFL-JetBrains-Mono.txt) |

上游项目：[Outfit](https://github.com/Outfitio/Outfit-Fonts)、[JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)。包内为拉丁字符子集，以 data URL 内嵌到 CSS。各字重声明复用相应字体数据。

OFL 允许字体随软件打包、嵌入和分发，包括商业软件；须保留原版权声明和 OFL 全文。字体本身仍适用 OFL，不能改成 MIT，也不能单独售卖。修改与重新分发还须遵守许可中的字体命名和其他条件。

## 天气图标

`weather-icons.js` 内嵌 18 张天气 PNG 图片，来自 Apple Support 的[天气图标说明](https://support.apple.com/guide/iphone/learn-the-weather-icons-iph4305794fb/ios)，版权属于 Apple Inc. 及其许可方。

这些图片保留原权利，适用 Apple 的[版权与商标指南](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html)及[网站内容使用条款](https://www.apple.com/legal/internet-services/terms/site.html)。本项目的 MIT 许可不授予这些图片的使用或再分发授权，也不表示 Apple 对本项目的认可。

包内名称、像素尺寸和 SHA-256 指纹见[天气图标清单](weather-icons.html)。图标以 data URL 内嵌，日常显示不请求 Apple 网站。

## 网站品牌图标

`logos/` 包含 201 个网站图标，用于在书签中识别对应网站。各图标的版权、商标及其他权利归对应权利人所有。本项目不对这些标识授予额外许可，也不表示与对应品牌存在合作或背书关系。

完整的图标名称、包内文件、对应域名、来源页面、原始资源地址及 SHA-256 指纹见[网站图标来源清单](brand-icons.html)。原始来源记录同时保留在 `bundled-logos-data.json`；汇总的可机读记录见[资源清单 JSON](resources.json)。

来源链接用于记录出处，不能替代权利人的授权。使用或再分发品牌标识时，须核对对应网站的版权、商标及品牌使用规则，不能把项目自有代码的 MIT 许可套用到标识图片。

用户上传或主动获取的网站图标保存在其本地扩展存储中，不随项目发布。相关权利仍归原权利人；浏览器授予访问网站的权限不等于授予图片的版权或商标许可。

## 天气与城市数据

天气和城市查询通过 HTTP 调用 Open-Meteo 服务，项目没有复制、打包或修改其服务端代码。

- **天气与 API 数据**：由 [Open-Meteo](https://open-meteo.com/) 提供，适用 [Creative Commons Attribution 4.0 International（CC BY 4.0）](CC-BY-4.0.txt)。[官方许可说明](https://open-meteo.com/en/licence)要求在数据显示处提供署名和链接。导航台将数据整理为温度、天气描述、逐小时和逐日预报，包含温度取整及展示顺序调整。
- **城市数据**：Open-Meteo 的[地理编码接口](https://open-meteo.com/en/docs/geocoding-api)基于 [GeoNames](https://www.geonames.org/)。GeoNames 数据适用 CC BY 4.0；导航台对候选地名做排序和去重。见 [GeoNames 来源与许可](https://www.geonames.org/about.html)。

数据许可与 API 服务使用条件分别适用。当前使用 Open-Meteo 的免费接口，该接口仅供非商业用途并有限额；商业产品、订阅或广告场景须按其[服务条款](https://open-meteo.com/en/terms)另行安排合适的服务方案。项目代码采用 MIT，不能据此取得免费接口的商业使用权限。

## 系统组件与项目资源

Safari 宿主使用 macOS 提供的 Foundation、Cocoa、SafariServices、ApplicationServices、Carbon 及系统 libz；浏览器版本使用 WebExtension 和 Web API。项目调用这些系统组件，不把它们的源代码、SDK 或系统动态库作为第三方库复制进发布包。它们适用相应平台条款，项目 MIT 许可不改变平台权利。

PingFang SC、Microsoft YaHei 和系统等宽字体仅作为本机字体回退使用，字体文件不随包分发。界面的基础几何图形、项目图标和文档中的操作示意由本项目绘制，适用项目 MIT 许可；示意内容为虚构示例。项目没有随包打入第三方 npm 或 JavaScript 框架。

## 随包文件与再分发

各浏览器资源包的 `licenses/` 目录，以及 Safari App、安装镜像中的随附资料，保留本说明、字体 OFL 全文、CC BY 4.0 全文和资源来源清单。扩展中可从“设置 > 关于导航台 > 开源条款”打开这份离线说明。

再分发时，应保留项目 MIT 文本、第三方资源说明和各许可全文。此清单记录随包资源及其授权范围，不替任何第三方权利人作额外授权。
