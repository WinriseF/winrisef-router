# winrisef-router

智能边缘路由器/负载均衡器，基于边缘函数实现多源站智能路由。

## 功能特性

- **多源站负载均衡** - 支持 EdgeOne、Vercel、Netlify 等多个平台
- **地理位置感知路由** - 中国和全球用户使用不同的权重策略
- **加权轮询** - 根据配置权重随机选择源站
- **健康检查** - 自动检测源站可用性
- **粘性会话** - 通过 Cookie 保持用户会话到同一源站
- **零依赖** - 纯原生 JavaScript，无第三方依赖

## 技术栈

- JavaScript (ES Modules)
- EdgeOne 边缘函数 / 兼容的边缘计算平台
- Fetch API

## 源站配置

默认源站：
- `e.winrisef.top` (EdgeOne)
- `v.winrisef.top` (Vercel)
- `n.winrisef.top` (Netlify)

## 环境变量配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `CN_WEIGHTS` | 中国地区权重 | `e:50,v:25,n:25` |
| `GLOBAL_WEIGHTS` | 全球权重 | `e:30,v:35,n:35` |
| `DISABLED_ORIGINS` | 禁用的源站 | - |
| `FALLBACK_ORIGIN` | 健康检查均失败时直接回退的源站 | `e` |
| `STICKY_ENABLED` | 启用粘性会话 | `true` |
| `HEALTH_CHECK` | 启用健康检查 | `true` |

## 调试功能

| 参数 | 说明 |
|------|------|
| `?debug=1` 或 `?_router_debug=1` | 返回 JSON 调试信息 |
| `?to=e\|v\|n` | 强制路由到指定源站 |
| `?_router_clear=1` | 清除路由 Cookie |

响应头包含路由信息：`X-Routed-Origin`, `X-Router-Healthy` 等。

路由器并发使用 `HEAD /healthz` 探测 `e`、`v`、`n`，接受正常的 `2xx/3xx` 响应；源站未提供该端点（`404/405`）时回退探测首页。探测完成后仍按候选优先级选择第一个健康源站。所有探针均失败或没有候选源站时，直接跳转到 `FALLBACK_ORIGIN`（默认 `e.winrisef.top`），并通过 `X-Router-Healthy: 0` 标记降级状态。

## 目录结构

```
winrisef-router/
├── edge-functions/
│   ├── [[default]].js    # 主路由逻辑
│   └── index.js          # 入口文件
└── package.json
```

## 适用场景

- 多平台部署的高可用架构
- 跨平台故障自动切换
- 基于地理位置的性能优化
- 灰度发布和流量控制
