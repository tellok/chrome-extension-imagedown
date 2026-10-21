# 演示规则Gist交付

2026-10-21，经用户批准创建：[ImageTaken演示Gist](https://gist.github.com/tellok/77a6e0fb625bf7707d568adf4f144c6f)。GitHub返回 public=false，表示不公开列出，并不是私密存储；只包含两份合成规则。

## 添加地址

在重新加载扩展后，打开设置→远程规则订阅，分别粘贴需要的地址并添加：

- GitHub仓库及Issues页面：[github.com.json](https://gist.githubusercontent.com/tellok/77a6e0fb625bf7707d568adf4f144c6f/raw/github.com.json)
- 假想相册路径示例：[example.com.json](https://gist.githubusercontent.com/tellok/77a6e0fb625bf7707d568adf4f144c6f/raw/example.com.json)

从创建返回的raw_url去除版本段生成上述跟随更新地址，两份均已实际HTTP获取，使用产品 `parseSubscription` 与 `validateRuleDocument` 验证，目标域名正确，各包含2条规则。GitHub示例限定本仓库路径；example.com示例用于阅读格式，不表示该网站实际存在相册。

规则本地覆盖优先，已有网站配置可能遮蔽演示值。扩展默认订阅列表仍为空，Gist地址没有打包进扩展。用户已明确本机手动添加；真实用户Chrome未被访问或修改，浏览器验证只使用临时独立配置。
