#### 跳出死循环

```ts
const proxy = reactive({
  count: 0
})

effect(() => {
  proxy.count++
})
```

分析上面的代码：

在 `effect` 方法中，首先创建 `_effect` 实例，然后执行 `run` 方法，这时候 `activeEffect = _effect`，执行 `fn`。

执行 `fn` 首先访问了 `proxy.count` 属性，这就触发了 `getter` 操作，然后开始 `track` 收集依赖，这个时候，`count` 对应的 `activeEffect` 就已经被收集起来了。

然后执行 `proxy.count` 赋值操作，触发了 `setter`，根据匹配规则找到了对应的 `effect`，执行 `effect.fn`

在 `fn` 执行的时候，又开始访问 `proxy.count`，然后收集依赖，执行赋值操作，开始 `setter`，**至此无限循环就开始了**。

#### Vue 的操作

```ts
function triggerEffect(effect: ReactiveEffect) {
  if (effect !== activeEffect || effect.allowRecurse) {
    effect.run()
  }
}
```

这里添加了一个判断条件，如果当前触发的 `trigger` 就是 `activeEffect`，不执行 `run` 方法。
也就是说，**`Vue` 规定了，如果是 `effect` 自己修改了自己引用的值，`Vue` 选择不重复触发**，从而切断了死循环。**只有别人修改了我的值，才会触发更新。**

但是也没有把路全部给堵死，这里还支持通过手动传入 `allowRecurse` 属性，来完成递归循环，但是这要求循环是存在结束条件的，不然会一直进行下去