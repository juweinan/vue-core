## 前景

> 最近准备开始学习 Vue3 源码，将官方库 fork 到自己的仓库后，家里的 Windows 电脑一直无法 clone 下来代码。要么就是超时直接失败、要么就是 clone 速度只有 20Kb/s 左右，非常慢，而且 clone 到 30% 的时候也会中断。

## 原因

家里电脑挂了 VPN，导致 clone 速度非常慢。

## 解决办法

先查看是否曾经配置过代理

```bash
git config --global http.proxy
git config --global https.proxy
```

如果有配置，则取消配置

```bash
git config --global --unset http.proxy
git config --global --unset https.proxy
```

配置代理

```bash
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

其中，配置的新代理的端口，应该是 VPN 中设置的端口

**如果只想给 github 设置代理，可以使用以下指令**

```bash
git config --global http.https://github.com.proxy http://127.0.0.1:7890
git config --global https.https://github.com.proxy http://127.0.0.1:7890
```

查看所有的全局配置

```bash
git config --global --list
```