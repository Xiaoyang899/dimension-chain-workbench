# 第三方来源与声明

## Cephes 数值近似系数

`src/math.js` 中的 ERF/ERFC 系数用于误差函数及正态分布尾概率的有理近似，来源为 Stephen L. Moshier 的 Cephes Mathematical Library。这部分系数及其原有声明不因本项目采用 MIT 许可证而被重新授权。

原作者声明：

```text
Copyright 1984, 1987, 1988, 1992 by Stephen L. Moshier
```

Netlib 发布页的使用说明：

> What you see here may be used freely but it comes with no support or guarantee.

来源：

- [Cephes 发布页](https://www.netlib.org/cephes/)
- [原作者 README](https://www.netlib.org/cephes/readme)
- [SciPy v1.11.4 保留的 ndtr.c 系数与作者声明](https://github.com/scipy/scipy/blob/v1.11.4/scipy/special/cephes/ndtr.c)

构建后的离线 HTML 也保留作者与使用说明。项目未将 SciPy 作为运行时依赖。

## esbuild

构建时使用 esbuild 0.25.12，许可证为 MIT，版权声明为 `Copyright (c) 2020 Evan Wallace`。

来源：[esbuild 0.25.12 LICENSE](https://github.com/evanw/esbuild/blob/v0.25.12/LICENSE.md)。依赖由 `package-lock.json` 锁定，通过 npm 安装；本仓库不分发 esbuild 二进制或 `node_modules/`。

## 标准与参考工作簿

计算模型参考 GB/T 5847—2004《尺寸链 计算方法》。内置三个数值样例依据项目原始参考工作簿整理；第二、第三个样例按已启用的对称模式取 EI = −ES，并保留来源说明。本仓库不分发原始标准 PDF 或 Excel 工作簿；项目许可证不适用于这些外部资料。
