# LAVA - 更新日志

基于 [Kitware ParaView Glance](https://github.com/Kitware/paraview-glance) 深度定制的工程仿真数据可视化平台。

---

## v0.1.0 (2026-04-04)

### 项目更名

- 项目由 **ParaView Glance** 更名为 **LAVA**
  - `static/index.html` - 页面标题改为 `LAVA`，描述改为 `Data Viewer in a browser`
  - `src/locales/zh.json` - 应用标题及欢迎页文案

### 全面中文化 (vue-i18n)

新增完整的国际化系统，默认语言为中文，支持中英文切换。

| 文件 | 说明 |
|------|------|
| `src/i18n.js` | 新增 vue-i18n 配置，默认语言 `zh` |
| `src/locales/zh.json` | 新增完整中文翻译（235 行），覆盖全部 UI 文本 |
| `src/locales/en.json` | 英文翻译同步扩展，新增语言切换/通知等条目 |
| `src/components/core/GlobalSettings/script.js` | 交互样式中文：`'3D'`→`'默认'`，`'FirstPerson'`→`'第一人称'` |
| `src/components/core/GlobalSettings/template.html` | 全部文本标签改为 `$t()` 国际化调用 |
| `src/components/core/Landing/template.html` | 全部文本标签改为 `$t()` 国际化调用 |

### UI 精简

- **跳过登录页**：应用启动后直接进入可视化界面，不再显示 Landing 页面
  - `src/components/core/App/script.js` - `created()` 中直接调用 `this.showApp()`
- **隐藏 Glance Logo**：Logo 链接添加 `style="display: none;"`
  - `src/components/core/App/template.html`
- **隐藏"关于"按钮和对话框**：按钮和对话框组件均被注释掉
  - `src/components/core/App/template.html`
- **隐藏"错误"按钮和对话框**：错误监听和错误对话框均被注释掉
  - `src/components/core/App/script.js` - 禁用 `window.addEventListener('error', ...)` 和 vtkErrorMacro
- **移除"工具"和"全局设置"选项卡**：控制面板只保留"数据集"一个选项卡
  - `src/components/core/ControlsDrawer/template.html`

### 控件面板中文化

| 原名 | 中文名 | 文件 |
|------|--------|------|
| Representation | 显示模式 | `src/components/controls/index.js` |
| ColorBy | 云图 | `src/components/controls/index.js` |
| Clipping | 剖切 | `src/components/controls/index.js` |
| Slice | 截面 | `src/components/controls/index.js` |
| Information | 属性 | `src/components/controls/index.js` |
| Solid color | 原始模型 | `src/locales/zh.json`、`src/components/controls/ColorBy/script.js` |

### FEA/CAE 工程仿真可视化增强

- **自动云图着色**：加载 VTK 模型后自动检测标量数据并应用 Rainbow 色图
  - `src/io/ReaderFactory.js` - 新增 `autoApplyColorBy()` 函数（第 202-259 行）
- **9 分量全张量支持**：对称张量的 Voigt 表示（XX, YY, ZZ, XY, YZ, XZ）
  - `src/components/core/VtkView/script.js` - 新增 `getComponentLabel()` 函数（第 18-30 行）
  - `src/components/controls/ColorBy/script.js` - 新增 `getComponentOptions()` 对 9 分量数据的处理（第 45-51 行）
- **Scalar Bar 增强**：智能显示分量标签（幅值/XX/YY 等），NaN 范围保护
  - `src/components/core/VtkView/script.js` - `updateScalarBar()` 增强（第 450-519 行）
- **云图面板功能扩展**：
  - 新增"单元间平滑过渡"复选框（`interpolateScalarBeforeMapping`）
  - 新增"将云图应用到截面"复选框（`applyColorToSlices`）
  - 新增"将透明度应用到截面"复选框（`applyOpacityToSlices`）
  - 新增"偏移"滑块（体积渲染透明度偏移控制）
  - `src/components/controls/ColorBy/template.html`、`src/components/controls/ColorBy/script.js`
- **信息面板中文化**：
  - `src/components/controls/Information/FieldData/template.html` - `Type:`→`类型：`、`Min:`→`最小值：`、`Max:`→`最大值：`、`Components:`→`分量数：`
- **剖切面板中文化**：
  - `src/components/controls/Clipping/template.html` - 轴标签改为 `X 轴剖切`，法线反转按钮 title 改为 `反转法线`

### URL 文件名自动提取

支持 URL 参数中只有 `url` 没有 `name` 时，自动从 URL 提取文件名，支持中文文件名的 `decodeURIComponent` 解码。

- `src/app.js` - `processURLArgs()` 增强（第 145-166 行）

### ITK 医学图像处理集成

- **ITK 中值滤波器**：C++ 源码 + WASM 编译产物，可在浏览器中对 3D 图像运行中值滤波
  - `itk/itk_filtering.cxx` - C++ 中值滤波器源码
  - `itk/web-build/itkfiltering.js` / `itkfilteringWasm.js` / `itkfilteringWasm.wasm` - WASM 编译产物
- **构建系统集成**：webpack 自动将 ITK 管线复制到 dist
  - `build/webpack.base.config.js` - 新增 ITK 复制规则（第 124-131 行）

### DICOM 医学影像支持

- **DICOM 系列读取器**：基于 itk.js 的 `readImageDICOMFileSeries` 实现
  - `externals/ITKReader/ITKDicomImageReader.js` - DICOM 系列读取器（新增）
  - `externals/ITKReader/index.js` - 注册 DICOM 扩展名 `.dcm`
- **DICOM 文件自动识别**：`.dcm` 文件自动归入 DICOM 加载路径
  - `src/store/fileLoader.js` - `openFiles()` 中自动分类 DICOM 文件（第 265-271 行）
- **状态文件系列 URL 还原**：支持 `.glance` 状态文件中 DICOM 系列的序列化/反序列化
  - `src/store/index.js` - 新增 `extractFilenameFromUrl()` 和 `seriesUrls` 处理（第 31-33 行，第 256-267 行）

### 数据服务

- **Express 静态文件服务器**：提供本地 `data/` 目录下的数据文件，支持 CORS 跨域
  - `data-server.js` - 新增（端口 9998）
- **工程仿真样本数据**：新增 6 个 FEA 仿真 VTK 数据文件
  - `data/job_1_Case_2_1.vtk`、`data/job_1_Case_2_80.vtk`、`data/job_1_Case_3_163.vtk`
  - `data/job_1_Case_3_17.vtk`、`data/job_1_Linear-Static_1.vtk`、`data/PART-1-1.vtk`

### PWA 离线缓存

- **Workbox Service Worker**：实现离线缓存能力
  - `externals/Workbox/index.js` - 新增 PWA Service Worker 注册脚本
  - `build/webpack.base.config.js` - Workbox 集成（第 136-149 行）

### 便捷启动

- **Windows 一键启动**：双击 `start.bat` 即可启动开发服务器
  - `start.bat` - 新增

### 依赖变更

新增依赖：`vue-i18n`、`@linusborg/vue-simple-portal`、`axios`、`cors`、`express`、`patch-package`、`portal-vue`、`webworker-promise`、`workbox-sw`

### 构建调整

- Node.js 17+ OpenSSL 兼容性修复：build 脚本添加 `set NODE_OPTIONS=--openssl-legacy-provider`
- 开发服务器端口改为 `8013`，允许所有来源的主机
- `build/webpack.dev.config.js`
- `build/webpack.prod.config.js` - 新增 `CopyPlugin` 复制 `static/redirect-app.html`

### 样本数据精简

注释掉部分大型样本数据以减小项目体积：`Head.mha`（6.2 MB）、`Backpack.vti`（8.3 MB）、`Head MRI CISS`（5.1 MB）、`Foot`（4.3 MB）

- `src/samples/index.js`
