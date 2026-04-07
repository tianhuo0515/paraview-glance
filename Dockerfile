# 使用 Node.js 作为基础镜像
FROM node:16-alpine

# 设置工作目录
WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制源代码
COPY . .

# 构建应用
RUN npm run build:release

# 使用 nginx 提供静态文件服务
FROM nginx:alpine

# 复制构建产物到 nginx
COPY --from=0 /app/dist /usr/share/nginx/html

# 复制 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 暴露 9999 端口
EXPOSE 8013

# 启动 nginx
CMD ["nginx", "-g", "daemon off;"]
