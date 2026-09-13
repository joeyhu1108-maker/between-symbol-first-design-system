# 正式网页入口 Worker

这里保存 2026-09-13 正式部署的公共入口源码及 15 项路由测试。作品生成和读取走 ARTWORK_BACKEND；NFC、会话和实体打印继续走现场 UPSTREAM。用户不需要手动下载，浏览器显示与打印接收端自动读取云端作品。

部署时使用自己的 Cloudflare 登录；复制 wrangler.example.jsonc 为 wrangler.jsonc，将 UPSTREAM 改为自己的 HTTPS 现场网关，并将 service 改为已部署作品 Worker 的名称。自定义域名在自己的配置中添加。不要提交账户凭证或现场控制令牌。

从本目录运行：

```sh
node --test worker.test.mjs
node build.mjs
../node_modules/.bin/wrangler deploy --config wrangler.jsonc
```

构建只复制网页资源到本目录 dist，排除私有作品、数据库与 Python 服务文件。源代码来自仓库上两级；本地活动部署使用项目外 cloudflare 目录，这份构建不会覆盖活动资源。
