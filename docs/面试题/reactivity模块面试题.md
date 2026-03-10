# Vue3 Reactivity 模块面试题

## 基础理解

### Q1：请画出 Vue3 响应式系统的依赖存储数据结构，并解释为什么 `targetMap` 用 `WeakMap` 而不是 `Map`？

```
targetMap (WeakMap)
  └── target (原始对象)
        └── depsMap (Map)
              └── key (属性名)
                    └── dep (Set)
                          └── effect (ReactiveEffect 实例)
```

考察点：`WeakMap → Map → Set` 三层结构的理解，以及 WeakMap 的垃圾回收语义。比如组件卸载时 reactive 对象变为不可达，WeakMap 如何配合 GC 自动清理依赖？如果用 Map 会导致什么问题？

---

### Q2：`effect` 嵌套时，Vue3 是如何保证内层 effect 执行完后，`activeEffect` 能正确恢复到外层的？请描述具体机制。

```js
effect(() => {
  console.log('外层', obj.a)
  effect(() => {
    console.log('内层', obj.b)
  })
  console.log('外层继续', obj.c)
})
```

考察点：`this.parent = activeEffect` 的链式恢复机制，以及 Vue 3.2 之前用 `effectStack` 数组的方案。内层 effect 执行完后如何通过 `activeEffect = this.parent` 恢复到外层？

---

### Q3：你提到 `track` 中有 `shouldTrack && activeEffect` 的双重判断。请给出一个具体场景：`activeEffect` 存在但 `shouldTrack` 为 `false` 的情况。

考察点：确认是否真正理解 `pauseTracking` 的使用场景。最典型的场景就是数组的 `push`/`pop`/`shift`/`unshift`/`splice` 方法执行期间，`activeEffect` 可能存在（因为这些方法在 effect 回调中被调用），但 `shouldTrack` 被设置为 `false` 以防止 `length` 属性的隐式读取导致死循环。

---

## 深度机制

### Q4：Vue 3.2 的位运算依赖追踪优化是如何工作的？请具体解释 `trackOpBit`、`w`（wasTracked）和 `n`（newTracked）标记位的作用，以及它解决了什么性能问题？

考察点：

- Vue 3.2 之前每次 `effect.run()` 都会先 `cleanup`（从所有 dep 中删除自己），再重新收集。这在依赖关系稳定时造成大量无意义的删除 + 添加
- 位运算标记法可以做到"只清理不再需要的依赖，保留仍然需要的"
- `w` 标记在 run 之前标记"旧依赖"，`n` 标记在 track 时标记"新依赖"，run 结束后对比两者，只删除"旧有但新无"的依赖

---

### Q5：`computed` 为什么不在 `scheduler` 里直接重新计算值（调用 `run`），而是只标记 `_dirty = true`，等到下次访问 `.value` 时才计算？这样设计的好处是什么？

```ts
// scheduler 只标脏，不计算
() => {
  if (!this._dirty) {
    this._dirty = true
    triggerRefValue(this)
  }
}
```

考察点：lazy evaluation 的两大好处：

1. 如果 computed 值变了但没人读取，就省去了计算开销
2. 避免在一次同步批量更新中多次重新计算

---

### Q6：如果有以下代码，`trigger` 中的 `deps` 数组会包含哪些 `dep`？请详细分析。

```js
const arr = reactive([1, 2, 3, 4, 5])

effect(() => {
  console.log(arr.length)
})

effect(() => {
  console.log(arr[3])
})

arr.length = 2
```

考察点：

- `arr.length = 2` 触发 trigger 时，`key === 'length'` 且 `isArray(target)` 为 true
- 遍历 depsMap，`'length'` 的 dep 会被收集（因为 `key === 'length'`）
- `'3'` 的 dep 也会被收集（因为 `3 >= 2`，即索引大于等于新 length）
- `'0'` 和 `'1'` 的 dep 不会被收集（索引小于新 length，元素未受影响）

---

## 盲区探测

### Q7：Vue3 对 `Map`、`Set` 等集合类型的响应式处理和普通对象有什么本质区别？为什么不能复用 `baseHandlers`，而需要单独的 `collectionHandlers`？

考察点：

- Map/Set 的操作（`.get()`、`.set()`、`.has()`、`.forEach()`）不是通过属性访问触发的
- Proxy 的 `get`/`set` trap 无法直接拦截它们的语义，必须拦截方法调用本身
- `collectionHandlers` 通过拦截 `get` trap 来返回重写后的方法，在这些方法内部手动调用 `track`/`trigger`

---

### Q8：`effectScope` 解决了什么问题？在没有 `effectScope` 的情况下，组件卸载时如何清理所有 `effect`？有了它之后呢？

考察点：

- `effectScope` 允许批量收集和停止一组 effect，是 Composition API 中 `onScopeDispose` 的基础
- 没有它，每个 `watchEffect` / `computed` 都需要手动 `stop()`
- 有了它，组件卸载时只需调用 `scope.stop()`，所有在该 scope 内创建的 effect 都会被自动清理

---

## 综合应用

### Q9：以下代码，`effect` 中的回调会执行几次？如果把 `effect` 换成 `watch`，又会执行几次？为什么？

```js
const obj = reactive({ a: 1, b: 2 })
const sum = computed(() => obj.a + obj.b)

// 场景 A：用 effect
effect(() => {
  console.log('effect:', sum.value)
})

// 场景 B：用 watch
watch(sum, (val) => {
  console.log('watch:', val)
})

obj.a = 10
obj.b = 20
```

考察点：

- **effect**：trigger 直接同步调用 `effect.run()`，所以 `obj.a = 10` 触发一次，`obj.b = 20` 再触发一次，**共 2 次**（不含初始执行）
- **watch**：trigger 调用 `effect.scheduler`，scheduler 把 job 推入 `pendingPreFlushCbs` 队列并创建微任务，两次赋值在同一轮同步代码中完成，微任务执行时 `new Set()` 去重，**只执行 1 次**，拿到的是最终值 `30`

---

### Q10：为什么 `triggerEffects` 要分两轮循环，先执行 `computed` 类型的 effect，再执行普通 effect？如果去掉这个优先级，给出一个会产生错误结果的具体例子。

```ts
// triggerEffects 中的双循环
for (const effect of effects) {
  if (effect.computed) {
    triggerEffect(effect)
  }
}
for (const effect of effects) {
  if (!effect.computed) {
    triggerEffect(effect)
  }
}
```

考察点：

```js
const count = ref(0)
const double = computed(() => count.value * 2)

effect(() => {
  // 同时依赖 count 和 double
  console.log(count.value, double.value)
})

count.value++
```

如果不先执行 computed effect：先执行了 bizEffect，此时 `double.value` 还是旧值（`_dirty` 还是 `false`），会拿到过期数据。双循环保证 computed 先标脏并计算，业务 effect 再执行时拿到的都是最新值。

---

### Q11：在 `doWatch` 源码中，当 `source` 是一个 `reactive` 对象时，Vue 会自动设置 `deep = true` 并在 getter 中调用 `traverse()`。请解释 `traverse` 做了什么，以及如果不调用 `traverse`，`watch(reactiveObj, cb)` 会出现什么问题？

考察点：

- `traverse` 递归访问对象所有嵌套属性，目的是在 `effect.run()` 执行 getter 时触发所有属性的 `track`
- 如果不 traverse，只有顶层属性被 track，修改深层嵌套属性时 watch 不会触发回调
- `traverse` 内部还处理了循环引用（通过 `seen` Set 防止无限递归）

---

### Q12：Vue3 的 reactivity 模块中，`onTrack` 和 `onTrigger` 这两个调试钩子是如何工作的？源码中在哪里预留了这个能力？

考察点：

- 源码中在 `trackEffects` 和 `triggerEffect` 里，`__DEV__` 环境下会传递 `debuggerEventExtraInfo`
- `ReactiveEffect` 实例上可以挂载 `onTrack` 和 `onTrigger` 回调
- 当 `track` 或 `trigger` 发生时，如果 effect 上有这些钩子，会被调用并传入事件信息（target、key、type 等）
- 这是 Vue 为开发者提供的响应式调试能力

---

## 附加题

### Q13：在 `watch` 的回调中修改另一个被 `watch` 的响应式数据，会导致 `flushPreFlushCbs` 需要多轮执行。请构造一个具体的代码场景，并说明这种设计有什么风险？Vue 是如何防护的？

```js
const a = ref(0)
const b = ref(0)

watch(a, () => {
  b.value++  // watch a 的回调中修改了 b
})

watch(b, () => {
  console.log('b changed:', b.value)
  // 如果这里再修改 a，就会产生循环...
})

a.value++
```

考察点：

- `flushPreFlushCbs` 执行完一轮后会递归检查是否有新的 pending jobs
- 如果 watch A 的回调修改了 B，B 的 watch job 会被推入队列，下一轮 flush 执行
- Vue 通过 `RECURSION_LIMIT`（100 次）限制递归深度来防止无限循环
- 超过限制时会在开发环境下发出警告

---

## 题目总览

| # | 题目 | 难度 | 考察重点 |
|---|------|------|---------|
| Q1 | WeakMap 存储结构 + 为什么用 WeakMap | ⭐⭐ | 数据结构 + GC |
| Q2 | effect 嵌套时 activeEffect 如何恢复 | ⭐⭐⭐ | parent 链 / effectStack |
| Q3 | activeEffect 存在但 shouldTrack 为 false 的场景 | ⭐⭐⭐ | pauseTracking 应用 |
| Q4 | 位运算优化 trackOpBit / w / n 标记 | ⭐⭐⭐⭐ | 3.2 性能优化核心 |
| Q5 | computed 为什么不在 scheduler 里直接计算 | ⭐⭐⭐ | lazy evaluation 设计哲学 |
| Q6 | arr.length = 2 时 trigger 收集哪些 dep | ⭐⭐⭐ | 依赖扩散精准分析 |
| Q7 | collectionHandlers 为什么不能复用 baseHandlers | ⭐⭐⭐ | Map/Set 响应式 |
| Q8 | effectScope 解决什么问题 | ⭐⭐⭐ | 副作用生命周期 |
| Q9 | effect vs watch 执行次数对比 | ⭐⭐⭐⭐ | reactivity + scheduler 串联 |
| Q10 | computed effect 为什么要优先执行 | ⭐⭐⭐ | 双循环机制 |
| Q11 | traverse 的作用 + 不调用会怎样 | ⭐⭐⭐ | deep watch 机制 |
| Q12 | onTrack / onTrigger 调试钩子 | ⭐⭐ | debug 能力 |
| Q13 | watch 回调中触发另一个 watch 的递归风险 | ⭐⭐⭐⭐ | 调度系统稳定性 |
