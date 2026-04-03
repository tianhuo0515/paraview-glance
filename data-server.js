const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.DATA_PORT || 9998;

// 启用 CORS，允许 glance 访问
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

// 静态文件服务 - 指向 data 目录
const dataDir = path.join(__dirname, 'data');
app.use('/data', express.static(dataDir, {
  setHeaders: (res, path, stat) => {
    // 设置正确的 MIME 类型
    if (path.endsWith('.glance')) {
      res.setHeader('Content-Type', 'application/json');
    } else if (path.endsWith('.vtk')) {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    
    // 启用跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}));

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'data-server' });
});

// 列出所有可用文件
app.get('/data/', (req, res) => {
  const fs = require('fs');
  fs.readdir(dataDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read directory' });
    }
    
    // 过滤掉隐藏文件
    const visibleFiles = files.filter(f => !f.startsWith('.'));
    res.json({
      files: visibleFiles,
      count: visibleFiles.length,
      baseUrl: `http://localhost:${PORT}/data/`
    });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📦 Data server running at http://localhost:${PORT}`);
  console.log(`📁 Serving files from: ${dataDir}`);
  console.log(`🌐 Access files at: http://localhost:${PORT}/data/<filename>`);
  console.log(`ℹ️  List available files: http://localhost:${PORT}/data/`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});
