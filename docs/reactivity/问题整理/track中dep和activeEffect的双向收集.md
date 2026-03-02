## 双向收集

```ts
let activeEffect: ReactiveEffect | undefined

export function trackEffects(dep: Dep) {
  dep.add(activeEffect!)
  activeEffect!.deps.push(dep)
}
```

在 `track` 收集依赖的逻辑里，有一个双向收集的逻辑，其中

- 正向收集：`dep.add(activeEffect!)`。意思就是：**这个属性记住了哪个函数在观察他**。
  - 作用：当属性发生变化时，能找到函数去执行（`trigger`）
- 反向收集：`activeEffect!.deps.push(dep)`。意思就是：**这个函数记住了他在观察哪些属性**。

#### 🤔 为什么函数要记住他观察了那些属性？（应用场景：手动停止或者卸载）

最直接的场景就是 `runner.stop()` 或者 组件销毁。

如果说 `effect` 里面观察了 `100` 个属性，现在想停止这个 `effect`：

- **没有反向收集**：`Vue` 必须遍历整个应用的 `targetMap`（那张巨大的表），去每一个属性的 `dep` 集合里寻找并删除这个 `effect`。这简直是大海捞针，性能极差。
- **有了反向收集**：`effect` 手里有一张清单（`this.deps`），记录了它都在哪儿报过到。停止时，它只需要遍历自己的清单，顺藤摸瓜找到那 `100` 个 `dep`，把自己从里面删掉即可。

```ts
function cleanupEffect(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    // 1. 遍历自己记录的所有 dep (Set)
    for (let i = 0; i < deps.length; i++) {
      // 2. 将自己从对应的属性依赖集合中删除，但是这个 dep 中其实还有其他的 effect 存在
      deps[i].delete(effect)
    }
    // 3. 清空自己的清单
    deps.length = 0
  }
}
```

#### 🙋 总结

**双向收集就是为了让 `effect` 被关闭时，能有优雅的全身而退。实现高效清理依赖，防止内存泄漏。**



