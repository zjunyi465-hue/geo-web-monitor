# 如何发布这个项目

## 发布目录

使用白名单导出的公开目录。里面应直接看到 README.md、src、public、docs、test 和 package.json。不要上传正在使用的本机工作目录。

公开目录没有旧 .git 历史。先确认自己的 GitHub 账号和公开署名，再创建仓库。作者真实姓名及邮箱会出现在 Git 提交中；可使用自己选择的公开署名和 GitHub 提供的 noreply 邮箱，不要照抄其他人的信息。

## 网页上传

1. 在自己的 GitHub 账号创建 Public 仓库，名称建议 geo-web-monitor。
2. 上传公开目录中的内容，而不是把整个目录再套一层。没有上传的隐藏配置文件，可改用 Git 提交。
3. 检查首页图文、教程链接、LICENSE 以及 Actions 是否正常。
4. 设置简介和 topics，可参考 docs/sharing.md。
5. 确认后创建 v0.1.0 Release，附上版本范围和已知限制。

网页上传不一定包含以点开头的配置目录。若 .github、.gitignore、.gitattributes、.editorconfig 缺失，须补齐。

## 用 Git 上传

在公开目录打开终端。先设置自己确认过的公开提交身份，再操作：

```sh
git init
git add .
git diff --cached --stat
git commit -m "Initial public release"
git branch -M main
```

接着使用 GitHub 新仓库页面提供的 remote 和 push 命令。本文不提供虚构仓库 URL，也不自动使用本机已有的 Git 提交身份。

## 发布前检查

- 依赖安装、环境检查、默认测试和单题验收步骤可复现。
- README 截图只含虚构资料，真实运行目录不在提交中。
- 公开署名、邮箱和仓库 URL 都已确认。
- Actions 通过，不承诺跨平台和所有账号稳定可用。
- 更新 CHANGELOG 实际发布日期；X 文案填入真实仓库链接。

本项目包含 npm run export:public 与 npm run check:public。后者接受一个已导出目录路径，检查清单、排除路径及本地 Markdown 链接；它不能保证识别所有秘密，仍需人工检查。
