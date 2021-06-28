# 前端统一研发脚手架

## About

用于企业内部实现一站式前端研发脚手架

## Getting Started

### 安装：

```bash
npm install -g @wqas-cli/core
```

### 创建项目

项目/组件初始化

```bash
wqas-cli init 
```

强制清空当前文件夹

```bash
wqas-cli init --force
```

### 发布项目

发布项目/组件

```bash
wqas-cli publish
```

强制更新所有缓存

```bash
wqas-cli publish --force
```

正式发布

```bash
wqas-cli publish --prod
```

手动指定build命令

```bash
wqas-cli publish --buildCmd "npm run build:test"
```


## More

清空本地缓存：

```bash
wqas-cli clean
```

DEBUG 模式：

```bash
wqas-cli --debug
```

调试本地包：

```bash
wqas-cli init --packagePath /Users/sam/Desktop/wqas-cli/packages/init/
```
