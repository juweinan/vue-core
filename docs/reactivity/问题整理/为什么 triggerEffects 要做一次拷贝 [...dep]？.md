## [...dep] 所解决的死循环！！！

#### 先看一下下面的测试代码

```js
const set = new Set([1])
set.forEach(item => {
  set.delete(item)
  set.add(item)
  console.log('我停不下来了！')
})
```

结果：控制台会疯狂打印，直到浏览器崩溃。
原因：Set 迭代器规定，如果一个元素被删除后，又被重新添加，**他会再次出现在循环的末尾**。

#### 回到 Vue 的 trigger

```ts
export function triggerEffects(
  dep: Dep | ReactiveEffect[],
  debuggerEventExtraInfo?: DebuggerEventExtraInfo
) {
  const effects = isArray(dep) ? dep : [...dep]
  triggerEffect(effect, debuggerEventExtraInfo)
}
```

Vue 在运行 effect 的时候，经常会出现先删除在添加的情况，如果不拷贝直接遍历 dep（切记这个 dep 是个 Set 类型的数据）

1. trigger 遍历 dep
2. 取出第一个 effect 开始执行
3. effect 在执行的过程中，因为手动调用了 stop 或者其他原因，将自己从 dep 中清除掉了
4. 紧接着又执行 track 把自己添加会 dep 中
5. 由于 Set 数据类型的特性，重新添加的 effect 出现在了循环的末尾，然后开始无限循环

#### 为什么 [...dep] 能解决

因为这是将 Set 变成了一个数组，这是一个全新的对象，是针对拷贝的那一时刻的快照。
遍历数组的时候，无论怎么去修改 Set，都不会影响数组循环的次数