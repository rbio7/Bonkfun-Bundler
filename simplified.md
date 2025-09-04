# Standalone Bundler Script

`oneWalletBundle.ts` 是一个完全独立的示例脚本，展示如何创建 Bonk token 并在同一 bundle 中立即买入。所有逻辑都写在单个文件中，仅依赖于公共 npm 包（Raydium IDL 属于例外）。

## 流程概览
1. **加载环境变量**：读取主钱包、买家钱包以及 RPC 端点等信息。
2. **生成代币并上传元数据**：使用 `ipfs-pack` 创建图片与代币元数据，然后通过 Raydium Launchpad 构建代币创建交易。
3. **构建买入指令**：为买家生成所需的 ATA、WSOL 处理以及 `buyExactIn` 指令。
4. **打包并发送 Jito Bundle**：将创建交易和买入交易一起打包，通过 Jito relayer 发送。

## 运行方式
确保 `.env` 中的变量已经配置并安装依赖后，执行：

```bash
npm run single
```

该脚本便会在单个区块内完成代币的创建和买入，方便测试与理解核心流程。
