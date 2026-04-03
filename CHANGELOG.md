# 更新日志

## v0.1.0 - 2026-04-04

基于 [ParaView Glance](https://github.com/Kitware/paraview-glance) 二次开发，主要修改如下：

### 界面与交互优化

- **颜色控制中文化**：将颜色模式中的"单一颜色"更名为"原始模型"，更准确地表达其含义（即不加任何标量着色，显示模型原始颜色）
  - `src/locales/zh.json` - 中文标签修改
  - `src/components/controls/ColorBy/script.js` - 下拉选项名称同步修改
  - `src/components/core/VtkView/script.js` - 注释更新

### 便捷启动

- 新增 `start.bat` 脚本，Windows 环境下一键启动开发服务器（`npm run dev`）
